# SPLICE Catalog — Phase 3B: Behavioral Analysis Prototype Results

Date: **November 8, 2026** (America/New_York). Checkout: `/Users/tusharchhabra/Documents/Research/splice-catalog`, existing branch `feat/live-usage-bot-protection`, base commit `8a0f204a7aba673cf2c2d6a3b0fe600c937f3873`. The Phase 3A research was read before implementation. This is an **offline, observation-only experiment**, with no production integration.

## Finding

**The evidence is insufficient to justify new blocking rules.** Longer histories describe sustained activity and repeated traversal that short burst windows miss, but the same signals occur in legitimate controls. A professor-labeled and bot-labeled trace with identical evidence produced identical features, explanations and baseline decisions. Adding combinations of these signals cannot distinguish that pair.

The unchanged baseline evaluator accepted all **1,300 slow/long bot-labeled events**, accepted all **557 professor-labeled events**, reviewed all 20 rapid-burst events and rejected the explicit known-automation control. These are offline evaluator outcomes mapped to lifecycle status names, **not actual official database writes**. The prototype added zero exclusions. No database was initialized, queried, migrated or written.

## Implementation and evidence contract

- [`src/analysis/SessionBehaviorObserver.ts`](../src/analysis/SessionBehaviorObserver.ts): standalone pure extractor and named observations; no IO or runtime imports. Its type-only dependency selects existing ledger fields: `id`, `sessionKey`, `kind`, `identityKey`, `receivedAt`, `reviewAfter`. There is no classifier score, decision output, official status input or fixture-label input.
- [`tests/helpers/phase3b-fixtures.mjs`](../tests/helpers/phase3b-fixtures.mjs): disposable in-memory traces, synthetic domain-separated HMAC identities, fixed catalog snapshots and comparison against the existing `evaluateProvisionalEvent`. Ground-truth labels stay outside extractor inputs. Baseline evaluation runs before and after extraction and must match, including reasons.
- [`tests/phase3b-behavior.test.mjs`](../tests/phase3b-behavior.test.mjs): 24 deterministic prototype tests, together with the existing 46 offline classifier/evaluator regressions.
- [`tests/phase3b-measure.mjs`](../tests/phase3b-measure.mjs): aggregate-only fixture outcomes and CPU/memory/timing measurements. Neither the app nor the browser/MySQL simulator is started.

For every target event, the two histories are **[reviewAfter − 5 minutes, reviewAfter]** and **[reviewAfter − 15 minutes, reviewAfter]**, both endpoints inclusive. `reviewAfter` is the event's stored review cutoff, not the time the offline script runs or a delayed worker eventually finalizes it. Fixtures preserve the existing **120,000 ms review delay**. Events arriving after the target receipt but before its review are intentionally visible; events beyond its review are not. Old evidence expires independently in each window. Ordering is `(receivedAt, id)` and only the target session contributes.

The immutable in-memory index copies the selected fields and timestamps; later mutation of input Dates, labels, payloads or statuses cannot affect analysis. Repeated extraction of the same ledger ID is deduplicated; conflicting duplicate IDs fail explicitly. Distinct ledger IDs on the same resource remain distinct interactions. This assumes an exported durable ledger in which retries already have one row; it is not a replacement for ingestion event-key validation.

Entry and external identity hashes are kind-separated in the real ledger. The extractor counts `(kind, identityKey)` pairs and limits traversal and catalog coverage to `ENTRY_CLICK`. It never infers an entry-to-external chain or joins hashes across kinds. WEB searches contribute only kind counts and event cadence; raw queries are not inspected. Output contains numeric summaries and fixed explanations, with no session/resource keys, IPs, UAs, credentials, tokens or queries. Exact as-of times are returned to the offline caller; the measurement runner exports aggregates only.

### Resource bounds and incomplete evidence

Input is capped at **100,000 rows**, each window at **5,000 rows**, and the optional catalog snapshot at **50,000 entry keys**. Oversized input/catalogs fail explicitly; a saturated window returns `WINDOW_CAPACITY`, its available-row count, null features and no observations. A saturated 15-minute history does not discard a usable 5-minute history. It never becomes an exclusion. Fresh construction and repeated analysis are deterministic; no persistent checkpoints or restart lifecycle are introduced.

