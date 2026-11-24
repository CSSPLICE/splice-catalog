import 'dotenv/config';
import { createHmac, randomBytes } from 'node:crypto';

export type ProtectionMode = 'off' | 'observe' | 'enforce';
export type Classification = 'ACCEPT' | 'REVIEW' | 'REJECT';
export interface Decision {
  decision: Classification;
  reason: string;
  shadow?: { decision: Classification; reason: string };
}
export interface ProtectionOptions {
  mode: ProtectionMode;
  sessionTtlMs: number;
  windowMs: number;
  sessionReview: number;
  sessionReject: number;
  ipReview: number;
  burstWindowMs: number;
  burstReview: number;
  repeatWindowMs: number;
  repeatReview: number;
  distinctReview: number;
  maxSessions: number;
  maxIps: number;
  maxReplayIds: number;
  extraBotIndicators: string[];
}
export interface BrowserSignal {
  ip: string;
  userAgent: string;
  sameOrigin: boolean;
  sessionId?: string;
  csrf?: string;
  eventId?: unknown;
  kind: string;
  // Never retain raw queries or item identifiers in detection state.
  identity: string;
}
interface Session {
  csrf: string;
  createdAt: number;
  expiresAt: number;
  ua: string;
  events: Array<{ at: number; identity: string; kind: string }>;
  replay: Set<string>;
}

// Explicit indicators, not an allow-list of familiar browsers. Additional literal
// substrings can be configured without accepting arbitrary regular expressions.
const crawler =
  /googlebot|bingbot|bytespider|yandexbot|baiduspider|duckduckbot|applebot|petalbot|facebookexternalhit|twitterbot|semrushbot|ahrefsbot|mj12bot|dotbot|gptbot|oai-searchbot|claudebot|ccbot|headlesschrome|phantomjs|selenium|sqlmap|nikto|masscan|zgrab/i;
const scripted =
  /curl\/|wget\/|python-requests|python-urllib|aiohttp|httpx\/|go-http-client|libwww-perl|scrapy|node-fetch|axios\//i;
const defaults: ProtectionOptions = {
  mode: 'off',
  sessionTtlMs: 30 * 60_000,
  windowMs: 60_000,
  sessionReview: 60,
  sessionReject: 240,
  ipReview: 600,
  burstWindowMs: 2_000,
  burstReview: 12,
  repeatWindowMs: 10_000,
  repeatReview: 6,
  distinctReview: 12,
  maxSessions: 10_000,
  maxIps: 5_000,
  maxReplayIds: 512,
  extraBotIndicators: [],
};

