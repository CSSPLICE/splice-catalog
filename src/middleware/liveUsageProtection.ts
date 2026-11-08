import express, { Request, Response, NextFunction } from 'express';
import { LiveUsageBotProtection, liveUsageBotProtection, Decision } from '../services/LiveUsageBotProtection.js';

function cookieName() {
  return process.env.NODE_ENV === 'production' ? '__Host-splice_usage' : 'splice_usage';
}
function sessionId(req: Request): string | undefined {
  const value = req
    .get?.('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName()}=`))
    ?.slice(cookieName().length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}

export function sameOrigin(req: Request): boolean {
  try {
    const expected = new URL(
      process.env.LIVE_USAGE_ORIGIN || process.env.baseURL || `${req.protocol}://${req.get?.('host')}`,
    ).origin;
    const origin = req.get?.('origin');
    const site = req.get?.('sec-fetch-site');
    if (site && site !== 'same-origin') return false;
    if (origin) return origin === expected;
    const referer = req.get?.('referer');
    return !!referer && new URL(referer).origin === expected;
  } catch {
    return false;
  }
}

function issue(req: Request, res: Response, protection: LiveUsageBotProtection) {
  const session = protection.issueSession(sessionId(req), req.get?.('user-agent') || '');
  if (!session) return null;
  res.cookie(cookieName(), session.id, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.max(0, session.expiresAt - Date.now()),
  });
  return { csrf: session.csrf, expiresAt: session.expiresAt };
}

/** Issue credentials in the HTML response, so the first navigation click requires
 * only one keepalive request. No GET is recorded as a usage event. */
export function browserUsageSession(protection = liveUsageBotProtection) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' && req.get?.('accept')?.includes('text/html') && protection.options.mode !== 'off') {
      res.setHeader('Cache-Control', 'private, no-store');
      try {
        res.locals.liveUsageSession = issue(req, res, protection);
      } catch {
        res.locals.liveUsageSession = null;
      }
    }
    next();
  };
}

export function renewUsageSession(req: Request, res: Response, protection = liveUsageBotProtection) {
  res.setHeader('Cache-Control', 'no-store');
  if (!sameOrigin(req)) return res.status(403).json({ counted: false, decision: 'REJECT', reason: 'ORIGIN_INVALID' });
  try {
    const session = issue(req, res, protection);
    if (!session) return res.status(503).json({ counted: false, decision: 'REVIEW', reason: 'STATE_CAPACITY' });
    return res.json(session);
  } catch {
    return res.status(503).json({ counted: false, decision: 'REVIEW', reason: 'STATE_UNAVAILABLE' });
  }
}

export function classifyBrowserRequest(
  req: Request,
  kind: string,
  identity: string,
  protection: LiveUsageBotProtection,
): Decision {
  try {
    return protection.classifyBrowser({
      ip: req.ip || req.socket?.remoteAddress || 'unknown',
      userAgent: req.get?.('user-agent') || '',
      sameOrigin: sameOrigin(req),
      sessionId: sessionId(req),
      csrf: req.get?.('x-usage-token'),
      eventId: req.body?.eventId,
      kind,
      identity,
    });
  } catch {
    // Fail closed for analytics, without blocking catalog access.
    return { decision: 'REVIEW', reason: 'STATE_UNAVAILABLE' };
  }
}

export function notCounted(res: Response, decision: Decision): Response {
  const renewable = ['SESSION_MISSING', 'SESSION_INVALID', 'SESSION_EXPIRED', 'TOKEN_INVALID'].includes(
    decision.reason,
  );
  return res.status(renewable ? 401 : 202).json({ counted: false, ...decision });
}

// Mount before the application's broad 50 MB parser. The router also uses it so
// standalone test servers and future mounts inherit the same size contract.
const parseUsageJson = express.json({ limit: '4kb', strict: true, inflate: false });
export function usageJson(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'POST' && !req.is('application/json')) {
    return res.status(415).json({ counted: false, decision: 'REJECT', reason: 'CONTENT_TYPE_INVALID' });
  }
  return parseUsageJson(req, res, next);
}
export function usagePayloadErrors(error: any, _req: Request, res: Response, next: NextFunction) {
  if (!error) return next();
  const status = error.status === 413 ? 413 : error.status === 415 ? 415 : 400;
  return res
    .status(status)
    .json({ counted: false, decision: 'REJECT', reason: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'PAYLOAD_INVALID' });
}
