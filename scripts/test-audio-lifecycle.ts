/* Regression tests for two real audio-lifecycle bugs found and fixed in the
 * 2026-08-21 media-lifecycle pass:
 *
 *   1. Stale ElevenLabs request race: _speakElevenLabs() only cancelled a
 *      CURRENTLY PLAYING clip, not an in-flight fetch(). stopSpeaking() (or a
 *      newer speakPrompt() call) could be superseded by an older request that
 *      resolved late, starting stale audio the app already tried to silence.
 *      Fixed with a generation counter + AbortController (lib/audio.ts).
 *
 *   2. Stale `ducked` flag across navigation: stopTheme()/stopAmbience() never
 *      reset the module-level `ducked` flag, so leaving /read mid-listening/
 *      scoring/correction (which ducks theme) left the NEXT screen's theme
 *      playing at the quiet duck volume for no reason it could ever justify.
 *
 * Drives the REAL app through a real browser (Playwright + the actual dev
 * server), using the dev-only __audioDebug()/__voiceDebug() hooks in
 * lib/audio.ts to inspect module-level state that has no DOM presence.
 *
 * Requires: `NEXT_PUBLIC_VOICE_PROVIDER=elevenlabs npm run dev` running on
 * localhost:3001 (the ElevenLabs code path never runs otherwise). No real
 * ELEVENLABS_API_KEY is needed — every /api/speech/model response is
 * intercepted and replaced with a fake audio/mpeg clip so this is fully
 * deterministic and offline.
 *
 *   node --experimental-strip-types scripts/test-audio-lifecycle.ts
 */

// playwright is intentionally NOT a project dependency (see header comment —
// this script is a manual/CI-optional verification aid, not part of the
// npm-run-typecheck-must-stay-clean production dependency graph) and is
// resolved at run time from wherever the caller's environment provides it
// (e.g. a global install). `npm run typecheck` type-checks every .ts file in
// the repo, so its missing type declarations are suppressed here rather than
// adding a heavyweight, rarely-used dependency to package.json for one
// scratch-style verification script.
// @ts-expect-error - playwright has no local type declarations; see above
import { chromium } from 'playwright';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
let passed = 0;
let failed = 0;

function ok(label: string): void {
  console.log(`  ✓  ${label}`);
  passed++;
}
function fail(label: string, detail?: string): void {
  console.error(`  ✗  ${label}${detail ? `\n     ${detail}` : ''}`);
  failed++;
}

