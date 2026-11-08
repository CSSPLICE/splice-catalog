# SPLICE Catalog — Phase 3C: Cross-Session Campaign Analysis

Date: **November 8, 2026** (America/New_York). Existing checkout: `/Users/tusharchhabra/Documents/Research/splice-catalog`, branch `feat/live-usage-bot-protection`, base commit `8a0f204a7aba673cf2c2d6a3b0fe600c937f3873`. The [Phase 3A research](live-usage-bot-protection-phase3-research.md) and [Phase 3B results](live-usage-bot-protection-phase3b-results.md) were read before implementation. This prototype is offline and observation-only.

## Finding and recommendation

**Cross-session correlation adds useful descriptive context, but it does not establish independent evidence of automation.** It finds shared paths and distributed breadth that the Phase 3B per-session structural signals miss on these short traces. Legitimate professors can generate the same patterns: the synchronized demonstration matches the scripted sequence campaign exactly, and independent topic review matches partitioned scripted traversal exactly. Randomized automation can also match an unflagged professor control exactly.

Six of eight bot-labeled fixtures produced campaign observations; two of five professor-labeled fixtures also did. These are **fixture-level pattern findings**, not verified bot detection. Four automated cases are metadata variants of the same sequence, and three professor/bot pairs intentionally share identical evidence; these are not independent statistical samples. No event-level bot precision is calculated from campaign observations.

**Recommendation: keep the observer offline. The evidence does not justify any new blocking, individual-session labeling or exclusion rule.** Useful next evidence would require independently validated context and representative educator controls, with separate review of collection and operational costs. This implementation does not authorize or introduce such collection.

## Implementation

- [`src/analysis/CampaignObserver.ts`](../src/analysis/CampaignObserver.ts) exports the stateless `observeCampaigns(evidence, request)` function and experiment version `phase3c-offline-v1`.
- [`tests/helpers/phase3c-fixtures.mjs`](../tests/helpers/phase3c-fixtures.mjs) generates disposable deterministic arrays and compares the unchanged delayed evaluator and Phase 3B observer on those arrays.
- [`tests/phase3c-campaign.test.mjs`](../tests/phase3c-campaign.test.mjs) exercises the experiments, ambiguity, unknown states, isolation and resource bounds.
- [`tests/phase3c-measure.mjs`](../tests/phase3c-measure.mjs) emits aggregate JSON with fixture results, explanatory observations, CPU, memory and runtime measurements.

The new observer has **no runtime imports or IO**. Type-only imports reuse existing provisional fields (`id`, `sessionKey`, `kind`, `identityKey`, `receivedAt`) and Phase 3B's catalog-snapshot type. It never reads networks, User-Agents, payloads, official statuses, reasons, credentials or ground-truth labels. There is no classifier score, participant list, inferred controller identity, individual-session label or exclusion decision in its output. The harness labels are used only after observation for measurement.

### Time and completeness contract

The caller supplies `asOf` and, separately, a source-history attestation `{from, through, complete}`. Analysis uses the last completed **one-minute boundary** at or before `asOf`, and closed **5- and 15-minute** windows ending there. Newer events, including events within the unfinished minute, are excluded. Rows are ordered by server-observed `(receivedAt, id)`. Exact duplicate ledger rows are deduplicated; conflicting duplicate IDs invalidate the analysis. There is no ingestion replay replacement or assumption that ID order establishes commit order.

The history attestation must cover the entire particular window and mark it complete. Missing, partial, lagging or explicitly incomplete history returns `INCOMPLETE_HISTORY`, null metrics and no observations for that window. One usable window can survive another window's missing history or saturation. A caller can lie about completeness; this prototype cannot detect omitted export rows. Receipt timestamps alone do not establish commit visibility. A real export would need a consistent availability/cutoff contract, not just a timestamp filter.

