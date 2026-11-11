# Browser usage audit — Steps 1 and 2

Step 1 adds `usage_event_audit`, its registered TypeORM entity, and validated configuration. Step 2 integrates selected finalized browser events into the existing provisional pipeline transactions. Audit retention cleanup and administrative views/exports remain unimplemented. Detection decisions, official counting logic, the two-minute review window, and both migrations are unchanged by Step 2. Apply the existing `1794100000000-CreateUsageEventAudit.ts` migration before enabling audit collection.

## Configuration and retention

`LIVE_USAGE_AUDIT_ENABLED=false` defaults to disabled and accepts only `true` or `false`. When enabled, new eligible terminal transitions in the provisional browser pipeline write audit rows. When disabled, no audit repository access is required and existing counting/redaction behavior is preserved. Events already finalized while disabled are not backfilled by retries. `LIVE_USAGE_AUDIT_RETENTION_DAYS=90` defaults to 90 and accepts integer days from 1 through 365. Invalid settings fail validation at application startup, including when disabled. Audit settings are separate from `ProvisionalOptions` and the existing policy fingerprint; changing them does not require a detection-policy transition.

The pure `usageAuditRetentionCutoff(now, retentionDays)` helper subtracts the current retention in elapsed 24-hour days from the current time, preserving milliseconds. Future cleanup must use `WHERE finalizedAt <= :cutoff`, with the cutoff bound as a parameter. The existing `IDX_usage_audit_finalized(finalizedAt)` index supports this comparison without wrapping the indexed column in a function. No cleanup query or job is implemented yet.

There is no per-row `expiresAt` or insertion-time retention snapshot. The active retention policy applies equally to all retained rows: changing 90 to 30 days makes rows finalized at least 30 days ago eligible for the next cleanup pass; increasing retention keeps still-present rows longer but cannot restore deleted rows. Settings are loaded at startup, so reload/restart all instances consistently after changing environment variables. Any future administrative view must calculate eligibility from the same active policy. No row rewrite or bot-policy transition is required.

All audit timestamps use `datetime(3)`, matching provisional timestamps. `finalizedAt` is required without a database default: the future writer must supply the actual finalization time, including immediate REVIEW/REJECT and EXPIRED paths. Retention starts at finalization, not receipt. Use the same time convention as provisional events across application instances and database connections.

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

Step 3 must implement audit-retention cleanup using the active cutoff for each pass over all retained rows. Read-only administrative review remains separate work. Until cleanup is implemented, retained audit records are not automatically deleted at their retention age. Enable the flag consistently across instances; mixed enabled/disabled workers can leave audit gaps because finalized events are not backfilled.

## Validation

Run `npm run test:usage-audit`. Its default tests build TypeORM metadata without opening an application database connection and verify cutoff arithmetic, retention changes and the exact eligibility boundary. Optional schema and pipeline integration tests use the existing disposable-localhost helper, random schemas and actual migrations. They cover schema agreement, canonical metadata, query privacy, terminal decisions, both expiration paths, concurrent/reconnected retries, disabled operation without an audit table, injected audit/transition failures with rollback/recovery, and audit survival after provisional cleanup. They never use application DB_* variables. To run against a dedicated disposable MySQL instance, follow [the existing setup](live-usage-bot-protection.md) and set `LIVE_USAGE_TEST_MYSQL=disposable LIVE_USAGE_TEST_MYSQL_PORT=<dedicated non-3306 port>` before the command.
