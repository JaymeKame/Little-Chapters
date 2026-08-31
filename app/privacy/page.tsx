/* /privacy — V1 parent-facing summary of what Little Chapters collects and
 * how it is used. Written in plain English, not legalese. Marked DRAFT so
 * counsel review is visible rather than implied — never remove that badge
 * without a review sign-off. */

import Link from 'next/link';

export const metadata = { title: 'Privacy — Little Chapters' };

export default function PrivacyPage() {
  return (
    <main className="lc-policy">
      <header className="lc-policy-header">
        <Link href="/" className="lc-policy-back" aria-label="Back to Little Chapters">‹</Link>
        <div>
          <span className="lc-policy-eyebrow">DRAFT — pending counsel review</span>
          <h1>Privacy</h1>
          <p>Last updated August 31, 2026.</p>
        </div>
      </header>

      <section>
        <h2>What we collect</h2>
        <p>
          When a parent sets up Little Chapters we collect the child&rsquo;s first name, age,
          chosen reading themes, and any optional context the parent enters to help us make
          stories relevant. We collect the parent&rsquo;s email once they sign in (through
          Google or Apple), and their mobile number if they choose SMS reading notes.
        </p>
        <p>
          While your child reads, we process the audio their microphone captures so we can
          gently support decoding. We keep short reading progress records
          (words practiced, chapters completed) so today&rsquo;s chapter fits their level
          and tomorrow&rsquo;s picks up where they left off.
        </p>
      </section>

      <section>
        <h2>How AI fits in</h2>
        <p>
          Little Chapters uses AI to write and adapt each daily chapter to your child&rsquo;s
          reading level and interests, and to help generate illustrations. Reading audio
          is processed by speech-to-text and pronunciation providers so we can support
          decoding &mdash; we don&rsquo;t use it to build a voice profile of your child.
          Chapters go through automated safety checks before your child sees them.
        </p>
      </section>

      <section>
        <h2>How we use information</h2>
        <ul>
          <li>To personalize your child&rsquo;s daily chapter and reading support.</li>
          <li>To send you the short after-session note in the app (and by SMS if you opted in).</li>
          <li>To operate the subscription (billed by Stripe).</li>
          <li>To fix problems and keep the service safe.</li>
        </ul>
        <p>We do not sell information about your family.</p>
      </section>

      <section>
        <h2>Who processes it</h2>
        <p>
          We work with a small set of providers to run Little Chapters: Firebase for
          accounts and storage, Stripe for billing, and speech/language providers
          (currently Microsoft Azure, an internal pronunciation model, ElevenLabs, and
          OpenAI) for the reading experience. Each processes only what they need to
          run their part of the service.
        </p>
      </section>

      <section>
        <h2>Your choices</h2>
        <p>
          You can update your child&rsquo;s profile and communication preferences from
          <Link href="/settings"> Settings</Link>. You can delete your account and
          associated data from that same page. If any part of this policy is unclear,
          please reach out through <Link href="/support">Support</Link>.
        </p>
      </section>

      <footer className="lc-policy-footer">
        <Link href="/terms">Terms</Link>
        <Link href="/support">Support</Link>
        <Link href="/">Home</Link>
      </footer>
    </main>
  );
}