export function protectionOptionsFromEnvironment(): Partial<ProtectionOptions> {
  const mode = process.env.LIVE_USAGE_MODE || 'off';
  if (!['off', 'observe', 'enforce'].includes(mode)) throw new Error('Invalid LIVE_USAGE_MODE');
  const options: Partial<ProtectionOptions> = { mode: mode as ProtectionMode };
  for (const key of Object.keys(defaults) as Array<keyof ProtectionOptions>) {
    if (typeof defaults[key] !== 'number') continue;
    const env = `LIVE_USAGE_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`;
    if (process.env[env] !== undefined) Object.assign(options, { [key]: Number(process.env[env]) });
  }
  options.extraBotIndicators = (process.env.LIVE_USAGE_BOT_INDICATORS || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  return options;
}

/** Single-process local implementation. Classification and replay reservation are
 * synchronous (no await); an event ID is consumed before any database operation.
 * Shared atomic state is REQUIRED before enabling multi-process enforcement. */
export class LiveUsageBotProtection {
  readonly options: ProtectionOptions;
  private sessions = new Map<string, Session>();
  private ips = new Map<string, number[]>();
  private salt = randomBytes(32);
  private audit = new Map<string, number>();
  private auditStarted: number;
  private lastCleanup = 0;

  constructor(
    options: Partial<ProtectionOptions> = {},
    private now: () => number = Date.now,
  ) {
    this.options = { ...defaults, ...options };
    for (const value of Object.values(this.options)) {
      if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 1))
        throw new Error('Invalid protection threshold');
    }
    if (
      this.options.sessionReview > this.options.sessionReject ||
      this.options.burstWindowMs > this.options.windowMs ||
      this.options.repeatWindowMs > this.options.windowMs
    )
      throw new Error('Inconsistent protection thresholds');
    this.auditStarted = this.now();
  }

  private hash(value: string): string {
    return createHmac('sha256', this.salt).update(value).digest('hex');
  }

  cleanup(): void {
    const now = this.now();
    for (const [key, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(key);
    for (const [key, times] of this.ips) {
      const fresh = times.filter((at) => at > now - this.options.windowMs);
      if (fresh.length) this.ips.set(key, fresh);
      else this.ips.delete(key);
    }
    this.lastCleanup = now;
  }

  private maintenance(): void {
    if (this.now() - this.lastCleanup >= Math.min(this.options.windowMs, 60_000)) this.cleanup();
  }

  private finish(decision: Classification, reason: string): Decision {
    if (this.now() - this.auditStarted >= 60 * 60_000) {
      this.audit.clear();
      this.auditStarted = this.now();
    }
    const key = `${decision}:${reason}`;
    this.audit.set(key, (this.audit.get(key) || 0) + 1);
    if (this.options.mode === 'observe' && decision !== 'ACCEPT')
      return { decision: 'ACCEPT', reason: 'OBSERVE_ONLY', shadow: { decision, reason } };
    return { decision, reason };
  }

  snapshot() {
    this.cleanup();
    return {
      sessions: this.sessions.size,
      ips: this.ips.size,
      auditStarted: this.auditStarted,
      decisions: Object.fromEntries(this.audit),
    };
  }

  issueSession(sessionId: string | undefined, userAgent: string) {
    this.maintenance();
    const existing = sessionId ? this.sessions.get(sessionId) : undefined;
    if (existing && existing.expiresAt > this.now())
      return { id: sessionId!, csrf: existing.csrf, expiresAt: existing.expiresAt };
    if (this.sessions.size >= this.options.maxSessions) {
      this.cleanup();
      if (this.sessions.size >= this.options.maxSessions) return null;
    }
    const id = randomBytes(32).toString('hex');
    const session: Session = {
      csrf: randomBytes(32).toString('hex'),
      createdAt: this.now(),
      expiresAt: this.now() + this.options.sessionTtlMs,
      ua: this.hash(userAgent),
      events: [],
      replay: new Set(),
    };
    this.sessions.set(id, session);
    return { id, csrf: session.csrf, expiresAt: session.expiresAt };
  }

  // Exposes server context only after credential validation, never browser claims.
  sessionContext(sessionId: string | undefined, csrf: string | undefined) {
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!session || session.expiresAt <= this.now() || csrf !== session.csrf) return null;
    return { sessionId: sessionId!, startedAt: session.createdAt };
  }

  releaseReplayReservation(sessionId: string, eventId: string): void {
    this.sessions.get(sessionId)?.replay.delete(eventId);
  }

  private knownBot(ua: string, api = false): boolean {
    return (
      crawler.test(ua) ||
      (!api && scripted.test(ua)) ||
      this.options.extraBotIndicators.some((v) => ua.toLowerCase().includes(v))
    );
  }

  private ipSignal(ip: string): string | undefined {
    const key = this.hash(ip);
    const now = this.now();
    let times = this.ips.get(key);
    if (!times && this.ips.size >= this.options.maxIps) return 'STATE_CAPACITY';
    times = (times || []).filter((at) => at > now - this.options.windowMs);
    times.push(now);
    // Keep the latest timestamps, including at saturation; memory is strictly bounded.
    this.ips.set(key, times.slice(-(this.options.ipReview + 1)));
    return times.length > this.options.ipReview ? 'IP_RATE' : undefined;
  }

  classifyBrowser(input: BrowserSignal): Decision {
    if (this.options.mode === 'off') return this.finish('ACCEPT', 'MODE_OFF');
    // Retain the distinction between expired and unknown credentials before cleanup.
    // Browser requests never mutate the API IP budget. Invalid/replayed traffic
    // cannot poison shared-network users; bounded session/ledger state controls load.
    const session = input.sessionId ? this.sessions.get(input.sessionId) : undefined;
    this.maintenance();
    if (!input.sameOrigin) return this.finish('REJECT', 'ORIGIN_INVALID');
    if (this.knownBot(input.userAgent)) return this.finish('REJECT', 'KNOWN_AUTOMATION');
    if (!input.sessionId) return this.finish('REJECT', 'SESSION_MISSING');
    if (!session) return this.finish('REJECT', 'SESSION_INVALID');
    if (session.expiresAt <= this.now()) return this.finish('REJECT', 'SESSION_EXPIRED');
    if (!input.csrf || input.csrf !== session.csrf) return this.finish('REJECT', 'TOKEN_INVALID');
    if (typeof input.eventId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(input.eventId))
      return this.finish('REJECT', 'EVENT_ID_INVALID');
    if (session.replay.has(input.eventId)) return this.finish('REJECT', 'EVENT_REPLAY');
    if (session.replay.size >= this.options.maxReplayIds) return this.finish('REVIEW', 'REPLAY_CAPACITY');
    session.replay.add(input.eventId);
    const now = this.now();
    session.events = session.events.filter((event) => event.at > now - this.options.windowMs);
    session.events.push({ at: now, identity: this.hash(input.identity), kind: input.kind });
    const count = session.events.length;
    session.events = session.events.slice(-(this.options.sessionReject + 1));
    if (count > this.options.sessionReject) return this.finish('REJECT', 'SESSION_ABUSE');
    if (this.hash(input.userAgent) !== session.ua) return this.finish('REVIEW', 'SESSION_UA_CHANGED');
    if (!input.userAgent) return this.finish('REVIEW', 'UA_MISSING');
    if (count > this.options.sessionReview) return this.finish('REVIEW', 'SESSION_RATE');
    if (session.events.filter((event) => event.at > now - this.options.burstWindowMs).length > this.options.burstReview)
      return this.finish('REVIEW', 'EVENT_BURST');
    const recent = session.events.filter((event) => event.at > now - this.options.repeatWindowMs);
    if (
      recent.filter((event) => event.identity === this.hash(input.identity) && event.kind === input.kind).length >
      this.options.repeatReview
    )
      return this.finish('REVIEW', 'EVENT_REPETITION');
    if (
      new Set(recent.filter((event) => event.kind === 'ENTRY_CLICK').map((event) => event.identity)).size >
      this.options.distinctReview
    )
      return this.finish('REVIEW', 'ENTRY_SWEEP');
    return this.finish('ACCEPT', 'ELIGIBLE_BROWSER_EVENT');
  }

  classifyApi(ip: string, userAgent: string): Decision {
    if (this.options.mode === 'off') return this.finish('ACCEPT', 'MODE_OFF');
    this.maintenance();
    // API statistics measure API usage, including legitimate scripts, not humans.
    if (this.knownBot(userAgent, true)) return this.finish('REJECT', 'KNOWN_AUTOMATION');
    const reason = this.ipSignal(ip);
    return reason ? this.finish('REVIEW', reason) : this.finish('ACCEPT', 'ELIGIBLE_API_SEARCH');
  }
}