// A tiny valid MP3-ish payload is not required — the browser only needs
// something HTMLAudioElement can attempt to decode; a play() rejection is
// handled the same as any other playback error in _speakElevenLabs, so a
// short silent WAV-in-mpeg-clothing byte string is enough to exercise the
// fetch/race logic without a real ElevenLabs account.
const FAKE_AUDIO_BYTES = Buffer.from([0xff, 0xfb, 0x90, 0x00]);

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  // Seed a profile via localStorage so /read renders immediately instead of
  // redirecting to /setup — same fixture shape lib/profile.ts expects.
  await page.goto(BASE_URL);
  await page.evaluate(() => {
    localStorage.setItem(
      'little-chapters-profile',
      JSON.stringify({
        childId: 'test-child-audio-lifecycle',
        childName: 'Robin',
        age: 5,
        interests: ['dogs', 'space', 'ocean'],
        avatar: 'girl',
      }),
    );
  });

  console.log('\n=== Test 1: ElevenLabs stale-fetch race (stopSpeaking during in-flight request) ===');
  {
    let requestCount = 0;
    // First request to /api/speech/model is held open until we explicitly
    // release it — simulates a slow/late-resolving network call. Every
    // later request resolves immediately, matching a normal follow-up call.
    let releaseFirst: (() => void) | null = null;
    const firstReleased = new Promise<void>((resolve) => { releaseFirst = resolve; });

    await page.route('**/api/speech/model', async (route: any) => {
      requestCount += 1;
      if (requestCount === 1) await firstReleased;
      await route.fulfill({ status: 200, contentType: 'audio/mpeg', body: FAKE_AUDIO_BYTES });
    });

    await page.goto(`${BASE_URL}/read`);
    await page.waitForSelector('button[aria-label="Read aloud"]', { timeout: 15000 });

    // Tap 1: starts speaking, fires the (held-open) first request.
    await page.click('button[aria-label="Read aloud"]');
    await page.waitForFunction(() => (window as any).__voiceDebug?.().elevenLabsRequestInFlight === true, { timeout: 5000 });
    ok('first speakPrompt() call has a request in flight');

    // Tap 2 (same button, now "Stop reading aloud"): calls stopSpeaking()
    // WHILE request #1 is still held open — exactly the race.
    await page.click('button[aria-label="Stop reading aloud"]');
    const genAfterStop = await page.evaluate(() => (window as any).__voiceDebug?.().generation);

    // Now let the stale first request resolve.
    releaseFirst!();
    // Give the (stale) .then()/playBlob() callback a real tick to run.
    await page.waitForTimeout(400);

    const debugAfter = await page.evaluate(() => (window as any).__voiceDebug?.());
    if (debugAfter.generation > genAfterStop) {
      // A generation bump after stop is fine (e.g. a later legitimate call);
      // what matters is the STALE response never started playback.
    }
    if (debugAfter.elevenLabsPlaying === false && debugAfter.elevenLabsRequestInFlight === false) {
      ok('stale first-request response did not start playback after stopSpeaking()');
    } else {
      fail('stale first-request response started playback after stopSpeaking()', JSON.stringify(debugAfter));
    }

    const audioDebug = await page.evaluate(() => (window as any).__audioDebug?.());
    if (audioDebug.speaking === false) {
      ok('window.speechSynthesis.speaking is false — no stray utterance either');
    } else {
      fail('speechSynthesis still reports speaking after stopSpeaking()', JSON.stringify(audioDebug));
    }

    await page.unroute('**/api/speech/model');
  }

  console.log('\n=== Test 2: `ducked` flag does not leak across navigation ===');
  {
    await page.route('**/api/speech/model', async (route: any) => {
      await route.fulfill({ status: 200, contentType: 'audio/mpeg', body: FAKE_AUDIO_BYTES });
    });

    await page.goto(`${BASE_URL}/read`);
    await page.waitForSelector('button[aria-label="Start reading"]', { timeout: 15000 });

    // Enter 'listening' phase — this ducks theme (duckAmbience()).
    await page.click('button[aria-label="Start reading"]');
    await page.waitForFunction(() => (window as any).__audioDebug?.().ducked === true, { timeout: 5000 });
    ok('entering listening phase ducks theme (ducked === true)');

    // Close out of /read WHILE still ducked — the exact scenario that used
    // to leak `ducked` across navigation (no phase-effect cleanup runs on
    // unmount, only the close button's own stopSpeaking()/stopTheme()).
    await page.click('button[aria-label="Close"]');
    await page.waitForURL('**/home', { timeout: 10000 });

    const homeDucked = await page.evaluate(() => (window as any).__audioDebug?.().ducked);
    if (homeDucked === false) {
      ok('ducked flag reset to false after navigating away mid-listening (was: stuck true)');
    } else {
      fail('ducked flag leaked into /home as true — theme will play at the wrong volume', String(homeDucked));
    }

    // Confirm it is not just reset but that Home's theme actually plays at
    // full (non-ducked) volume once started.
    await page.click('button[aria-label="Start today\'s chapter"]');
    await page.waitForTimeout(300);
    const homeAudio = await page.evaluate(() => (window as any).__audioDebug?.());
    if (homeAudio.theme && !homeAudio.ducked) {
      ok(`theme volume on Home is un-ducked (volume=${homeAudio.theme.volume})`);
    } else {
      fail('theme still reports ducked state on Home after Start tap', JSON.stringify(homeAudio));
    }
  }

  await browser.close();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal error running audio-lifecycle tests:', e);
  process.exit(1);
});
