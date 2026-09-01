'use client';

/* Minimum funnel analytics for Little Chapters V1.
 *
 * Design goals, in order:
 *   1. never leak sensitive information (no free-form child context, no
 *      transcripts, no audio, no raw child name, no tokens, no provider
 *      secrets — see `sanitize()` below);
 *   2. exactly-once semantics for conversion events, so React StrictMode /
 *      Fast Refresh / accidental re-mount doesn't double-count;
 *   3. never crash the app — every send failure is silently swallowed;
 *   4. cheap: sendBeacon when available, small JSON when not, batched via
 *      microtask so a burst of events at chapter-end goes as one request.
 *
 * The SERVER receiver (/api/analytics/collect) is intentionally minimal: it
 * logs the events to stdout (which Vercel scoops into their log stream) and
 * returns 204. That is enough for the V1 launch — the dashboard question
 * ("did anyone actually get to checkout tonight?") is a `vercel logs`
 * filter, not a bespoke analytics UI. Swapping in PostHog/Amplitude later
 * is a one-file change.                                                   */

export type AnalyticsEvent =
  // Acquisition
  | 'landing_view'
  | 'setup_started'
  | 'setup_completed'
  // Reading
  | 'chapter_started'
  | 'chapter_completed'
  // Monetization
  | 'unlock_shown'
  | 'register_started'
  | 'register_completed'
  | 'checkout_started'
  | 'checkout_completed'
  | 'subscription_active'
  | 'billing_portal_opened'
  | 'subscription_canceled'
  | 'payment_failed'
  // Quality (never sensitive content)
  | 'story_generation_failed'
  | 'visual_generation_failed'
  | 'tts_failed'
  | 'speech_scoring_failed';

/** Non-sensitive properties only. See `sanitize()` for the enforced list. */
export interface EventProps {
  route?: string;
  authed?: boolean;
  plan?: 'monthly' | 'yearly';
  stage?: number;
  interactionType?: string;
  provider?: string;
  fallback?: 'used' | 'skipped' | 'none';
  errorCategory?: string;
}

const SESSION_KEY = 'lc-analytics-session';
const ONCE_KEY = 'lc-analytics-once';

/** Session id (per-tab, browser-random). Never a user id, never a uid. */
function sessionId(): string {
  if (typeof window === 'undefined') return 'server';
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const fresh = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    return 'session';
  }
}

/** Events that MUST fire at most once per browser session (conversions). */
const ONCE_ONLY: readonly AnalyticsEvent[] = [
  'setup_completed',
  'register_completed',
  'checkout_completed',
  'subscription_active',
];

function firedThisSession(event: AnalyticsEvent): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const seen = new Set<string>(JSON.parse(sessionStorage.getItem(ONCE_KEY) ?? '[]') as string[]);
    if (seen.has(event)) return true;
    seen.add(event);
    sessionStorage.setItem(ONCE_KEY, JSON.stringify([...seen]));
    return false;
  } catch {
    return false;
  }
}

/** Whitelist-based sanitizer — anything not explicitly listed is dropped. */
function sanitize(props?: EventProps): Record<string, unknown> {
  if (!props) return {};
  const out: Record<string, unknown> = {};
  const allowed: (keyof EventProps)[] = ['route', 'authed', 'plan', 'stage', 'interactionType', 'provider', 'fallback', 'errorCategory'];
  for (const key of allowed) {
    const value = props[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

interface QueueItem {
  event: AnalyticsEvent;
  props: Record<string, unknown>;
  ts: number;
  sid: string;
}

let queue: QueueItem[] = [];
let flushPending = false;

function schedule(): void {
  if (flushPending) return;
  flushPending = true;
  queueMicrotask(() => {
    flushPending = false;
    void flush();
  });
}

async function flush(): Promise<void> {
  if (queue.length === 0 || typeof window === 'undefined') return;
  const batch = queue;
  queue = [];
  const body = JSON.stringify({ events: batch });
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon('/api/analytics/collect', blob);
      return;
    }
    await fetch('/api/analytics/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    });
  } catch {
    /* analytics must never crash the app or block a UI action */
  }
}

/** The one API. Call this from any client component — never from server code. */
export function track(event: AnalyticsEvent, props?: EventProps): void {
  if (typeof window === 'undefined') return;
  if (ONCE_ONLY.includes(event) && firedThisSession(event)) return;
  queue.push({ event, props: sanitize(props), ts: Date.now(), sid: sessionId() });
  schedule();
}

/** Test hook only: expose the current queue and flush synchronously. Never
 *  used at runtime; the deterministic analytics test imports these. */
export const __test = {
  drain(): QueueItem[] { const out = [...queue]; queue = []; return out; },
  peek(): QueueItem[] { return [...queue]; },
  reset(): void {
    queue = [];
    try {
      sessionStorage.removeItem(ONCE_KEY);
      sessionStorage.removeItem(SESSION_KEY);
    } catch { /* not in a browser-like env */ }
  },
  sanitize,
};