Known complete history with fewer than four entry sessions or twenty entry events returns `INSUFFICIENT_EVIDENCE`, with sample metrics and no observations. A usable aggregate can still have `INSUFFICIENT_SEQUENCE_HISTORY` when fewer than four sessions have five entry events. Missing, empty or future catalog snapshots produce `UNKNOWN_CATALOG` and null coverage; sequence analysis can remain usable. Invalid/conflicting rows or invalid history/catalog data return `INVALID_INPUT` with no observations. An invalid request `asOf` raises `INVALID_TIMESTAMP`, a caller-input error.

`COMPLETE` means that the bounded supplied history and relevant summaries were analyzed. It does not mean human, automated, harmless or conclusively uncoordinated. Family-level sequence/catalog states and issue codes must be considered alongside the window state.

Campaign snapshots are separate offline analyses, not delayed individual reviews. Fixtures retain their original `receivedAt + 120,000 ms` review times. The harness chooses a completed-minute snapshot after the last fixture review, with an explicitly complete synthetic history. The observer's minute resolution and snapshot schedule introduce **no change to the production two-minute review delay**.

### Exploratory patterns and explanations

Only `ENTRY_CLICK` identities enter sequences, session support or coverage. External clicks and WEB searches cannot supply entry evidence; cross-kind identity equality is not assumed. Every observation contains the window's entry-event/session sample sizes, a numeric explanation, fixed limitations and a stable upsert key.