Indexing sorts each session once; review lookup uses binary search, followed by a bounded window scan. Motifs have fixed length five, with no pairwise session comparison. Per-review work is O(log session rows + selected rows × 5), and temporary summaries are bounded by selected rows. Repeating this for many reviews still repeats work; this is not an incremental production observer.

`COMPLETE_INPUT` means all qualifying **supplied** rows were considered. It does not prove that retained/exported history is complete. No source watermark or database snapshot was available here. Early reviews naturally have shorter observed histories, and missing retained evidence cannot be treated as inactivity or humanity. Likewise, receipt timestamps alone do not establish transaction commit visibility; this experiment assumes supplied evidence was available by its stated server timestamp. A real exported dataset would need a consistent as-of availability contract.

Coverage requires a fixed eligible ENTRY identity snapshot dated at or before the review. Missing, empty or future snapshots yield unknown coverage (`null`). Only identities in that snapshot enter the numerator; outside-snapshot identities are reported separately. No denominator is estimated from visited resources, numeric ID ranges or a future catalog. The fixtures use hypothetical 100-item catalogs, except the held-out 137-item catalog; they do not measure the live catalog.

### Exploratory observations (version `phase3b-offline-v1`)

These fixed parameters describe patterns and have no enforcement meaning. They were not optimized against production data or a representative educator sample.

