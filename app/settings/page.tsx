'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { INTERESTS, saveProfile, type ChildProfile, type InterestId } from '@/lib/profile';
import { resolveProfile, saveAccountProfile } from '@/lib/profile-repository';
import {
  DEFAULT_PREFERENCES, resolvePreferences, savePreferences,
  type ConsumerPreferences, type DifficultyObservation, type ParentCommunication,
} from '@/lib/preferences';

export default function SettingsPage() {
  const router = useRouter();
  const { user, loading: authLoading, isAuthenticated, saveParentPhoneNumber, signOut } = useAuth();
  const [profile, setProfile] = useState<ChildProfile | null>(null);
  const [prefs, setPrefs] = useState<ConsumerPreferences>(DEFAULT_PREFERENCES);
  const [subscription, setSubscription] = useState<'loading' | 'active' | 'inactive' | 'unavailable'>('loading');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    void Promise.all([resolveProfile(user), resolvePreferences(user)]).then(([resolved, preferences]) => {
      if (!resolved.profile) { router.replace('/setup'); return; }
      setProfile(resolved.profile); setPrefs(preferences);
    });
    if (!user || user.isAnonymous) { setSubscription('inactive'); return; }
    void user.getIdToken().then((token) => fetch('/api/payments/subscription', { headers: { Authorization: `Bearer ${token}` } }))
      .then(async (response) => response.ok ? (await response.json() as { subscribed?: boolean }) : null)
      .then((data) => setSubscription(data ? (data.subscribed ? 'active' : 'inactive') : 'unavailable'))
      .catch(() => setSubscription('unavailable'));
  }, [authLoading, router, user]);

  function patchPreferences<K extends keyof ConsumerPreferences>(key: K, value: ConsumerPreferences[K]) {
    setPrefs((current) => ({ ...current, [key]: value }));
  }

  function toggleTheme(id: InterestId) {
    setProfile((current) => current ? {
      ...current,
      interests: current.interests.includes(id)
        ? current.interests.filter((item) => item !== id)
        : [...current.interests, id].slice(-3),
    } : current);
  }

  async function persist() {
    if (!profile) return;
    setSaving(true); setStatus('');
    try {
      saveProfile(profile);
      if (user && !user.isAnonymous) await saveAccountProfile(user, profile);
      if (prefs.communication === 'sms' && prefs.phoneNumber.trim()) await saveParentPhoneNumber(prefs.phoneNumber);
      await savePreferences(user, prefs);
      setStatus('Saved');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not save settings.'); }
    finally { setSaving(false); }
  }

  async function managePlan() {
    if (!user || user.isAnonymous) { router.push('/unlock'); return; }
    const response = await fetch('/api/payments/portal', { method: 'POST', headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
    const data = await response.json().catch(() => ({})) as { url?: string };
    if (response.ok && data.url) window.location.href = data.url;
    else setStatus('Subscription management is unavailable right now.');
  }

  if (!profile) return <SettingsLoading />;

  return (
    <main className="lc-settings-shell">
      <header className="lc-settings-header">
        <button className="lc-settings-back" onClick={() => router.push('/home')} aria-label="Back to child Home">‹</button>
        <div><span className="lc-settings-eyebrow">For grown-ups</span><h1>Settings</h1></div>
        <button className="lc-settings-report" onClick={() => router.push('/parent')}>Reading notes</button>
      </header>

      <section className="lc-settings-section">
        <div className="lc-settings-section-title"><span>01</span><div><h2>Their child</h2><p>These details shape the stories and starting difficulty.</p></div></div>
        <div className="lc-settings-grid two">
          <label>Child&rsquo;s name<input value={profile.childName} maxLength={40} onChange={(e) => setProfile({ ...profile, childName: e.target.value })} /></label>
          <label>Age<input type="number" min={3} max={12} value={profile.age} onChange={(e) => setProfile({ ...profile, age: Math.min(12, Math.max(3, Number(e.target.value))) })} /></label>
        </div>
        <fieldset><legend>Favorite themes <small>Choose up to three</small></legend><div className="lc-settings-chips">
          {INTERESTS.map((interest) => <button type="button" key={interest.id} className={profile.interests.includes(interest.id) ? 'is-selected' : ''} onClick={() => toggleTheme(interest.id)}>{interest.label}</button>)}
        </div></fieldset>
        <Segmented<DifficultyObservation> label="How has the reading felt lately?" value={prefs.difficultyObservation} onChange={(value) => patchPreferences('difficultyObservation', value)} options={[['too-easy','Too easy'],['about-right','About right'],['too-hard','Too hard']]} />
        <p className="lc-settings-note">This is guidance for the adaptive system. It never directly replaces validated reading progress.</p>
      </section>

      <section className="lc-settings-section">
        <div className="lc-settings-section-title"><span>02</span><div><h2>Reading experience</h2><p>Keep the story calm and comfortable.</p></div></div>
        <Segmented label="Background music" value={prefs.music} onChange={(value) => patchPreferences('music', value)} options={[['off','Off'],['low','Low'],['normal','Normal']]} />
      </section>

      <section className="lc-settings-section">
        <div className="lc-settings-section-title"><span>03</span><div><h2>Parent communication</h2><p>Choose how the short post-session note reaches you.</p></div></div>
        <Segmented<ParentCommunication> label="Reading note" value={prefs.communication} onChange={(value) => patchPreferences('communication', value)} options={[['in-app','In app'],['sms','SMS'],['off','Off']]} />
        {prefs.communication === 'sms' && <label>Mobile number<input type="tel" value={prefs.phoneNumber} onChange={(e) => patchPreferences('phoneNumber', e.target.value)} placeholder="(555) 123-4567" /></label>}
      </section>

      <section className="lc-settings-section">
        <div className="lc-settings-section-title"><span>04</span><div><h2>Account</h2><p>Plan, sign-in, and family data.</p></div></div>
        <div className="lc-account-row"><div><strong>{subscription === 'active' ? 'Active membership' : subscription === 'loading' ? 'Checking membership…' : 'No active membership'}</strong><span>{isAuthenticated ? user?.email ?? 'Signed in' : 'Anonymous free trial'}</span></div><button onClick={managePlan}>{subscription === 'active' ? 'Manage plan' : 'View plans'}</button></div>
        <div className="lc-account-links"><button onClick={() => document.getElementById('privacy-note')?.scrollIntoView({ behavior: 'smooth' })}>Privacy &amp; data</button>{isAuthenticated && <button onClick={async () => { await signOut(); router.replace('/'); }}>Log out</button>}</div>
        <p id="privacy-note" className="lc-settings-note">Little Chapters stores the child profile and reading progress needed to personalize the experience. Contact support to request access or deletion.</p>
      </section>

      <div className="lc-settings-save"><button className="btn-primary" onClick={persist} disabled={saving || !profile.childName.trim() || profile.interests.length === 0}>{saving ? 'Saving…' : 'Save settings'}</button><span role="status">{status}</span></div>
    </main>
  );
}

function SettingsLoading() { return <main className="lc-settings-shell"><div className="lc-settings-loading"><span /><h1>Opening family settings…</h1></div></main>; }

function Segmented<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (value: T) => void; options: [T,string][] }) {
  return <fieldset><legend>{label}</legend><div className="lc-settings-segmented">{options.map(([id,text]) => <button type="button" key={id} className={value === id ? 'is-selected' : ''} onClick={() => onChange(id)}>{text}</button>)}</div></fieldset>;
}
