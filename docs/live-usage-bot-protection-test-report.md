# Local implementation and test report

Branch: `feat/live-usage-bot-protection`. Review date: November 6, 2026 (America/New_York). All changes are uncommitted. No push, merge, deployment, application-database access, historical import, or production change was performed. The previously clean worktree was attached to the existing feature branch; the branch tip was not moved. The original workspace also has this branch checked out, and its working files were not edited.

Protection defaults to **off**, including production. Run the application locally with `LIVE_USAGE_MODE=enforce` and its exact `LIVE_USAGE_ORIGIN` to evaluate filtering. See [setup, configuration, architecture and production requirements](live-usage-bot-protection.md).

## Executed verification

Final command results are recorded below. Node's test counts include parent tests and nested scenarios; browser scenarios overlap between the two commands, so these totals must not be summed as unique tests.

| Command                   |          Passed | Failed | Skipped | Result |
| ------------------------- | --------------: | -----: | ------: | ------ |
| `npm run build`           | Build succeeded |      0 |       0 | PASS   |
| `npm run test:usage`      |              70 |      0 |       1 | PASS   |
| `npm run test:live-usage` |              61 |      0 |       2 | PASS   |

Exact files executed by `test:usage`: `historical-usage.test.mjs`, `historical-seed.test.mjs`, `usage-analytics.test.mjs`, `usage-browser.test.mjs`, `usage-dashboard.test.mjs`. Historical tests use fixtures/repository doubles; no real import was run.

Exact files executed by `test:live-usage`: `live-usage-protection.test.mjs`, `live-usage-integration.test.mjs`, `usage-browser.test.mjs`. All commands also type-check the TypeScript project. Chrome was available at the existing macOS executable path. Tests required sandbox elevation for loopback listeners and Chrome launch; the initial sandbox-only attempt could not bind a server.

The unit file independently passed 31/31 tests. It covers known clients, unknown/private browsers, credentials/origin, strict threshold boundaries, window recovery, deliberate repeats, replay concurrency, session expiration/renewal/network changes, bounded memory, capacity, modes, configuration errors, API policy, aggregate privacy and controlled bot simulations.

HTTP integration uses real Express routing/controllers and TypeORM service calls with repository doubles. Puppeteer uses real Chrome, existing EJS views and tracking scripts, actual HTTP POST receipt, and the same repository-double write path. **These results do not establish real MySQL persistence.** Docker was installed but its daemon was stopped; no local `mysqld` binary was found. Two opt-in MySQL checks (HTTP and browser row counts) are skipped in the protection command; the overlapping browser MySQL check is also skipped in the regression command. The fixture for those checks creates only a new random test schema on an explicitly configured disposable localhost MySQL port, writes through real TypeORM repositories, compares counts, and removes that schema. No unexecuted database check is reported as passing.

## Scenario outcomes

“Write” below means a successful repository-double save unless explicitly identified as a MySQL check.

| Test scenario                                 | Expected                                         | Actual                                                                                                 | Pass/Fail |
| --------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------- |
| Legitimate browser entry click                | Counted once                                     | Authenticated POST reaches server; one ENTRY_CLICK save                                                | PASS      |
| Known bot request                             | Not counted                                      | Recognized bot POST saves zero; API results still available                                            | PASS      |
| Repeated fake POST without credentials        | Not counted                                      | 20 direct/alternate-route attempts rejected; zero writes                                               | PASS      |
| Exact replay under concurrent requests        | First eligible event once                        | One write; 19 EVENT_REPLAY rejections from 20 simultaneous requests                                    | PASS      |
| Normal navigation during known bot traffic    | Counted                                          | 50 bot HTTP requests rejected; normal session still writes once                                        | PASS      |
| Legitimate external resource activation       | Counted once; resource opens                     | All three catalog types write canonical EXTERNAL_CLICK; resource navigation succeeds                   | PASS      |
| Explicit web search / bot web search          | Human-like submission counted / bot excluded     | Normalized WEB search written once; known bot adds zero                                                | PASS      |
| Repeated deliberate search submissions        | Each counted below threshold                     | Existing three-submit browser scenario retains three WEB writes                                        | PASS      |
| Public API scripted search                    | Completed API request eligible                   | curl/Python counted below API rate threshold; crawler and excess IP requests excluded                  | PASS      |
| Catalog/detail GET and refresh                | No clicks                                        | Zero writes from direct detail access, iframe load and reload                                          | PASS      |
| Keyboard, modifier, middle-click              | One event per activation                         | Exactly one write per activation; navigation preserved                                                 | PASS      |
| Multiple tabs and rapid navigation            | Eligible distinct activations counted            | Two tabs submit separate IDs using shared session; both written                                        | PASS      |
| Expired session recovery                      | Old event rejected, renewal restores eligibility | HTTP expiration/renewal passes; Chrome external click renews and counts, then detail navigation counts | PASS      |
| Cross-origin/invalid token/missing provenance | No writes                                        | Rejected; same-origin Referer fallback works                                                           | PASS      |
| Oversized/form/compressed/malformed payload   | Rejected before broad parser                     | 413/415/400; zero writes                                                                               | PASS      |
| Invalid catalog identifiers                   | No writes                                        | 400/404; zero writes                                                                                   | PASS      |
| Spoofed forwarded IP                          | Ignore untrusted XFF                             | Loopback remains client by default; explicit proxy trust selects nearest untrusted forwarded address   | PASS      |
| Storage or detector error                     | No corrupt/duplicate counts                      | counted:false; same failed ID cannot be replayed; fresh eligible ID can count                          | PASS      |
| Failed tracking request                       | Browsing works                                   | Detail/resource navigation survives HTTP 503, rejected fetch and synchronous fetch failure             | PASS      |
| Shared-NAT high IP rate                       | Review without declaring abuse                   | Third attempt at synthetic IP limit 2 gets REVIEW; window expiration restores acceptance               | PASS      |
| Browser User-Agent rotation                   | Review unusual session change                    | SESSION_UA_CHANGED; no enforce write                                                                   | PASS      |
| Real MySQL counters                           | Accepted rows only                               | Not executed: local database unavailable                                                               | SKIPPED   |

