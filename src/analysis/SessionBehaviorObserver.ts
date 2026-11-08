import type { ProvisionalUsageEvent } from '../db/entities/ProvisionalUsageEvent.js';

/** Offline only. A type-only dependency keeps the app, ORM and worker out of this module. */
export type BehaviorEvidence = Pick<
  ProvisionalUsageEvent,
  'id' | 'sessionKey' | 'kind' | 'identityKey' | 'receivedAt' | 'reviewAfter'
>;
export interface CatalogSnapshot {
  asOf: Date;
  /** ENTRY_CLICK identity HMACs from one fixed eligible catalog, never raw item IDs. */
  entryIdentityKeys: readonly string[];
}
export const behaviorExperiment = Object.freeze({
  version: 'phase3b-offline-v1',
  windowsMs: [300_000, 900_000] as const,
  maxInputRows: 100_000,
  maxWindowRows: 5_000,
  maxCatalogEntries: 50_000,
  sustainedPerMinute: 10,
  activeFraction: 0.8,
  maxSustainedGapMs: 30_000,
  motifLength: 5,
  motifOccurrences: 3,
  coverageFraction: 0.8,
  coverageMinEntries: 20,
  regularMinGaps: 10,
  regularMaxCv: 0.1,
});
export type Pattern = 'SUSTAINED_ACTIVITY' | 'REPEATED_TRAVERSAL' | 'BROAD_RESOURCE_COVERAGE' | 'REGULAR_CADENCE';
export interface BehaviorObservation {
  pattern: Pattern;
  windowMs: number;
  sampleCount: number;
  explanation: string;
}
export interface WindowFeatures {
  sampleCount: number;
  spanMs: number;
  eventsPerWindowMinute: number;
  activeMinuteBuckets: number;
  maxGapMs: number;
  gapCv: number | null;
  byKind: Record<BehaviorEvidence['kind'], number>;
  distinctKindIdentities: number;
  distinctEntries: number;
  repeatedEntryEvents: number;
  maxNonoverlappingMotifOccurrences: number;
  catalogSize: number | null;
  coveredCatalogEntries: number | null;
  coverageFraction: number | null;
  entriesOutsideCatalog: number | null;
}
export interface WindowAnalysis {
  windowMs: number;
  status: 'COMPLETE_INPUT' | 'WINDOW_CAPACITY';
  /** Completeness means all supplied rows, not proof that the source retained all history. */
  availableRows: number;
  features: WindowFeatures | null;
  observations: BehaviorObservation[];
}
export interface SessionAnalysis {
  version: string;
  asOfMs: number;
  windows: WindowAnalysis[];
}
type Row = Omit<BehaviorEvidence, 'receivedAt' | 'reviewAfter'> & {
  at: number;
  review: number;
};
const kinds = ['ENTRY_CLICK', 'EXTERNAL_CLICK', 'WEB_SEARCH'] as const;
function timestamp(date: Date): number {
  const value = date?.getTime();
  if (!Number.isFinite(value)) throw new Error('INVALID_SERVER_TIMESTAMP');
  return value;
}
function normalized(event: BehaviorEvidence): Row {
  const at = timestamp(event.receivedAt),
    review = timestamp(event.reviewAfter);
  if (
    !Number.isSafeInteger(event.id) ||
    event.id < 0 ||
    !kinds.includes(event.kind) ||
    !event.sessionKey ||
    event.sessionKey.length > 64 ||
    !event.identityKey ||
    event.identityKey.length > 64 ||
    review < at
  )
    throw new Error('INVALID_BEHAVIOR_EVIDENCE');
  return {
    id: event.id,
    sessionKey: event.sessionKey,
    kind: event.kind,
    identityKey: event.identityKey,
    at,
    review,
  };
}
function bound(rows: readonly Row[], at: number, inclusive: boolean): number {
  let lo = 0,
    hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (rows[mid].at < at || (inclusive && rows[mid].at === at)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Bounded immutable index of disposable evidence. No IO, statuses, labels or decisions. */
export class SessionBehaviorObserver {
  private readonly ids = new Map<number, Row>();
  private readonly sessions = new Map<string, Row[]>();
  private readonly catalog?: { at: number; keys: Set<string> };

  constructor(evidence: readonly BehaviorEvidence[], snapshot?: CatalogSnapshot) {
    if (evidence.length > behaviorExperiment.maxInputRows) throw new Error('INPUT_CAPACITY');
    if (snapshot) {
      if (snapshot.entryIdentityKeys.length > behaviorExperiment.maxCatalogEntries) throw new Error('CATALOG_CAPACITY');
      if (snapshot.entryIdentityKeys.some((key) => !key || key.length > 64)) throw new Error('INVALID_CATALOG_KEY');
      this.catalog = {
        at: timestamp(snapshot.asOf),
        keys: new Set(snapshot.entryIdentityKeys),
      };
    }
    for (const event of evidence) {
      const row = normalized(event),
        previous = this.ids.get(row.id);
      if (previous) {
        if (JSON.stringify(previous) !== JSON.stringify(row)) throw new Error('CONFLICTING_LEDGER_ID');
        continue; // Duplicate extraction of the same durable row is not a new interaction.
      }
      this.ids.set(row.id, row);
      const session = this.sessions.get(row.sessionKey) ?? [];
      session.push(row);
      this.sessions.set(row.sessionKey, session);
    }
    for (const rows of this.sessions.values()) rows.sort((a, b) => a.at - b.at || a.id - b.id);
  }

  analyze(event: BehaviorEvidence): SessionAnalysis {
    const target = normalized(event),
      stored = this.ids.get(target.id);
    if (!stored || JSON.stringify(stored) !== JSON.stringify(target)) throw new Error('TARGET_NOT_IN_EVIDENCE');
    const rows = this.sessions.get(target.sessionKey)!;
    const end = bound(rows, target.review, true);
    return {
      version: behaviorExperiment.version,
      asOfMs: target.review,
      windows: behaviorExperiment.windowsMs.map((windowMs) => {
        // Both endpoints inclusive; ties ordered by durable ledger ID.
        const start = bound(rows, target.review - windowMs, false),
          count = end - start;
        if (count > behaviorExperiment.maxWindowRows)
          return {
            windowMs,
            status: 'WINDOW_CAPACITY',
            availableRows: count,
            features: null,
            observations: [],
          };
        const selected = rows.slice(start, end);
        const features = this.extract(selected, target.review - windowMs, windowMs, target.review);
        return {
          windowMs,
          status: 'COMPLETE_INPUT',
          availableRows: count,
          features,
          observations: this.observe(features, windowMs),
        };
      }),
    };
  }

  private extract(rows: Row[], start: number, windowMs: number, asOf: number): WindowFeatures {
    const byKind = { ENTRY_CLICK: 0, EXTERNAL_CLICK: 0, WEB_SEARCH: 0 };
    const identities = new Set<string>(),
      entries: string[] = [],
      buckets = new Set<number>();
    const gaps: number[] = [];
    rows.forEach((row, i) => {
      byKind[row.kind]++;
      identities.add(JSON.stringify([row.kind, row.identityKey]));
      if (row.kind === 'ENTRY_CLICK') entries.push(row.identityKey);
      buckets.add(Math.min(windowMs / 60_000 - 1, Math.floor((row.at - start) / 60_000)));
      if (i) gaps.push(row.at - rows[i - 1].at);
    });
    const distinctEntries = new Set(entries);
    const mean = gaps.length ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : 0;
    const variance = gaps.length ? gaps.reduce((sum, gap) => sum + (gap - mean) ** 2, 0) / gaps.length : 0;
    // Fixed-size entry motifs; one-item repeats cannot become multi-resource traversal.
    const motifs = new Map<string, { count: number; lastEnd: number }>();
    let maxOccurrences = 0;
    for (let i = 0; i <= entries.length - behaviorExperiment.motifLength; i++) {
      const motif = entries.slice(i, i + behaviorExperiment.motifLength);
      if (new Set(motif).size !== behaviorExperiment.motifLength) continue;
      const key = JSON.stringify(motif),
        seen = motifs.get(key) ?? { count: 0, lastEnd: -1 };
      if (i > seen.lastEnd) {
        seen.count++;
        seen.lastEnd = i + behaviorExperiment.motifLength - 1;
        motifs.set(key, seen);
        maxOccurrences = Math.max(maxOccurrences, seen.count);
      }
    }
    const catalog = this.catalog && this.catalog.at <= asOf && this.catalog.keys.size ? this.catalog.keys : null;
    const covered = catalog ? [...distinctEntries].filter((key) => catalog.has(key)).length : null;
    return {
      sampleCount: rows.length,
      spanMs: rows.length > 1 ? rows[rows.length - 1].at - rows[0].at : 0,
      eventsPerWindowMinute: rows.length / (windowMs / 60_000),
      activeMinuteBuckets: buckets.size,
      maxGapMs: gaps.length ? Math.max(...gaps) : 0,
      gapCv: mean > 0 ? Math.sqrt(variance) / mean : null,
      byKind,
      distinctKindIdentities: identities.size,
      distinctEntries: distinctEntries.size,
      repeatedEntryEvents: entries.length - distinctEntries.size,
      maxNonoverlappingMotifOccurrences: maxOccurrences,
      catalogSize: catalog?.size ?? null,
      coveredCatalogEntries: covered,
      coverageFraction: catalog ? covered! / catalog.size : null,
      entriesOutsideCatalog: catalog ? distinctEntries.size - covered! : null,
    };
  }

  private observe(f: WindowFeatures, windowMs: number): BehaviorObservation[] {
    const observations: BehaviorObservation[] = [];
    const add = (pattern: Pattern, explanation: string) =>
      observations.push({
        pattern,
        windowMs,
        sampleCount: f.sampleCount,
        explanation,
      });
    const p = behaviorExperiment;
    if (
      f.eventsPerWindowMinute >= p.sustainedPerMinute &&
      f.spanMs >= p.activeFraction * windowMs &&
      f.activeMinuteBuckets >= Math.ceil((p.activeFraction * windowMs) / 60_000) &&
      f.maxGapMs <= p.maxSustainedGapMs
    )
      add(
        'SUSTAINED_ACTIVITY',
        `${f.sampleCount} events over ${f.spanMs}ms; ${f.eventsPerWindowMinute} per window-minute, ${f.activeMinuteBuckets} active minute buckets, maximum gap ${f.maxGapMs}ms meet 10/min, 80% span/buckets and <=30000ms gap criteria.`,
      );
    if (f.maxNonoverlappingMotifOccurrences >= p.motifOccurrences)
      add(
        'REPEATED_TRAVERSAL',
        `An ordered five-distinct-entry motif occurs ${f.maxNonoverlappingMotifOccurrences} nonoverlapping times (minimum 3); entry sequence only, not verified page navigation.`,
      );
    if (
      f.coverageFraction !== null &&
      f.coverageFraction >= p.coverageFraction &&
      f.coveredCatalogEntries! >= p.coverageMinEntries
    )
      add(
        'BROAD_RESOURCE_COVERAGE',
        `${f.coveredCatalogEntries}/${f.catalogSize} eligible entry identities covered (minimum 20 and 80%); fixed snapshot available by review time.`,
      );
    if (f.sampleCount - 1 >= p.regularMinGaps && f.gapCv !== null && f.gapCv <= p.regularMaxCv)
      add(
        'REGULAR_CADENCE',
        `${f.sampleCount - 1} server-observed gaps have population CV ${f.gapCv} <=0.1; descriptive regularity, not human intent.`,
      );
    return observations;
  }
}
