# Live usage bot protection — Phase 1 policy

Phase 2 adds an opt-in durable provisional lifecycle. See [the Phase 2 design, setup and limits](live-usage-bot-protection-phase2.md) and [local learning simulations](../tests/local-bot-simulations/README.md). Immediate-write descriptions below describe Phase 1 (`LIVE_USAGE_PROVISIONAL_ENABLED=false`), which remains available for comparison.

This change protects new live events only. It does not identify all humans, reinterpret existing rows, change aggregation queries, migrate schemas, import logs, or enable production enforcement. All application instances default to `LIVE_USAGE_MODE=off`.

## Audit and event semantics

| Entry point                                                              | Existing meaning                                       | Policy                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `POST /usage/entry-click`                                                | Deliberate catalog link activation                     | Browser session + origin + event ID + behavioral classification inside `UsageController` |
| `POST /usage/external-click`                                             | Deliberate resource link activation                    | Same browser policy; canonical resource/link type validated                              |
| `POST /usage/web-search`                                                 | Explicit form submission; deliberate repetitions count | Same browser policy; query normalized using existing parser                              |
| `GET /api/:catalog?terms=...`                                            | Completed public API search, including zero results    | Separate API policy inside `SearchController`; no browser cookie required                |
| Catalog/detail GET, `GET /search`, `POST /search`, `GET /search/results` | Rendering or background retrieval                      | Never write click or search statistics                                                   |
| `POST /usage/session`, HTML rendering                                    | Issue/renew anonymous credentials                      | No official event is written                                                             |

These are all live event-writing controller paths found in the repository. Existing `UsageStatisticsService.recordEvent` and `SearchStatisticsService.recordSearch` remain persistence primitives; there are no other HTTP callers. Protection executes in the controllers, so an alternative route delegating to them inherits classification. A future caller of a persistence primitive must explicitly select a protection policy. Historical services and import scripts are unchanged.

The October 30 log was not available in this checkout. No causal conclusion about that deployment is possible. The current code has tracking attributes on static and dynamically rendered links and loads the script in the shared header. Real Chrome tests verify POST delivery. A crawler fetching catalog GETs without browser activation is expected to produce no entry/external POSTs. JavaScript failures, stale deployed assets, request blocking, missing route coverage in that deployment, or log scope/format could also explain an absence. The checked-in Nginx configuration proxies `/usage` via `location @backend` and contains no explicit exclusion for these POSTs; log collection and the running configuration still need independent verification. No production requests were made for this investigation.

## Decisions and responses

`ACCEPT` is eligible to count. `REVIEW` and `REJECT` never call live event persistence in enforce mode. Each decision has a fixed machine-readable reason. REVIEW events are withheld, not stored in a moderation queue: there is no retrospective approval/recount facility in this lightweight implementation.

Browser responses use `201` with `counted:true` **only after persistence succeeds**. Suppressed events return `202` with `counted:false`, decision and reason. Missing/invalid/expired credentials use `401` so the tracker can renew and retry once. Invalid payloads/identities use `400`/`404`, unsupported content uses `415`, oversized bodies use `413`, and persistence failures use `500` with `counted:false`. Accepted classification is not proof of a successful database write.

API result bodies and access remain unchanged. Successful public searches expose `X-Usage-Counted`, `X-Usage-Decision`, and `X-Usage-Reason` response headers. A statistics/state failure never fails retrieval. API totals intentionally include ordinary scripted API clients such as curl, Python requests, and axios. Recognizable crawlers/scanners/headless clients are excluded in enforce mode. API usage must not be presented as human-only usage.

| Mode                       | Behavior                                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `off` (default everywhere) | Preserve legacy eligible-event counting; do not require credentials or classify bot signals. Payload/catalog validation and the small tracking-body limit still apply.                                                               |
| `observe`                  | Run classification and aggregate shadow reasons, but return effective `ACCEPT` with reason `OBSERVE_ONLY` and a `shadow` decision for would-be withheld events. Existing eligible events still count. These totals are not filtered. |
| `enforce`                  | Only ACCEPT reaches official persistence. REVIEW and REJECT stay out of totals.                                                                                                                                                      |

An in-process `snapshot()` exposes bounded aggregate classification counts by reason for the current hourly audit interval, plus session/IP state sizes. There is no public audit endpoint, raw request log, persistent identifier table, or automatic approval UI. Classification counts include attempts whose later payload resolution/storage failed; they are not a replacement for persisted dashboard totals. Only detection decisions (not malformed JSON or catalog validation errors) enter the detector audit.

## Three layers