| Pattern                        | Fixed exploratory criteria                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SHARED_ENTRY_SEQUENCES`       | A contiguous motif in the entry subsequence contains five distinct identities and appears in at least four sessions. Timing alignment is not required. Each session contributes at most once per motif, regardless of repeated loops. Explanation gives shared-motif count, maximum session support and overall sample sizes.            |
| `SYNCHRONIZED_TRAVERSAL`       | At least three shared motifs have at most 10,000 ms spread **at every one of their five steps**, using each session's earliest occurrence within the window. Each motif has at least four supporting sessions. The counts can overlap and are not independent traversals.                                                                |
| `DISTRIBUTED_CATALOG_COVERAGE` | At least twenty entries and 80% of a fixed eligible catalog covered; at least four contributing sessions; no single session covers more than 35% of that catalog. Explanation gives numerator/denominator, contributor count and largest single-session coverage. This is distributed breadth, not statistical proof of unusual traffic. |

A catalog denominator must be fixed and dated at or before the cutoff. Outside-snapshot entries are counted separately and never inflate the numerator. Denominators are not inferred from visited entries, numeric ID ranges or a future catalog. All experiment catalogs here are hypothetical 100-entry sets of synthetic keyed identities, not the running catalog.

Synchronization aggregates the earliest occurrence across **all** supporting sessions; one sufficiently delayed member can remove that synchrony finding, while the shared-sequence finding remains. It does not search every possible subset or later occurrence to find the most alarming alignment. This conservative choice bounds work but misses subgroups, later aligned loops and some delayed campaigns. Aggregate motifs can also come from different unrelated subgroups; the output does not establish one common cohort.

### Work, memory and output bounds

| Bound                         | Limit and outcome                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Input rows                    | 100,000, including non-entry and out-of-window rows; excess returns `CAPACITY` before extraction.             |
| Rows per window               | 20,000, including non-entry rows; excess returns `WINDOW_ROW_CAPACITY`.                                       |
| Entry sessions per window     | 2,000; excess returns `SESSION_CAPACITY`.                                                                     |
| Entry rows per session/window | 2,000; excess returns `SESSION_ROW_CAPACITY`.                                                                 |
| Distinct motifs per window    | 10,000; excess returns `MOTIF_CAPACITY`, rather than emitting a truncated finding.                            |
| Catalog input keys            | 50,000; excess returns `CATALOG_CAPACITY`.                                                                    |
| Observations                  | At most three per window, six per completed-minute snapshot; never one per motif, pair, participant or event. |

Capacity outcomes have null metrics and no partial observations. Partial work counters are bounded diagnostics, not confidence. Keys are bounded to 64 characters. Rows are normalized into selected fields, sorted once, then grouped by session. Motifs use an inverted hash map with fixed-length keys, not pairwise session matching. Expected work is O(N log N) for sorting plus O(W × 5) per window for selected rows; stored input, session buffers and motif summaries all have explicit bounds. `pairwiseComparisons` remains zero in the implementation and tests.

There is no cross-call cache, growing observation sink, identity graph, persistent cluster or cross-renewal linkage. The upsert key is `(version, completed minute, window duration, pattern)`: repeated or revised evaluation of the same snapshot uses the same key. A consumer would need to upsert, not append duplicate calls, and namespace independent experiment datasets. No consumer or production sink is implemented. Future minutes may legitimately produce further bounded snapshots; this is not indefinite alert suppression. The bounds limit logical work and cardinality, **not a hard process RSS ceiling**.

## Deterministic experiments and outcomes

All times are virtual. Each session is independently keyed. Synthetic network identities include keyed documentation-range address strings for one fixture; other fixtures use arbitrary synthetic identity labels. They are **not verified addresses, real routed IP diversity, distinct people or evidence of independent control**. UA identities likewise model declared strings, not authenticated software. Metamorphic tests vary and remove both fields without changing any campaign output.

Common scripted sessions each visit entries 0–11 at four-second spacing; session starts differ by 100 ms. The address and UA cases preserve those exact session/item/time observations. The intra-session UA-rotation case changes the declared agent identity every event, while the distinct-agent case holds one different UA per session. The delayed fixture shifts session starts by twenty seconds each. The randomized fixture uses a deterministic shuffled 100-item list per session (seed 137), taking twelve items, and 3.5–7-second gaps (seed 71), with eight-second session offsets.

Partitioned traversal assigns ten distinct entries to each of ten sessions at seven-second spacing, covering all 100 entries. The professor topic fixture is an exact clone. Independent professors cover separate twelve-item selections at eleven-second spacing. Popular-resource use rotates among three entries across twelve sessions at nine-second spacing. Sparse automation rotates across twenty one-event sessions. All receipts fall within the existing credential lifetime; no browser credential or network verification was exercised.

Each scenario is evaluated once at its campaign snapshot, with two histories. `S`, `T`, and `C` mean shared sequences, synchronized traversal and distributed coverage. An output in both histories counts twice in the observation column. Phase 3B totals below are **per-event review/window outputs on the new arrays**, not campaign observations or replacements for its original results.

| Fixture                                    | Harness class    | Sessions / events | Campaign patterns                   | Campaign observations | Phase 3B observations |
| ------------------------------------------ | ---------------- | ----------------: | ----------------------------------- | --------------------: | --------------------: |
| Scripted, shared synthetic network         | Bot              |            6 / 72 | S, T                                |                     4 |           144 cadence |
| Scripted, six synthetic addresses          | Bot              |            6 / 72 | S, T                                |                     4 |           144 cadence |
| Scripted, six distinct declared UAs        | Bot              |            6 / 72 | S, T                                |                     4 |           144 cadence |
| Scripted, UA identity rotating per event   | Bot              |            6 / 72 | S, T                                |                     4 |           144 cadence |
| Partitioned catalog traversal              | Bot              |          10 / 100 | C                                   |                     2 |                     0 |
| Delayed identical sequences                | Bot              |            6 / 72 | S                                   |                     2 |           144 cadence |
| Randomized order and delay                 | Bot              |            6 / 72 | None                                |                     0 |                     0 |
| Sparse rotating sessions                   | Bot              |           20 / 20 | None; insufficient sequence history |                     0 |                     0 |
| Independent simultaneous professors        | Professor        |            6 / 72 | None                                |                     0 |           144 cadence |
| Synchronized professor demonstration       | Professor        |            6 / 72 | S, T                                |                     4 |           144 cadence |
| Popular resources                          | Professor        |          12 / 120 | None                                |                     0 |                     0 |
| Different professor topics                 | Professor        |          10 / 100 | C                                   |                     2 |                     0 |
| Professor matched to randomized automation | Professor        |            6 / 72 | None                                |                     0 |                     0 |
| **Total**                                  | **13 scenarios** |    **988 events** | **12 S; 10 T; 4 C**                 |                **26** |     **1,008 cadence** |

### Explanatory evidence and false positives

- Common scripted paths: **72 entry events, six sessions, twelve distinct entries, eight shared motifs, eight synchronized motifs, maximum support six** in each history. The eight motifs are overlapping views of a twelve-step path. Replacing one shared network identity with six synthetic addresses, replacing common UAs with six distinct ones, rotating agents each event or omitting network/agent metadata entirely yields identical campaign output.
- Delayed scripts: the same eight shared motifs and support six, but **zero synchronized motifs** because corresponding steps span 100 seconds across sessions. Shared paths remain observable without synchronized clocks or common metadata.
- Partitioned scripts: **100/100 entries**, ten contributing sessions, **10% maximum individual coverage**, no shared motifs. The prototype observes aggregate breadth that no single-session coverage check reaches.
- Randomized automation: **55/100 entries**, no shared motifs and maximum motif support one. No campaign observation is produced. The matched professor evidence produces the same output, including explanations and keys.
- Sparse automation: twenty entries across twenty sessions, 20% coverage, zero sequence-eligible sessions. Sequence evidence is explicitly insufficient, not evidence that the activity is human.
- Professor demonstration: **the complete observation output is identical to the common scripted fixture**. Its four outputs are a legitimate activity pattern incorrectly flagged as campaign-like if interpreted as an automation alert.
- Different professor topics: **the complete output is identical to partitioned automation**. Two coverage outputs cannot distinguish ordinary catalog breadth from coordinated division of work.
- Independent professor and popular-resource controls produce no campaign observations here. The popular control has 120 events but only three distinct entries, so it cannot supply a five-distinct-entry motif. A popular multi-item curriculum or demonstration can still supply such motifs; this control does not establish general popularity immunity.

Thus **six bot-labeled scenarios produce twenty observations**, and **two professor-labeled scenarios produce six observations**. Two bot scenarios produce none. These counts describe deliberately selected, related fixture cases and overlapping windows. They do not estimate field precision, sensitivity, causal coordination or an event-level false-positive rate. An alert cannot identify which, if any, individual events were automated. No campaign-alert count is translated into event-level bot-detection precision.

The unchanged offline baseline evaluator returns **916 ACCEPTED and 72 REVIEW** across these arrays. The 72 reviews are the existing retrospective within-session UA-change policy in the agent-rotation fixture. Distinct UAs between sessions do not trigger that policy. Before/after baseline results, including reasons, are equal. There are **zero new exclusions and zero actual official writes** in this experiment; these status names are pure evaluator outcomes, not measured database persistence.

### Comparison with Phase 3B

On these new, short per-session traces, Phase 3B emits 1,008 cadence outputs and **zero sustained-activity, repeated-traversal or coverage outputs**. Phase 3C exposes shared paths across actors and aggregate coverage that individual histories do not contain. This is additional information about relationships, not a faster or more accurate replacement for Phase 3B. Campaign snapshots and event review contexts have different units and cutoffs; their output counts must not be interpreted as comparable detection rates.

Phase 3B's original source, fixtures, tests, measurement runner and report were preserved byte-for-byte, as was the Phase 3A research. Its prior results and limitations remain valid. Neither prototype supplies an independent witness of intent: both derive observations from the same claimed interaction stream. The positive and negative identical-label controls demonstrate the remaining identification boundary.

## Tests executed

From the existing feature checkout:

```sh
npm run test:phase3c
npm run --silent measure:phase3c > /tmp/splice-phase3c-measurements.json
./node_modules/.bin/eslint src/analysis/CampaignObserver.ts
./node_modules/.bin/prettier --check src/analysis/CampaignObserver.ts tests/phase3c-campaign.test.mjs tests/phase3c-measure.mjs tests/helpers/phase3c-fixtures.mjs
git diff --check
```

**TypeScript no-emit check passed. All 102 tests passed, zero failed, zero skipped:** 32 new Phase 3C tests, all 24 Phase 3B tests and the existing 46 offline classifier/delayed-evaluator regressions. Final Node test duration was **1,201.218 ms**, excluding TypeScript startup/checking. New observer lint, new-code formatting and whitespace checks passed. The earlier coverage-test failure was a fixture assertion using the five-minute window for a longer trace; it was corrected to inspect the complete fifteen-minute history. No production behavior was changed to satisfy it.

Coverage includes all thirteen required/control scenarios, three exact professor/bot pairs, metadata invariance, partial/missing history, incomplete sequence evidence, fixed/missing/empty/future catalogs, timestamp boundaries, non-entry isolation, tied/shuffled rows, input immutability, duplicate/conflicting ledger rows, bystander support isolation, every capacity bound and the exact 10,000-motif boundary. Maximum-volume tests process 20,000 events from 2,000 sessions with zero pairwise comparisons and fixed output cardinality. Existing rapid-burst, replay, invalid-traffic isolation and identical-trace regressions pass.

The npm commands use existing Node/ts-node infrastructure and explicitly set `DOTENV_CONFIG_PATH=/dev/null`, `LIVE_USAGE_MODE=off`, `LIVE_USAGE_PROVISIONAL_ENABLED=false`, `LIVE_USAGE_TEST_MYSQL=disabled` and the existing resolver/transpile flags. Enforce-mode baseline test instances are explicit. No MySQL/browser helper, application server, external service or running development database is used. Event timing is virtual, without real inter-click sleeps or a real two-minute visibility measurement. Existing ts-node loader/deprecation warnings are nonfatal.

Logs and aggregate output: `/tmp/splice-phase3c-tests.log`, `/tmp/splice-phase3c-measurements.json`, `/tmp/splice-phase3c-measurements.stderr`. The JSON exports aggregate sizes, metrics, explanations and synthetic harness classes, not raw identities, addresses, UAs, query contents or credentials.

## Performance measurements

One isolated local measurement run after tests/checks finished: **Apple M3 Pro, darwin arm64, Node v24.13.0**, explicit GC exposed. Each case has three warm-up calls and **25 measured calls**. Each call includes normalization, deduplication, sorting, both historical windows and observation construction. Input fixture generation is outside timing. Wall-clock per-call percentiles use a monotonic clock; batch CPU includes automatic GC and light measurement overhead, while explicit pre/post-batch GC is outside batch timing. With only 25 samples, the reported p99 is the maximum, not a stable tail-latency estimate.

The main scaling cases use ten entry events per session on an identical path, with one-second spacing and common start time. They therefore stress many session contributions but have only six distinct motifs. The retained-input case adds 80,000 older rows from 8,000 additional sessions outside both windows; 20,000 rows and 2,000 sessions remain active. High-cardinality cases separately exercise 10,000 unique motifs and an attempted 10,001st motif. No benchmark runs the baseline finalizer, SQL, locks or network operations.

| Case                                       | Input rows / sessions | p50 / p95 / p99=max ms per call | 25-call wall / CPU ms | Window outcomes            |
| ------------------------------------------ | --------------------: | ------------------------------- | --------------------- | -------------------------- |
| Shared-path scaling                        |           1,000 / 100 | 1.479 / 1.611 / 1.674           | 37.262 / 51.408       | Complete                   |
| Shared-path scaling                        |           5,000 / 500 | 6.187 / 7.985 / 8.248           | 159.693 / 185.014     | Complete                   |
| Shared-path scaling                        |        10,000 / 1,000 | 12.761 / 13.985 / 14.043        | 322.428 / 334.188     | Complete                   |
| Maximum active rows and sessions           |        20,000 / 2,000 | 26.902 / 28.385 / 29.747        | 671.714 / 688.136     | Complete                   |
| Maximum retained input, 20,000 active rows |      100,000 / 10,000 | 40.717 / 44.754 / 45.028        | 1,011.492 / 1,130.270 | Complete                   |
| Window-row saturation                      |        20,010 / 2,001 | 3.070 / 5.024 / 6.074           | 81.472 / 98.192       | Capacity, no observations  |
| Exact 10,000 distinct motifs               |          10,400 / 100 | 23.348 / 24.671 / 25.106        | 581.927 / 626.148     | Complete, no shared motifs |
| Motif saturation                           |          10,500 / 100 | 22.462 / 23.345 / 23.945        | 565.150 / 579.897     | Capacity, no observations  |

At maximum active volume, each window considers **12,000 motif candidates** and stores only six distinct motifs. The unique-motif case stores exactly 10,000; saturation stops at that bound before emitting any finding. No case performs session-pair enumeration. Shared-path output size stays approximately **4.28–4.31 KB** from 100 to 2,000 active sessions, rather than increasing with each participant. Row-capacity output is 692 bytes; motif-capacity output is 698 bytes.

### Memory and allocation

Heap is sampled after each call, relative to pre-batch heap after explicit GC. These are **sampled growth over a 25-call batch**, including garbage accumulated between automatic collections, not per-call retained storage or a measured instantaneous peak. Whole-process RSS includes ts-node, fixture arrays, prior cases and allocator retention.

| Case                  | Sampled batch heap growth MiB | RSS before / after batch MiB |
| --------------------- | ----------------------------: | ---------------------------- |
| 1,000 rows            |                          3.95 | 181.25 / 181.41              |
| 5,000 rows            |                         16.50 | 201.89 / 210.00              |
| 10,000 rows           |                         21.85 | 236.73 / 252.05              |
| 20,000 active rows    |                         83.81 | 315.53 / 345.88              |
| 100,000 retained rows |                        211.13 | 432.95 / 573.19              |
| Window-row saturation |                        105.52 | 535.45 / 545.58              |
| Exact motif budget    |                        114.36 | 536.98 / 544.61              |
| Motif saturation      |                         69.48 | 537.34 / 539.22              |

After explicit post-batch GC, retained-heap changes ranged approximately from **−34 KiB to +12 KiB**, consistent with temporary summaries and no persistent observer state in this bounded run. This is not a proof against every leak or an RSS bound. The allocation footprint and roughly 45 ms observed maximum call make synchronous production admission/finalization integration inappropriate without separate design and load review. Capacity is not free: row normalization/sorting happens before per-window checks, and motif saturation does work up to its motif bound.

Phase 3B's published timings measured indexed per-event extraction on smaller individual histories, while this prototype measures full cross-session batches. Direct throughput or latency ratios would be misleading. No SQL rows-examined, transaction wait/hold time, admission latency, visibility lag, event-loop delay under concurrent load or production headroom is established here. Those values are unmeasured, not zero.

## Compatibility, documentation and stopping point

Only a separate analysis file, synthetic helper/tests/measurement runner, two npm scripts and this report were added for Phase 3C. Production routes, services, controllers, tracking, classification, official counting, schemas, migrations, policy version and the two-minute delay were not changed. No mandatory verification, telemetry collection, external service, database access, migration, new branch/worktree, commit, push or merge was introduced. Existing Phase 3B commands and files were preserved.

The requested typo locations already read **`reconstructed. See`** in `docs/live-usage-bot-protection.md` and **`or writes`** in `tests/local-bot-simulations/README.md` at the start of this phase. Their corrected wording was verified; no historical Phase 3B report was edited to recreate a correction. The previously missing Phase 2/2.1 reports remain missing, with no fabricated replacement.

Important limitations remain: no representative professor dataset, no verified automation provenance, no real distributed network experiment, no statistically calibrated unusual-coverage baseline and no evidence of attention or course outcomes. Common curricula, demonstrations, audits and independent topic preparation can all supply campaign-like patterns. Shuffling, slower schedules, session rotation, missing exports and timing outliers can hide coordinated activity. Exact matches are brittle to inserted or reordered entries, and broad aggregate coverage does not attribute an attack to any participant.

The prototype answers the critical question with a bounded result: **cross-session correlation identifies additional activity relationships, including some synthetic coordination patterns, but those relationships are still patterns legitimate professors can generate. It does not independently distinguish automation or justify enforcement.** Stop after this offline prototype and report; no campaign observation is integrated into production enforcement.