## Controlled attack measurements and limits

- Known-client simulation: Googlebot, Bingbot, Bytespider, AhrefsBot, curl, Python requests, HeadlessChrome, PhantomJS and sqlmap are rejected under browser policy. Ordinary API scripts are intentionally permitted under API policy.
- Known-bot coexistence: 1,000 recognized-bot classifications leave a normal session eligible; separate HTTP test rejects 50 bots while accepting a normal click.
- A valid-session browser-like burst of 20 distinct entries contributes **12 ACCEPT and 8 REVIEW** with defaults. Already accepted events are not retroactively removed. This is a measured false-negative allowance, not complete attack prevention.
- A distributed simulation of **100 valid sessions/IPs making one low-volume request each accepts all 100**. Individual-request signals cannot reliably distinguish them from legitimate users. Cross-IP aggregate analysis/shared infrastructure is documented as future work.
- Exact replay produces one eligible classification from 20 simultaneous requests, but new event IDs and fresh sessions can evade exact deduplication. Credentials and `isTrusted` browser checks are not human attestation.
- Shared NAT, suppressed Origin/Referer, accessibility/browser automation, fast legitimate repeats, UA changes, unavailable state and state-capacity attacks can withhold valid events. Disguised uncredentialed floods can trigger IP review for co-located users; known bots do not consume that budget.
- Unload delivery remains best effort. Expiration or a cold cookie race during unload can lose an event. DB errors consume an event ID before saving, favoring at-most-once attempts over guaranteed delivery. Distributed production needs shared atomic classification state; crash-safe exactly-once persistence additionally needs a unique database ingestion key/transactional design. Details are in the implementation guide.

Initial failures were resolved before final verification: sandbox server-bind restrictions; browser-fixture external requests/tab focus; a page-only UA override that did not apply to popup requests during expiration; and an exact-payload dashboard fixture that needed to validate the new event ID. Existing query/navigation/count assertions remain; no assertion was removed to conceal a failure.

## Files and diff

Existing files changed: `env.example`, `package.json`, `src/app.ts`, `src/controllers/SearchController.ts`, `src/controllers/UsageController.ts`, `src/public/js/usageTracking.js`, `src/routes/usage.ts`, `src/views/partials/header.ejs`, `tests/usage-analytics.test.mjs`, `tests/usage-browser.test.mjs`, `tests/usage-dashboard.test.mjs`.

New files: `src/services/LiveUsageBotProtection.ts`, `src/middleware/liveUsageProtection.ts`, `tests/live-usage-protection.test.mjs`, `tests/live-usage-integration.test.mjs`, `tests/helpers/live-usage-mysql.mjs`, `docs/live-usage-bot-protection.md`, this report.

Diff summary: 18 files (11 modified, 7 new), 1,495 insertions and 45 deletions, including the untracked new files. No entity, migration, aggregation/CSV implementation, historical service/import, or Nginx file changed. No new package dependency was introduced. Existing installed dependencies were temporarily reused through a local symlink for testing; that symlink is removed before handoff.