1. Explicit crawler/scanner/headless and browser-script User-Agent indicators. Unknown/privacy browsers are accepted unless another signal applies. Indicators are curated source patterns plus configurable literal substrings, not verified identities or an automatically updated feed. User-Agent spoofing remains trivial. API clients have a separate script policy.
2. Sliding-window per-session and keyed per-IP event/request observations, including burst rate, repeated event identity, rapid distinct-entry sequences, User-Agent changes, exact event replay and capacity exhaustion. EXTERNAL clicks do not require a preceding ENTRY click: direct detail visits and catalog resource links are legitimate existing behavior. No sequential numeric-ID assumption is used. Known bot rejections do not consume normal users' IP/session budgets. Uncredentialed requests with ordinary browser UAs do affect the IP budget, but are rejected individually.
3. Anonymous unpredictable session ID in an HttpOnly, host-only, SameSite Strict cookie and a separate random token in same-origin HTML. Production cookies use `__Host-splice_usage`, `Secure`, and `/`; local HTTP uses `splice_usage`. Credentialed HTML is private/no-store and must never be cached at an edge. The token is submitted as `X-Usage-Token`, paired with a new random event ID for every trusted activation. Both cookie and token are required. A valid cookie/token is not evidence of humanity.

The tracker retains click/auxclick/submit handling for mouse, keyboard, modifier and middle clicks. It never cancels navigation. Initial credentials are embedded in the HTML, avoiding an asynchronous bootstrap before the first navigation. Each POST uses fetch keepalive; credentials are reused across normal tabs/refreshes. Renewal is deduplicated within each page and occurs at expiration and on return to an expired page. A credential rejection triggers at most one renewal/retry, with the same event ID. Network failures and other responses are not retried automatically. Synthetic DOM activations are ignored client-side, but sophisticated automation can generate trusted browser input.

## Configuration and candidate thresholds