export const liveUsageBotProtection = new LiveUsageBotProtection(protectionOptionsFromEnvironment());

// Purge expired identifiers even when the server receives no further traffic.
const cleanupTimer = setInterval(() => liveUsageBotProtection.cleanup(), 60_000);
cleanupTimer.unref();

/** Durable, privacy-preserving observations supplied by the shared store. */
export interface DelayedObservation {
  id: number;
  sessionKey: string;
  networkKey: string;
  agentKey: string;
  identityKey: string;
  kind: string;
  initialDecision: Classification;
  initialReason: string;
  receivedAt: Date;
  sessionStartedAt: Date;
  reviewAfter: Date;
}
export interface CoordinationPolicy {
  coordinatedSessions: number;
  sequenceLength: number;
  synchronyMs: number;
  freshSessionMs: number;
}

/** Pure reevaluation: no process-local session/counter lookup is used. Evidence
 * after this event's review horizon cannot retroactively change an official row. */
export function evaluateProvisionalEvent(
  event: DelayedObservation,
  observations: readonly DelayedObservation[],
  thresholds: ProtectionOptions,
  coordination: CoordinationPolicy,
): Decision {
  if (event.initialDecision !== 'ACCEPT') return { decision: event.initialDecision, reason: event.initialReason };
  const start = event.receivedAt.getTime() - thresholds.windowMs;
  const end = event.reviewAfter.getTime();
  const evidence = observations
    .filter((row) => row.receivedAt.getTime() >= start && row.receivedAt.getTime() <= end)
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.id - b.id);
  const session = evidence.filter((row) => row.sessionKey === event.sessionKey);
  const taint = session.find((row) =>
    ['KNOWN_AUTOMATION', 'SESSION_UA_CHANGED', 'SESSION_ABUSE'].includes(row.initialReason),
  );
  if (taint) return { decision: 'REVIEW', reason: `RETROSPECTIVE_${taint.initialReason}` };
  if (new Set(session.map((row) => row.agentKey)).size > 1)
    return { decision: 'REVIEW', reason: 'RETROSPECTIVE_SESSION_UA_CHANGED' };
  for (const row of session) {
    const at = row.receivedAt.getTime();
    const window = session.filter(
      (other) => other.receivedAt.getTime() <= at && other.receivedAt.getTime() > at - thresholds.windowMs,
    );
    if (window.length > thresholds.sessionReview) return { decision: 'REVIEW', reason: 'RETROSPECTIVE_SESSION_RATE' };
    if (
      window.filter((other) => other.receivedAt.getTime() > at - thresholds.burstWindowMs).length >
      thresholds.burstReview
    )
      return { decision: 'REVIEW', reason: 'RETROSPECTIVE_EVENT_BURST' };
    const recent = window.filter((other) => other.receivedAt.getTime() > at - thresholds.repeatWindowMs);
    if (
      recent.filter((other) => other.kind === row.kind && other.identityKey === row.identityKey).length >
      thresholds.repeatReview
    )
      return { decision: 'REVIEW', reason: 'RETROSPECTIVE_EVENT_REPETITION' };
    if (
      new Set(recent.filter((other) => other.kind === 'ENTRY_CLICK').map((other) => other.identityKey)).size >
      thresholds.distinctReview
    )
      return { decision: 'REVIEW', reason: 'RETROSPECTIVE_ENTRY_SWEEP' };
  }
  // Coordination is observable, not proof of automation. Only matching entry
  // events receive the nonblocking reason; unrelated action types do not.
  if (event.kind !== 'ENTRY_CLICK') return { decision: 'ACCEPT', reason: 'REVIEW_WINDOW_ELIGIBLE' };
  // Require multiple matching ordered
  // multi-item sequences AND tightly aligned per-step server receipt times.
  const cohorts = new Map<string, DelayedObservation[]>();
  for (const row of evidence) {
    if (
      row.networkKey !== event.networkKey ||
      row.agentKey !== event.agentKey ||
      row.kind !== 'ENTRY_CLICK' ||
      row.receivedAt.getTime() - row.sessionStartedAt.getTime() > coordination.freshSessionMs
    )
      continue;
    const rows = cohorts.get(row.sessionKey) || [];
    rows.push(row);
    cohorts.set(row.sessionKey, rows);
  }
  const target = cohorts.get(event.sessionKey)?.slice(0, coordination.sequenceLength);
  if (
    target?.length === coordination.sequenceLength &&
    new Set(target.map((row) => row.identityKey)).size === coordination.sequenceLength
  ) {
    const peers = [...cohorts.entries()]
      .map(([sessionKey, rows]) => ({ sessionKey, rows: rows.slice(0, coordination.sequenceLength) }))
      .filter(
        ({ rows }) =>
          rows.length === target.length && rows.every((row, index) => row.identityKey === target[index].identityKey),
      );
    for (const anchor of peers) {
      const matched = peers.filter(({ rows }) =>
        rows.every(
          (row, index) =>
            Math.abs(row.receivedAt.getTime() - anchor.rows[index].receivedAt.getTime()) <=
            coordination.synchronyMs / 2,
        ),
      );
      if (
        matched.length >= coordination.coordinatedSessions &&
        matched.some((peer) => peer.sessionKey === event.sessionKey)
      )
        return { decision: 'ACCEPT', reason: 'COORDINATION_OBSERVED' };
    }
  }
  return { decision: 'ACCEPT', reason: 'REVIEW_WINDOW_ELIGIBLE' };
}
