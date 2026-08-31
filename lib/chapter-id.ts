/* Local-calendar-day chapter identity. Pure, zero framework/storage deps —
 * shared between client code (lib/chapters.ts) and the server persistence
 * route (app/api/chapters/today/route.ts) so both sides compute the exact
 * same id for the exact same child + day without either importing the
 * other's client- or server-bound code (lib/chapters.ts pulls in
 * localStorage-touching modules; the server route cannot use those). */

import type { InterestId } from './profile';

/** The child's own LOCAL calendar day, matching the existing convention in
 *  lib/pet.ts's streak tracking (CLAUDE.md: "Streaks use the LOCAL calendar
 *  day and survive clock rollbacks") — this must be computed in the
 *  BROWSER, not the server (a server request's `new Date()` reflects
 *  Vercel's server timezone, not the child's), so the server route always
 *  takes `day` as a client-supplied value rather than computing its own. */
export function todayLocal(): string {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
}

export function isValidDay(day: unknown): day is string {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day);
}

function slugName(childName: string): string {
  return childName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'reader';
}

/** Deterministic per-day id: same interest + child name + day always
 *  produces the same id. Content-addressable by design (see
 *  lib/chapters.ts's chapterFor doc comment) — this alone already makes the
 *  demo/fallback arc idempotent with no persistence needed. The tutor
 *  (generated) path additionally persists a record under this id server-
 *  side (lib/chapter-store-admin.ts) so concurrent devices/tabs cannot each
 *  generate a DIFFERENT "today's chapter" for the same child. */
export function chapterIdForDay(interest: InterestId | undefined, childName: string, day: string): string {
  return `${interest ?? 'dogs'}-${slugName(childName)}-${day}`;
}
