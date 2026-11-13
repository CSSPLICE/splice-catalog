# Browser usage audit

The provisional pipeline records selected finalized browser events in `usage_event_audit`. An independent worker removes expired audit history. Apply the existing `1794100000000-CreateUsageEventAudit.ts` migration before enabling collection. Application startup leaves schema management to the deployment migration step.

## Configuration and retention

`LIVE_USAGE_AUDIT_ENABLED=false` defaults to disabled and accepts `true` or `false`. The flag controls collection of new audit rows. Cleanup runs with either setting so previously collected history still expires. When collection is disabled and the table is absent, the worker skips that pass and checks again at the next scheduled run. An absent table with collection enabled is reported as a cleanup failure. Events finalized while collection was disabled are not backfilled.

`LIVE_USAGE_AUDIT_RETENTION_DAYS=90` defaults to 90 and accepts integers from 1 through 365. Each pass computes a fresh cutoff from the configured number of elapsed 24-hour days. It deletes rows whose `finalizedAt` is at or before that cutoff, including equality to the millisecond.

Changing 90 to 30 days makes existing rows finalized at least 30 days ago eligible on the next pass. Changing 90 to 180 days preserves still-present rows for longer. Deletions are permanent. Restart all instances with the same settings after changing retention because an instance still running with a shorter window can continue deleting according to that window. Audit settings are independent of the bot policy fingerprint.

All audit timestamps use `datetime(3)`, matching provisional timestamps. Retention starts at the `finalizedAt` time recorded by the audit writer. Use a consistent time convention across application instances and database connections.

## Cleanup scheduling and batching

The worker starts a pass asynchronously after HTTP begins listening and runs approximately every 24 hours thereafter. Shutdown clears the timer and waits for an active pass before closing the database connection. `LIVE_USAGE_AUDIT_MAX_ROWS_PER_PASS=20000` sets the maximum rows deleted per pass per instance. The application validates all audit settings at startup. The cap accepts integers from 1 through 100,000 to bound a pass to at most 100 delete statements. Restart the application to apply a new cap.

Full batches delete up to 1,000 rows. When the remaining allowance is smaller, the worker uses it as the final batch size. A pass stops when it reaches the cap or a batch deletes fewer rows than requested. Larger backlogs drain across successive passes. Expiration determines when a row becomes eligible. Actual deletion depends on the schedule, backlog, and database availability.

Each batch is a single autocommitted MySQL `DELETE` ordered by `finalizedAt` and then `id`. The existing finalization index supports the range query and InnoDB stores the primary key in that index for ties. MySQL selects and deletes the rows atomically without sending event data to the application. Within a process, a timer tick skips an active pass. Across instances, concurrent batches use normal InnoDB locking and recheck the expiration predicate. Each instance has its own pass limit.

The worker logs the deleted count on success and a sanitized database error code on failure. Reaching the cap emits a warning with the deleted count because expired rows may remain. The warning contains no audit records or identifiers. A failed batch rolls back while earlier batches remain committed. The next scheduled pass or restart retries using the current cutoff. Cleanup targets only `usage_event_audit` and has no dependency on the provisional pipeline lock. Official clicks, searches, and aggregates survive because audit references have no foreign keys and the official data lives in separate tables.

## Schema

| Columns | MySQL type | Purpose |
| --- | --- | --- |
| `id` | auto-increment int primary key | Audit row identity |
| `provisionalEventId` | int, unique | Idempotent reference to the originating provisional row |
| `eventKey`, `sessionKey`, `networkKey`, `agentKey`, `identityKey` | char(64) | Copy existing domain-separated HMAC-SHA256 keys unchanged; identityKey covers resource/search identity |
| `kind` | varchar(20) | ENTRY_CLICK, EXTERNAL_CLICK, WEB_SEARCH |
| `initialDecision`, `initialReason` | varchar(10), varchar(64) | Initial ACCEPT/REVIEW/REJECT classification and reason code |
| `status`, `reason` | varchar(10), varchar(64) | Final ACCEPTED/REVIEW/REJECTED/EXPIRED status and reason code |
| `policyVersion` | varchar(24) | Existing versioned evaluator identifier, such as phase2.1-v1 |
| `sessionStartedAt`, `receivedAt`, `finalizedAt` | datetime(3) | Session, receipt and finalization times; finalizedAt anchors current retention |
| `officialEventId` | nullable int | usage_events ID for clicks, search_events ID for WEB_SEARCH; kind resolves the table |
| `catalogType`, `linkType` | nullable varchar(32) | Canonical, non-sensitive catalog/link categories only |
| `itemPersistentID` | nullable varchar(255) | Canonical catalog resource reference for clicks; scope by catalogType |
| `itemTitle` | nullable varchar(255) | Optional bounded title snapshot for renamed/deleted catalog resources |

Indexes: unique `UQ_usage_audit_provisional_event(provisionalEventId)` and `UQ_usage_audit_event_key(eventKey)`; `IDX_usage_audit_received(receivedAt)`; `IDX_usage_audit_finalized(finalizedAt)` for date filtering and retention; `IDX_usage_audit_status_time(status, finalizedAt)`; `IDX_usage_audit_kind_time(kind, finalizedAt)`; `IDX_usage_audit_resource_time(catalogType, itemPersistentID, finalizedAt)`. Status, kind and catalog resource each support filtering with a finalization date range. Resource identity is the pair `(catalogType, itemPersistentID)` because tools and datasets use numeric catalog IDs under the existing naming convention.