| Observation               | Explicit criteria and explanation                                                                                                                                                                                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUSTAINED_ACTIVITY`      | At least 10 events per full window-minute, event span at least 80% of the window, at least 80% occupied one-minute buckets, and maximum inter-event gap at most 30 seconds. Explanation includes count, span, rate, active buckets and maximum gap. Buckets are relative to the window start; the closed upper endpoint belongs to the last bucket. |
| `REPEATED_TRAVERSAL`      | An ordered motif of five distinct entry identities occurs at least three nonoverlapping times in the entry subsequence. Explanation gives motif length and maximum occurrence count. Other event kinds are excluded from that subsequence. This is claimed-entry traversal, not verified page navigation.                                           |
| `BROAD_RESOURCE_COVERAGE` | At least 20 eligible entry identities and at least 80% of the fixed known catalog covered. Explanation gives numerator and denominator. Small catalog breadth alone cannot trigger it below 20 items.                                                                                                                                               |
| `REGULAR_CADENCE`         | At least ten gaps, positive mean gap and population coefficient of variation at most 0.1. Explanation gives gap count and CV. All-zero gaps have undefined CV. Regularity is descriptive and is excluded from the behavioral would-flag diagnostic below.                                                                                           |

Features also include event-kind counts, distinct kind/identity pairs, distinct entries, repeated entry-event count, maximum motif occurrences and outside-snapshot entries. Sustained activity uses observed event span, not session age or presumed active attention. A long idle gap fails the sustained criteria.

## Executed verification

Run from the existing feature checkout:

```sh
npm run test:phase3b
npm run --silent measure:phase3b > /tmp/splice-phase3b-measurements.json
./node_modules/.bin/eslint src/analysis/SessionBehaviorObserver.ts
./node_modules/.bin/prettier --check src/analysis/SessionBehaviorObserver.ts tests/phase3b-behavior.test.mjs tests/phase3b-measure.mjs tests/helpers/phase3b-fixtures.mjs
git diff --check
```

`test:phase3b` first runs the project's TypeScript checker with `--noEmit`, then uses the existing Node test/ts-node infrastructure on `phase3b-behavior.test.mjs`, `live-usage-protection.test.mjs` and `phase2-evaluator.test.mjs`. The new test/measurement commands set `DOTENV_CONFIG_PATH=/dev/null`, `LIVE_USAGE_MODE=off`, `LIVE_USAGE_PROVISIONAL_ENABLED=false`, `LIVE_USAGE_TEST_MYSQL=disabled` and the existing ts-node resolver flags. The baseline test instances explicitly construct enforce-mode policies. No MySQL/browser test helper is invoked; no disposable database is needed for these disposable array fixtures.

**Result: TypeScript check passed; 70 tests passed, 0 failed, 0 skipped.** Extractor lint, new-code formatting and whitespace checks passed. The final Node test run took 937.994 ms (excluding TypeScript startup/checking). Test log: `/tmp/splice-phase3b-tests.log`; aggregate measurement output: `/tmp/splice-phase3b-measurements.json`. Existing ts-node loader/deprecation warnings were nonfatal.

Coverage includes exact closed-window boundaries, future evidence invariance, receipt-versus-review cutoff, expiration, foreign-session isolation, shuffled input, tied timestamps, kind separation, retry-row deduplication versus deliberate repeats, conflicting IDs, fixed/missing/empty/future catalog snapshots, nonoverlapping motif requirements, idle intervals, mutation/privacy checks and all three capacity bounds. All fixture receipts fall within the existing 30-minute credential lifetime; review may occur later. The rapid-burst regression still withholds the earliest pending events.

All event timestamps are **virtual**, from a fixed epoch. There were no real 3–5-second sleeps and no real two-minute visibility experiment. This validates time-window logic, not browser delivery or admission-to-commit latency. MySQL, lock/transaction behavior, production ingestion, policy switching and browser integrations were not rerun because the prototype does not modify them and must not touch the running development DB.

## Measured fixture outcomes

Each row is a separate synthetic session; classes are harness intent labels, not authenticated professors or verified real bots. Standard slow spacing cycles through 3/4/5 seconds. Randomized slow spacing uses seeded uniform 3–5-second gaps and seeded item choices. The 24-minute script loops through 30 resources at four seconds. Course preparation mixes ENTRY/EXTERNAL/WEB events with 8–28-second gaps across 30 resources. Repeated legitimate use cycles through five entries every 15 seconds. The matched pair cycles through 100 entries every four seconds with **byte-identical evidence** and different harness labels.

The held-out schedules were declared before measurement and used unchanged parameters: bot seeds 71/97, 3.5–5.5-second gaps and random choices from 137 entries; professor catalog audit visits all 137 entries once at six seconds. This is a small additional synthetic check, not independent field validation. Main random bot seeds are 7/17; course preparation uses seed 31. The generator is a deterministic 32-bit linear congruential PRNG.

“Observed reviews” counts target events with any observation in either window. “Behavioral would-flag” counts target events with at least one sustained/traversal/coverage observation, excluding cadence-only observations. It is an explanatory **review-context diagnostic**, not a proposed exclusion rule or proof that the target interaction participated in a motif. “Observations” counts every `(target review, window, pattern)` output; overlapping windows/reviews intentionally repeat patterns.

| Fixture                                       |    Events | Baseline outcome, unchanged               | Observed reviews | Behavioral would-flag | Observations |
| --------------------------------------------- | --------: | ----------------------------------------- | ---------------: | --------------------: | -----------: |
| Slow automation, 3–5 seconds (76 s span)      |        20 | 20 ACCEPTED                               |                0 |                     0 |            0 |
| Sustained automation, 3–5 seconds (957 s)     |       240 | 240 ACCEPTED                              |              210 |                   210 |          533 |
| Randomized slow automation (958.965 s)        |       240 | 240 ACCEPTED                              |              209 |                   209 |          365 |
| Long-running scripted loops (1,436 s)         |       360 | 360 ACCEPTED                              |              360 |                   330 |        1,878 |
| Professor course preparation (1,648.768 s)    |        90 | 90 ACCEPTED                               |                0 |                     0 |            0 |
| Repeated legitimate interactions (1,335 s)    |        90 | 90 ACCEPTED                               |               88 |                    84 |          342 |
| Professor intensive, matched evidence (956 s) |       240 | 240 ACCEPTED                              |              240 |                   210 |        1,013 |
| Bot intensive, matched evidence (956 s)       |       240 | 240 ACCEPTED                              |              240 |                   210 |        1,013 |
| Existing rapid burst (0.95 s)                 |        20 | 20 REVIEW                                 |               20 |                     0 |           40 |
| Explicit rejection control                    |         1 | 1 REJECTED                                |                0 |                     0 |            0 |
| Held-out random slow automation (896.940 s)   |       200 | 200 ACCEPTED                              |              173 |                   173 |          225 |
| Held-out professor catalog audit (816 s)      |       137 | 137 ACCEPTED                              |              137 |                   108 |          411 |
| **Total**                                     | **1,878** | **1,857 ACCEPTED; 20 REVIEW; 1 REJECTED** |        **1,677** |             **1,534** |    **5,820** |

### Observation counts by pattern

| Pattern            | 5-minute outputs | 15-minute outputs |     Total |
| ------------------ | ---------------: | ----------------: | --------: |
| Sustained activity |            1,343 |               635 |     1,978 |
| Repeated traversal |              389 |               581 |       970 |
| Broad coverage     |                0 |               702 |       702 |
| Regular cadence    |            1,085 |             1,085 |     2,170 |
| **Total**          |        **2,817** |         **3,003** | **5,820** |

The original 20 slow clicks supply no observation at these parameters and remain accepted. Longer 3–5-second traces and randomized traces supply sustained activity; the main randomized trace supplies 284 sustained and 81 coverage outputs, with **zero regular-cadence or traversal outputs**. Randomization removes regularity without preventing sustained-volume observations. The long script supplies 633 traversal outputs, but legitimate repeated use supplies 166 traversal outputs too. The held-out random trace supplies sustained activity without broad coverage or repeated motifs.

The held-out professor catalog audit supplies **89 sustained** and **48 coverage** outputs. Breadth and sustained rate are therefore not unique to the automated fixtures. The intensive matched pair each supplies 285 sustained, 57 traversal, 191 coverage and 480 cadence outputs. Its entire observation list, numeric features and explanations are identical across labels.

### False positives, accepted automation and discrimination

Official decision behavior is unchanged: **0/557 additional professor exclusions**, **1,300/1,321 bot events still ACCEPTED**, 20 existing burst reviews, one explicit baseline rejection. No expiry, undelivered, pending or storage-failure events are present in these fully resolved evaluator fixtures; those real-system losses are unmeasured, not successful bot detection.

If the behavioral would-flag diagnostic were incorrectly treated as an exclusion, it would flag **402/557 professor contexts (72.17%)** and **1,132/1,321 bot contexts (85.69%)**. Its synthetic precision would be **1,132/(1,132+402) = 73.79%**, with 189 bot contexts unflagged. These are overlapping review-context counts and selected fixture proportions, not independent samples, calibrated error rates or a production precision estimate. Cadence-only findings are excluded from those numbers; including them would add further legitimate overlap.

The low-rate professor preparation fixture differs from the sustained automation fixtures. That limited separation disappears against intensive preparation, repeated legitimate workflows and a catalog audit. No tested signal is automation-specific. Even the joint signal vector cannot distinguish the matched professor/bot evidence. A longer time series supplies descriptive evidence about activity, not independent evidence of human intent.

## Performance measurements

One local run on **Apple M3 Pro, darwin arm64, Node v24.13.0**, with explicit GC available. Measurements ran separately after the test/check processes finished. These are monotonic wall-clock timings and process CPU measurements of offline work, not simulated timestamp durations. No performance pass/fail threshold was tuned from this run.

The 10,000/100,000-row inputs contain 100 events per session, spaced four seconds apart, on 100/1,000 sessions. Each benchmark analyzes 1,000 deterministic targets, producing both historical windows per call; the extractor gets 100 warm-up calls. The baseline evaluator is measured separately on the same targets and corresponding session evidence. This is a session-only CPU baseline; optional cohort retrieval/evaluation and the rest of the finalizer path are excluded. There are no database query timings hidden in these figures. Fixture construction is outside index timing; the indexed observer holds only selected fields.

| Input                         | Index wall / CPU ms | Baseline p50 / p95 / p99 / max ms | Extractor p50 / p95 / p99 / max ms | Extractor 1,000 calls: wall / CPU ms |
| ----------------------------- | ------------------- | --------------------------------- | ---------------------------------- | ------------------------------------ |
| 10,000 rows / 100 sessions    | 2.113 / 2.413       | 0.0364 / 0.0488 / 0.0947 / 0.1722 | 0.1486 / 0.1738 / 0.1985 / 0.2950  | 136.028 / 144.662                    |
| 100,000 rows / 1,000 sessions | 19.364 / 20.778     | 0.0517 / 0.1422 / 0.1841 / 0.3613 | 0.1525 / 0.1836 / 0.1977 / 0.3836  | 139.124 / 139.213                    |

Baseline CPU for 1,000 calls was 46.702 / 73.348 ms respectively. Extractor throughput was approximately **7,351 / 7,188 review calls per second** on these specific small-session arrays; it is not service or ingestion throughput. The baseline uses its existing shorter horizon while the prototype intentionally does more historical work. Order/JIT/GC and other host load affect such small timings; this is a single local run with no confidence interval.

After explicit GC, incremental indexed heap was **1.54 MiB** for 10,000 rows and **14.56 MiB** for 100,000 rows, excluding the original fixture arrays. Post-query retained heap change was approximately **79.1 KiB / 43.8 KiB**, not evidence of a persistent observation sink. Whole-process RSS before indexing / after indexing / after queries was **267.12 / 268.20 / 268.30 MiB**, then **419.20 / 426.33 / 436.39 MiB**. RSS includes ts-node, earlier measurements and fixture allocations; deltas are not a precise per-row storage estimate or peak-memory guarantee.

Two additional bounds were measured independently:

| Case                                   | Calls | p50 / p95 / p99 / max ms                  | Batch wall / CPU ms   |
| -------------------------------------- | ----: | ----------------------------------------- | --------------------- |
| Maximum 5,000 rows in each window      |   100 | 9.952 / 10.467 / 10.678 / 14.508          | 1,003.955 / 1,012.527 |
| 5,001 rows, both windows capacity-only | 1,000 | 0.000917 / 0.001291 / 0.004167 / 0.055125 | 1.166 / 2.500         |

The maximum-window case scans 5,000 rows twice per call. The roughly 14.5 ms observed maximum, repeated history scans and finite index size reinforce keeping this outside synchronous admission/finalization. Capacity handling is cheap because it counts the indexed range before extraction. Capacity is unknown observation coverage, not evidence for exclusion.

**Not measured:** SQL rows examined, table/index allocation, transaction hold/wait time, finalizer lag, official visibility p50/p95/p99, concurrent worker saturation, event-loop delay under real load and persistent restart recovery. No database aggregation or global lock was added; those quantities are unavailable here, not zero. Production headroom is not established by these CPU benchmarks.

## Documentation reconciliation and compatibility

The Phase 2 design, Phase 2.1 design, Phase 2.1 test report and bot-detection review named in Phase 3A remain absent. No historical report or outcome was fabricated. The surviving Phase 1 policy now explicitly labels its immediate-write/shared-IP descriptions historical and links to the current source audit and source files. The simulation README no longer links to a missing Phase 2.1 document as though it existed; its earlier output filename and Phase 1 comparison claims now agree with the actual current runner (`/tmp/splice-phase21-comparison.json`, current preliminary classifier versus finalized rows). The existing Phase 1 test report is preserved as historical evidence.

Only new offline analysis/test/measurement files, two npm scripts and documentation were changed. Existing controllers, routes, browser tracking, services, finalizer policy/version, entities and migrations were not edited. `ACCEPTED`, `REVIEW`, `REJECTED` behavior and the two-minute delay remain unchanged. No migration, schema change, production tracking/classification change, fingerprint, new telemetry, automatic exclusion, retention extension or cross-renewal identity was introduced. No branch/worktree was created, no commit/push/merge was made, and the pre-existing untracked Phase 3A research was preserved.

## Limitations and stopping point

These fixtures contain no representative field data, verified professor behavior, real browser navigation or independently verified bot identity. Fixed small catalogs, scripted schedules and chosen class proportions make accuracy estimates unsuitable for deployment. Temporal patterns are correlated views of the same click stream, not independent votes. Query semantics, attention, course outcomes, client click times and verified page history remain unavailable. Session rotation, slower traffic, randomized paths and deliberate human-matching behavior remain bypasses. No cross-session/cross-IP campaign observer or verification mechanism was implemented; this phase is limited to the requested same-session histories.

The prototype successfully describes longer activity, emits explicit explanations, exposes unknown/capacity states and preserves baseline decisions. It **does not demonstrate a reliable discriminator between slow automation and legitimate controls**. Keep these outputs offline. Any production observation service or enforcement proposal requires separate review of representative controls, data completeness, privacy and operational costs. **Stop here: no observations are integrated into production enforcement.**
