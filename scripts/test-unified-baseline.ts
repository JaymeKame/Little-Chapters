import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path: string) => readFileSync(path, 'utf8');
const auth = source('components/AuthProvider.tsx');
const root = source('app/page.tsx');
const setup = source('app/setup/page.tsx');
const payment = source('app/payment/success/page.tsx');
const checkout = source('app/api/payments/checkout/route.ts');
const story = source('app/api/chapters/story/route.ts');
const visuals = source('app/api/chapters/visuals/route.ts');
const audio = source('lib/audio.ts');
const read = source('app/read/page.tsx');
const css = source('app/globals.css');
const successStar = source('components/SuccessStar.tsx');

assert.match(auth, /linkWithPopup/);
assert.match(auth, /signInWithCredential/);
const firebaseImport = auth.slice(auth.indexOf("from 'firebase/auth'") - 500, auth.indexOf("from 'firebase/auth'") + 30);
assert.doesNotMatch(firebaseImport, /signInWithRedirect|getRedirectResult/);
assert.match(auth, /mirrorLocalProfile/);
assert.match(root, /resolveRootEntry/);
assert.match(setup, /loadProfile\(\)/);
assert.match(payment, /session_id/);
assert.match(checkout, /checkoutReturnUrl\(request, '\/payment\/success\?session_id=/);

assert.match(story, /resolveChapterEntitlement/);
assert.match(story, /ownedDailyChapter/);
assert.doesNotMatch(story, /SUBSCRIPTION_REQUIRED/);
assert.match(visuals, /export async function GET/);
assert.match(visuals, /export async function POST/);
assert.match(visuals, /existing\.exists/);

assert.match(audio, /MOBILE_OUTPUT_HANDOFF_MS/);
assert.match(audio, /resumeInterruptedCorrection/);
assert.match(audio, /subscribeVoiceTelemetry/);
assert.match(read, /audioSession/);
assert.match(read, /requested === 'sight-correction'/);
assert.match(read, /SuccessStar/);
assert.match(successStar, /<svg/);
assert.match(css, /\.lc-scene-bg\s*\{[\s\S]{0,100}inset:\s*0/);
assert.doesNotMatch(css, /\.lc-scene-bg\s*\{[^}]*width:\s*62%/);

console.log('Unified commercial baseline: 24 assertions passed, 0 failed');