There are no foreign keys, so removing provisional/official rows cannot cascade into audit history. A unique eventKey additionally guards against replay after provisional deletion. As with the provisional entity, classification fields use varchar storage and TypeScript unions. The writer only inserts terminal rows, uses pipeline decision/reason codes, and explicitly allowlists metadata.

## Privacy and metadata

For ENTRY_CLICK and EXTERNAL_CLICK, audit writes derive itemPersistentID, itemTitle, catalogType and linkType from the canonical server-validated provisional payload. The existing `UsageController.recordClick` resolves catalog records before staging accepted clicks; the writer uses that snapshot before payload redaction and does not copy submitted display fields. Titles are bounded to 255 Unicode characters. If no catalog record was validated (for example, an early withheld event), item fields remain null. The snapshot can identify renamed/deleted items without a live catalog join; it has no foreign key and is not an HTML-safe rendering value.

For WEB_SEARCH, the writer always sets itemPersistentID, itemTitle and linkType to null. catalogType may retain the canonical searched catalog category. It copies the existing HMAC identityKey, never the raw query or payload. The existing official search insert is unchanged. Nullable varchar columns follow the existing repository convention and do not provide cross-column SQL validation; the explicit writer implements these event-specific rules.

The schema excludes raw IPs, user-agent strings, cookies/tokens, search queries, personal user identities, resource URLs and full request payloads. The resource identifier and title are public catalog metadata, not visitor identities. HMAC keys still allow pseudonymous correlation during retention; keep the existing secret private. The writer copies only the five existing HMAC keys and approved scalar fields. `policyVersion` is the existing `currentUsagePolicy` identifier (`phase2.1-v1`), never the secret or configuration fingerprint.

## Terminal transitions and failure behavior

All writes use `MySqlProvisionalUsageStore.auditFinalized` and the transaction's EntityManager:

- PENDING admission writes no finalized audit record.
- Immediate eligible REVIEW/REJECTED admission inserts the audit row in the same locked transaction as the provisional row. Existing immediate payload redaction is unchanged, so metadata remains null.
- `finalizeDue` inserts the audit alongside the official event (only for ACCEPTED) and the provisional terminal update. Final REVIEW and EXPIRED outcomes have no official event. It reads the validated snapshot before payload redaction.
- The existing provisional `cleanup` path audits overdue PENDING rows before bulk expiration/redaction. Audit insertion, terminal updates and any provisional deletion in that pass share the same transaction. This is not audit-retention cleanup.

Detailed audits exclude exact initial/final reasons KNOWN_AUTOMATION, ORIGIN_INVALID, SESSION_MISSING, SESSION_INVALID, SESSION_EXPIRED, TOKEN_INVALID, EVENT_ID_INVALID and CREDENTIAL_CONTEXT_UNAVAILABLE. The HTTP path already prevents failed origin/credential checks from staging provisional rows. Known automation with valid context still keeps its existing provisional evidence, so retrospective detection remains effective. Other REVIEW and REJECTED decisions remain eligible, including RETROSPECTIVE_KNOWN_AUTOMATION reviews of earlier events.

The shared InnoDB pipeline lock serializes admissions and finalizers. Admission reuses existing provisional rows by eventKey; a finalizer rechecks PENDING status while locked. Unique audit indexes on provisionalEventId and eventKey provide a further database guard. Inserts use ordinary INSERT, not INSERT IGNORE or an error-swallowing upsert. A conflicting audit insert fails closed rather than permitting a second official event. No retry/backfill path rewrites existing audit history.

Audit errors propagate and roll back the entire transaction, including official inserts and provisional updates/redaction. Worker failures leave payloads pending for retry. Immediate admission failures leave no partial provisional/audit row; the existing HTTP failure handler releases its local replay reservation and returns a non-counting 503 so the same event ID can retry. Failures after the audit insert also roll that insert back. Skipped/disabled audits do not alter existing evidence, classification or counts.

Use the same collection setting across instances to avoid audit gaps when workers finalize events.

## Audit History

Administrators can open **Audit History** in the Usage Statistics dashboard. The read-only tab loads retained finalized browser events on demand, including when collection is disabled. Existing retention settings determine how long records are available.

Use the search field for titles, persistent IDs, and reason codes. Narrow results by status, event type, catalog, or finalized date. The default view covers up to 30 calendar days within the configured retention period. Custom ranges include both dates and use the server time zone. Results show 25 rows per page. Refine filters to reach older records once the 10,000-row pagination offset limit is reached.

**Download JSON** and **Download CSV** export the same records for the applied filters, with up to 5,000 records per download. Larger exports ask you to narrow the filters. Audit History provides no controls to edit, delete, or reclassify events. Official usage totals and their exports use the dashboard’s global filters.

## Validation

Run `npm run test:usage-audit` for configuration, cutoff, scheduler, and schema checks. The optional integration tests use random schemas and the existing migrations on a dedicated disposable MySQL instance. They cover the audit pipeline, indexed cleanup of a large backlog, boundary and configuration changes, concurrent finalization, failed-batch retry, and server restarts with collection disabled. The server test takes its database connection from the disposable fixture. Set `LIVE_USAGE_TEST_MYSQL=disposable LIVE_USAGE_TEST_MYSQL_PORT=<dedicated non-3306 port>` to run them. [Disposable MySQL setup](live-usage-bot-protection.md)
