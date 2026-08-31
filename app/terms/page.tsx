/* /terms — plain-language terms describing the service as it works today. */

import Link from 'next/link';

export const metadata = { title: 'Terms — Little Chapters' };

export default function TermsPage() {
  return (
    <main className="lc-policy">
      <header className="lc-policy-header">
        <Link href="/" className="lc-policy-back" aria-label="Back to Little Chapters">‹</Link>
        <div>
          <span className="lc-policy-eyebrow">For families</span>
          <h1>Terms of Service</h1>
          <p>Last updated August 31, 2026.</p>
        </div>
      </header>

      <section>
        <h2>What Little Chapters is</h2>
        <p>
          Little Chapters is a daily reading experience for early readers, set up by a
          parent or guardian. The first chapter is free. Continued daily chapters
          require a paid subscription.
        </p>
      </section>

      <section>
        <h2>Subscription and payment</h2>
        <p>
          We currently offer monthly and yearly plans, billed through Stripe. Prices
          are shown before checkout. Subscriptions renew automatically at the price
          shown until you cancel.
        </p>
        <p>
          You can cancel at any time from <Link href="/settings">Settings &rarr; Manage plan</Link>,
          which opens the Stripe customer portal. Cancellation takes effect at the end
          of the current billing period; the completed chapter your child has already
          read remains readable.
        </p>
      </section>

      <section>
        <h2>AI-generated content</h2>
        <p>
          Chapters are written and illustrated with AI, tuned to your child&rsquo;s
          reading level and interests. We validate every chapter against safety and
          reading-level rules before it reaches your child, and we hold the story
          world to a small cast (child, pet, one animal or object). AI can still
          produce imperfect results &mdash; please tell us at <Link href="/support">Support</Link>
          if anything looks wrong.
        </p>
      </section>

      <section>
        <h2>Parent responsibility</h2>
        <p>
          Little Chapters is set up by an adult on behalf of a child. Parents and
          guardians are responsible for supervising use, deciding what to share in
          the optional child-context field, and managing the account.
        </p>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <p>
          Please use Little Chapters as intended: one family, personal use, not
          resale or automated scraping. Don&rsquo;t attempt to disrupt the service or
          impersonate other people.
        </p>
      </section>

      <section>
        <h2>Accounts and ending service</h2>
        <p>
          Keep your parent account secure and use accurate account information. You can
          delete your account from <Link href="/settings">Settings</Link>. We may suspend
          or end access when an account is used to harm the service or other people.
        </p>
      </section>

      <section>
        <h2>Service availability</h2>
        <p>
          We work to keep Little Chapters available, but internet and AI services can
          occasionally be interrupted or return imperfect results. We do not promise
          uninterrupted availability. When a provider is unavailable, the app may use
          a reviewed built-in story or illustration so a reading session can continue.
        </p>
      </section>

      <section>
        <h2>Changes and contact</h2>
        <p>
          We may update these terms as the product evolves. Material changes will
          be announced in-app before they take effect. For questions or help,
          see <Link href="/support">Support</Link>.
        </p>
      </section>

      <footer className="lc-policy-footer">
        <Link href="/privacy">Privacy</Link>
        <Link href="/support">Support</Link>
        <Link href="/">Home</Link>
      </footer>
    </main>
  );
}
