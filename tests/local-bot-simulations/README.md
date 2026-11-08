# Local-only live analytics learning exercises

These scripts never attach to the running SPLICE app. `phase2.mjs` starts its own Express server bound to `127.0.0.1`, uses an ephemeral port by default, and creates a random `splice_bot_test_<hex>` schema in an explicitly selected disposable MySQL instance. It refuses application database port 3306 and never reads `DB_*`. Requests to non-loopback origins are rejected/aborted. Use only a disposable local MySQL container, not a forwarded production connection.

## Run

The test-only MySQL instance can be started without mounting application data:

```sh
docker run --rm -d --name splice-phase2-test-mysql -p 127.0.0.1:33317:3306 -e MYSQL_ROOT_PASSWORD=local-test-only -e MYSQL_ROOT_HOST=% --tmpfs /var/lib/mysql mysql:8
docker exec splice-phase2-test-mysql mysqladmin ping -h 127.0.0.1 -plocal-test-only
# Run after it reports ready:
LIVE_USAGE_TEST_MYSQL=disposable LIVE_USAGE_TEST_MYSQL_PORT=33317 npm run simulate:live-usage
# Stop only this test container when finished:
docker stop splice-phase2-test-mysql
```

Set `CHROME_BIN` if Chrome is not at the existing macOS path. `LIVE_USAGE_TEST_MYSQL_PASSWORD` overrides the test-only password. `LIVE_USAGE_SIMULATION_PORT` selects a free fixture-only loopback port instead of automatic allocation; ports used by the normal app/database/search stack are refused. There is deliberately no arbitrary remote `--url` option. `LIVE_USAGE_SIMULATION_OUTPUT` selects the local aggregate JSON output file (default `/tmp/splice-phase2-comparison.json`). No cookies, raw IPs, User-Agents, tokens or search queries are written to the report.

## What the code demonstrates

- **HTTP:** Node fetch sends JSON POSTs with method, headers and body. Twenty bounded async workers each send 50 Googlebot requests. Promise.all waits for completion; it does not create independent real network addresses.
- **Browser input:** Puppeteer controls a real Chrome instance. `page.click` and keyboard input produce trusted browser events that the actual `usageTracking.js` submits to the actual usage router/controller. Link targets open real local detail/resource pages; typing alone does not count as a search, while Enter submits the form.
- **Sessions:** `browser.createBrowserContext()` gives each actor a separate cookie jar. Twenty contexts on this machine still share one loopback IP. The launch-level normal Chrome UA applies to popups too; UA is not a human-attestation signal. Detector unit tests separately verify HeadlessChrome rejection.
- **Concurrency:** The HTTP flood is concurrent. Mouse input switches active tabs explicitly, avoiding a test-driver focus race. Normal input is interleaved with automated input while their analytics POSTs may be in flight. Distinct event IDs and the durable unique event key prevent duplicate counting.
- **Timing:** The slow scenario really waits 3, 4 or 5 seconds between each of 20 clicks. Only the finalizer's injected clock is advanced after traffic, by 120 seconds, to avoid another two-minute wait per scenario. This is not a wall-clock measurement of the full default review delay. A separate MySQL test measures a real short review-window latency.
- **Ground truth:** Fixture labels identify the scripted actor as automated or legitimate for measurement only. The detector never reads the label. The old count is Phase 1's ACCEPT decisions on the same request stream. The new count is real MySQL official rows after delayed finalization. Privacy-preserving event keys link fixture labels to outcomes, then only aggregate results are exported.
- **Durability:** `worker-once.mjs` opens a new connection in a fresh Node process, with the same secret, policy and explicit test schema. It performs one finalization/cleanup pass. Its guards require a random test-schema name and disposable localhost port. Restart/concurrent-worker tests invoke it directly.
- **Cleanup:** The helper drops only the newly created random schema in finally. It never deletes the existing development database's manually created events. If the operating system kills a process before finally, inspect/remove only the orphan random schema inside this disposable container or stop this container.

The scripts assert zero counted known-bot/invalid-session events, zero finalized events from the demonstrated rapid burst, and preserved legitimate fixtures. They also assert that 20 slow automated clicks and 20 independent one-click sessions **remain accepted**: disguising that limitation would make the comparison misleading. The precise synchronized-sequence detector is tested separately with both automated and indistinguishable classroom fixtures, including its false-positive boundary.

## Phase 2.1 additions

Current policy details and drain/rollback commands are in [Phase 2.1](../../docs/live-usage-bot-protection-phase2-1.md). Use a separate disposable instance, for example the same Docker command above with a distinct name and `127.0.0.1:33327:3306`, then:

```sh
LIVE_USAGE_TEST_MYSQL=disposable LIVE_USAGE_TEST_MYSQL_PORT=33327 npm run test:phase2
LIVE_USAGE_TEST_MYSQL=disposable LIVE_USAGE_TEST_MYSQL_PORT=33327 npm run test:usage
LIVE_USAGE_TEST_MYSQL=disposable LIVE_USAGE_TEST_MYSQL_PORT=33327 npm run test:live-usage
LIVE_USAGE_TEST_MYSQL=disposable LIVE_USAGE_TEST_MYSQL_PORT=33327 npm run simulate:live-usage
```

The current runner adds five independent educator contexts with different sequences, five tightly synchronized contexts with both educator and automated labels, and 601 credentialless requests followed by five credentialed educators. The synchronized fixtures suppress link navigation only in their local fixture to avoid popup overhead; real trusted Chrome clicks still travel through the actual tracker/router/controller and MySQL finalizer. The normal navigation regressions remain. Server receipt timestamps are real; synchronization spread is asserted through the actual coordination outcome, without changing detector thresholds. Deterministic evaluator tests additionally replay an exactly identical timestamped trace under both labels. Only the finalizer clock advances after traffic.

`immediateCounted` and `immediateReasons` describe the **current** preliminary classifier on that trace. They are not a frozen Phase 1 or Phase 2 rerun. `newCounted` is the actual number of official database rows after Phase 2.1 finalization. Historical before/after comparisons are labeled separately in the Phase 2.1 report. The output defaults to `/tmp/splice-phase21-comparison.json`; prior Phase 2 JSON is not overwritten. Labels are scoped to each asynchronous HTTP request and are never detector inputs.

Synchronized educator and automated traces both produce 25 accepted coordination observations. This is the documented ambiguity, not a failed automation assertion. Existing student fixtures remain as regression coverage; educators are the catalog's primary intended users. Known bots and missing credentials are rejected before durable admission, so those attempts have aggregate preliminary reasons but no terminal ledger rows. HTTP 202/PENDING is temporary and never an official count; REVIEW/REJECTED/EXPIRED are terminal exclusions, ACCEPTED has one official insert, and duplicate delivery is reported separately with no additional insert.