Example local application setup (use the repository's normal local DB/search/auth setup):

```sh
npm install
LIVE_USAGE_MODE=enforce LIVE_USAGE_ORIGIN=http://localhost:3000 npm run dev
```

Use the exact public origin (`scheme://host:port`) that the browser loads. `LIVE_USAGE_ORIGIN` falls back to the existing `baseURL`, then request protocol/host for standalone local test servers. Enforce rejects missing/foreign/null Origin unless a same-origin Referer is supplied when Origin is absent. If present, `Sec-Fetch-Site` must also be `same-origin`; same-site subdomains are insufficient. Privacy tools removing both Origin and Referer lose analytics but retain catalog access.

Every numeric option below is configurable via `LIVE_USAGE_` plus the listed key. Values must be positive safe integers; session review cannot exceed session rejection; burst/repeat windows cannot exceed the main window. Thresholds are **local candidates demonstrated by synthetic fixtures, not calibrated production limits**. Collect observe-mode aggregates and representative legitimate traffic, then measure false positives/negatives before any separate production rollout.

| Environment suffix                   |      Default | Effect                                                                          |
| ------------------------------------ | -----------: | ------------------------------------------------------------------------------- |
| `SESSION_TTL_MS`                     |      1800000 | Fixed 30-minute session lifetime                                                |
| `WINDOW_MS`                          |        60000 | Main sliding window                                                             |
| `SESSION_REVIEW`                     |           60 | More events/session/window → REVIEW                                             |
| `SESSION_REJECT`                     |          240 | More events/session/window → REJECT (`SESSION_ABUSE`)                           |
| `IP_REVIEW`                          |          600 | More attempts/IP/window → REVIEW, never IP-only REJECT                          |
| `BURST_WINDOW_MS` / `BURST_REVIEW`   |    2000 / 12 | More events in burst window → REVIEW                                            |
| `REPEAT_WINDOW_MS` / `REPEAT_REVIEW` |    10000 / 6 | More repetitions of the same kind + identity → REVIEW                           |
| `DISTINCT_REVIEW`                    |           12 | More distinct ENTRY identities in repeat window → REVIEW                        |
| `MAX_SESSIONS` / `MAX_IPS`           | 10000 / 5000 | Refuse new session allocation / REVIEW new IP allocation at capacity            |
| `MAX_REPLAY_IDS`                     |          512 | Max consumed IDs/session, retained for its full lifetime; beyond limit → REVIEW |

`LIVE_USAGE_BOT_INDICATORS` adds comma-separated case-insensitive literal substrings. Avoid broad strings that match normal browsers. Restarting clears state, invalidating existing credentials; the browser can renew. Network changes do not invalidate a session, and IP is not a session identity.

Session histories are capped at session reject threshold + 1, IP timestamp lists at IP threshold + 1, and replay IDs at their configured cap. HMAC with a process-random key protects in-memory UA, event identity and IP keys; raw queries/IPs/UA strings are not retained by detection. Official accepted SearchEvents retain their existing search-query semantics. The application singleton purges expired state every minute (unref timer), and request/diagnostic operations also clean it. The clock is injectable for deterministic expiration/boundary tests. At capacity or detector exceptions, enforce withholds statistics while browsing/retrieval continues. State exhaustion remains an availability attack, not an event-counting bypass.

The `/usage` 4 KiB strict, uncompressed JSON parser mounts **before** the application's existing 50 MB parser. Unsupported form/text bodies cannot fall through to the broad parser. The route factory also includes that parser for independent mounts. Keep equivalent ordering if mounting it in another application.

## Proxy and multi-instance requirements before any production enforcement

No production enforcement or Nginx configuration change is part of this task. By default Express ignores X-Forwarded-For. `LIVE_USAGE_TRUSTED_PROXIES` is a comma-separated list of **actual proxy peer addresses/subnets** passed to Express; never set a blanket boolean or trust-hop count. The existing Nginx appends the connected client address to XFF. With only the actual proxy subnet trusted and the backend reachable only from that proxy, Express selects the nearest untrusted address; a client-supplied earlier XFF address does not become the client IP. Avoid broad Docker/private ranges containing untrusted peers. Validate this against the real network path. Use the exact HTTPS public origin and keep the backend isolated before enabling enforcement separately.

For multiple workers/instances, replace the in-memory store with shared expiring state (for example Redis) or a single classification service. The shared implementation must atomically validate session/token/expiry, reserve event IDs, append/prune window observations and classify **in one transaction/script**, across all workers. Use a deployment-wide rotating HMAC key with a bounded overlap period and globally consistent clocks/windows/capacities. Share sessions, replay state, IP counters and audit aggregation; per-process counters or sticky sessions alone are insufficient, especially for IP/coordinated analysis. Define store outage behavior as fail-closed for analytics and fail-open for browsing. Preserve response and TTL contracts.

A shared replay reservation alone gives at-most-once attempts, not transactional exactly-once persistence. For crash-safe exactly-once counting, add a unique ingestion event key and couple reservation/outbox status with database insertion, including a defined retry/reconciliation policy. Current local code consumes an event ID synchronously before awaiting DB lookup/save. A failed save cannot later replay into duplicate counting, but the event may be lost. A process restart loses the reservation and the session together, so old credentials stop working.

Future coordinated-traffic analysis should consume privacy-preserving aggregate windows across IPs and sessions (for example synchronized entry-set coverage), with a separate validated policy. There is no cross-IP campaign detector, challenge service or browser fingerprinting here. Adding such analysis is not necessary to run this local implementation.

## Known risks and practical limits

- Distributed low-volume bots obtaining valid credentials are indistinguishable from legitimate clients here. The controlled 100-client simulation intentionally accepts all 100.
- Valid-session automation can contribute events before thresholds fire. The default burst simulation accepts 12/20 distinct-entry events and reviews 8/20. No retroactive cleanup of those accepted events occurs.
- Recognizable known bots are rejected, but spoofed User-Agents, replay with new event IDs, new sessions, and new IPs can evade portions of the policy.
- Shared NAT, accessibility automation, scripted browser clients, rapid repeated legitimate clicks, UA changes, missing origin headers and state exhaustion can withhold legitimate events. API IP review can suppress legitimate high-volume API clients. REVIEW is conservative withholding, not a claim of abuse.
- Heavy known-bot traffic does not penalize ordinary sessions, but disguised uncredentialed floods can exhaust an IP budget and cause legitimate co-located sessions to be reviewed. IP windows recover automatically.
- Cold simultaneous first-page loads can race cookie issuance; the token mismatch triggers one renewal. Existing sessions support parallel tabs and unique concurrent events without a global single-use token bottleneck. A stolen cookie+token is reusable with fresh IDs until expiration; only exact consumed event IDs are rejected automatically.
- Keepalive improves unload delivery, but does not guarantee it. Browser keepalive quotas, network loss, blocked scripts/cookies, a credential renewal exactly during unload or a cold cookie race can lose an event. Navigation always proceeds. Do not interpret zero analytics as zero real usage.
- Session issuance is bounded but unauthenticated; a browser-like attacker can fill available session slots. Stronger edge request controls/shared capacity planning are a separate production concern.

## Tests and isolated MySQL option

```sh
npm run build
npm run test:usage
npm run test:live-usage
```

The existing regression analytics tests explicitly use `off` to verify legacy counting, filters/CSV/daily/per-item semantics; the new HTTP/browser suites explicitly use `enforce`. Chrome defaults to the existing macOS path; set `CHROME_BIN` elsewhere. Puppeteer uses a normal Chrome UA to exercise legitimate-browser policy; separate unit tests verify rejection of HeadlessChrome. The browser test automation is not being claimed to be distinguishable from a human.

Default tests use repository doubles and never connect to application DB credentials. Optional DB tests persist UsageEvent and SearchEvent through real TypeORM/MySQL repositories, create a fresh random test schema, compare row counts, and drop only that schema. They require an explicit disposable localhost server on a non-3306 port; they do not use `DB_*` variables. They do not initialize the full application or run any historical migrations/imports.

If Docker is already available, a disposable test-only example is:

```sh
docker run --rm -d --name splice-live-usage-test-mysql -p 127.0.0.1:33316:3306 -e MYSQL_ROOT_PASSWORD=local-test-only --tmpfs /var/lib/mysql mysql:8
# Wait until this test container reports ready before running the next command.
LIVE_USAGE_TEST_MYSQL=disposable LIVE_USAGE_TEST_MYSQL_PORT=33316 npm run test:live-usage
docker stop splice-live-usage-test-mysql
```

The test-only password can be overridden with `LIVE_USAGE_TEST_MYSQL_PASSWORD`. Never point these tests at an application database or production tunnel. See the accompanying local test report for executed results and environmental limitations.
