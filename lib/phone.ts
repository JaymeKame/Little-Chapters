/* Phone-number normalisation, shared by the client (instant feedback while
 * the parent types) and the server route that actually stores the number.
 *
 * Pure and dependency-free on purpose: both sides must agree on what E.164
 * means, and the SERVER is authoritative. The client copy exists only so a
 * parent gets "that doesn't look like a phone number" without a round trip —
 * never as the check that protects the stored value.
 *
 * Twilio rejects anything that is not E.164, and lib/sms.ts is given the
 * stored string verbatim, so a number that gets past this is a message that
 * silently never arrives. */

/** E.164: a leading +, a nonzero country digit, then 6–14 more digits. */
export const E164 = /^\+[1-9]\d{6,14}$/;

/** Best-effort E.164 normalisation. Returns null when the input cannot be
 *  read as a phone number at all — callers surface that as a parent-facing
 *  message, never as a silent drop. */
export function normalizePhoneNumber(input: string): string | null {
  const digits = String(input ?? '').replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+')) {
    const normalized = `+${digits.slice(1).replace(/\D/g, '')}`;
    return E164.test(normalized) ? normalized : null;
  }
  // Bare 10 digits: assume US/Canada.
  if (digits.length === 10) return E164.test(`+1${digits}`) ? `+1${digits}` : null;
  /* Anything shorter than 10 digits with no country code is a LOCAL number,
   * and we cannot know its country. The old code fell through to `+${digits}`
   * here, which turned "555-1234" into "+5551234" — that matches E.164 (it
   * reads as country code 5), so it stored clean and then failed at Twilio,
   * where the parent never sees it. Ask for the full number instead. */
  if (digits.length < 10) return null;
  const normalized = `+${digits}`;
  return E164.test(normalized) ? normalized : null;
}

/** The one wording parents see when a number is unusable. */
export const INVALID_PHONE_MESSAGE = 'Please enter a valid phone number, like +1 555 123 4567';
