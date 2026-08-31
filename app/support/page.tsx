/* /support — one clear parent-facing contact route. Kept small on purpose:
 * V1 does not run a ticket system, so pointing at an email a human actually
 * reads is more honest than pretending to. */

import Link from 'next/link';

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@littlechapters.com';

export const metadata = { title: 'Support — Little Chapters' };

export default function SupportPage() {
  return (
    <main className="lc-policy">
      <header className="lc-policy-header">
        <Link href="/" className="lc-policy-back" aria-label="Back to Little Chapters">‹</Link>
        <div>
          <h1>Support</h1>
          <p>We&rsquo;re a small team. Real people read every message.</p>
        </div>
      </header>

      <section>
        <h2>Get in touch</h2>
        <p>
          Email us at <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. If it is
          a billing question, include the email on the parent account. Please do not
          send reading audio or sensitive information by email.
        </p>
      </section>

      <section>
        <h2>Common things</h2>
        <ul>
          <li>
            <strong>Change plan, update card, or cancel:</strong> open
            <Link href="/settings"> Settings</Link>, then tap
            <em> Manage plan</em>. That takes you into the Stripe customer portal.
          </li>
          <li>
            <strong>Delete your account:</strong>
            <Link href="/settings"> Settings</Link> has a Delete account action.
            It cancels the subscription and removes account data.
          </li>
          <li>
            <strong>Reading experience feels off:</strong> reply to the after-session
            note in <Link href="/parent">Reading notes</Link>, or email us. We&rsquo;ll
            look at what happened and adjust.
          </li>
          <li>
            <strong>Refunds, billing questions:</strong> email us. We try to be fair.
          </li>
        </ul>
      </section>

      <section>
        <h2>Privacy and terms</h2>
        <p>
          Our <Link href="/privacy">Privacy summary</Link> and
          <Link href="/terms"> Terms</Link> explain what we collect and how the service works.
        </p>
      </section>

      <footer className="lc-policy-footer">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/">Home</Link>
      </footer>
    </main>
  );
}
