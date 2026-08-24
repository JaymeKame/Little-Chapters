/* Smoke-test the voice provider configuration.
 *
 *   npm run test:voice                — tests GET /api/speech/model (metadata)
 *   npm run test:voice -- --speak "Hello there"
 *                                     — also POSTs text and saves output.mp3
 *
 * The dev server must be running (npm run dev) before calling this script.
 * When ELEVENLABS_API_KEY is unset the GET probe confirms web-speech fallback;
 * the --speak probe is skipped with an explanation.
 *
 * Exit code 0 = all attempted checks passed.
 * Exit code 1 = any check failed.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* Minimal .env.local loader so the script can check ELEVENLABS_API_KEY. */
try {
  for (const line of readFileSync(join(root, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {
  /* no .env.local — rely on the environment */
}

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
const args = process.argv.slice(2);
const speakIdx = args.indexOf('--speak');
const speakText = speakIdx !== -1 ? args[speakIdx + 1] : null;

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

/* ── GET /api/speech/model ─────────────────────────────────────────────── */

console.log(`\nVoice provider probe — ${BASE_URL}\n`);

let providerRes: Response;
try {
  providerRes = await fetch(`${BASE_URL}/api/speech/model`);
} catch (e) {
  fail('GET /api/speech/model', `Network error — is the dev server running? (${String(e)})`);
  process.exit(1);
}

if (!providerRes.ok) {
  fail('GET /api/speech/model', `HTTP ${providerRes.status}`);
  process.exit(1);
}

const providerData = (await providerRes.json()) as Record<string, unknown>;
ok(`GET /api/speech/model → HTTP ${providerRes.status}`);
console.log(`     provider: ${providerData.provider}`);
if (providerData.voiceId) console.log(`     voiceId:  ${providerData.voiceId}`);
if (providerData.modelId) console.log(`     modelId:  ${providerData.modelId}`);
if (providerData.note)    console.log(`     note:     ${providerData.note}`);

const isElevenLabs = providerData.provider === 'elevenlabs';

/* ── POST /api/speech/model (optional --speak probe) ──────────────────── */

if (speakText) {
  if (!isElevenLabs) {
    console.log(`\n  –  Skipping --speak probe: provider is "${String(providerData.provider)}" (ElevenLabs not configured).`);
  } else {
    console.log(`\nElevenLabs TTS probe — "${speakText}"\n`);
    let ttsRes: Response;
    try {
      ttsRes = await fetch(`${BASE_URL}/api/speech/model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: speakText }),
      });
    } catch (e) {
      fail('POST /api/speech/model', String(e));
      process.exit(1);
    }

    if (!ttsRes.ok) {
      const body = await ttsRes.text().catch(() => '');
      fail('POST /api/speech/model', `HTTP ${ttsRes.status}: ${body}`);
    } else {
      const ct = ttsRes.headers.get('content-type') ?? '';
      if (!ct.includes('audio')) {
        fail('POST /api/speech/model', `Expected audio content-type, got: ${ct}`);
      } else {
        const buf = await ttsRes.arrayBuffer();
        const outPath = join(root, 'output.mp3');
        writeFileSync(outPath, Buffer.from(buf));
        ok(`POST /api/speech/model → ${ct}, ${buf.byteLength} bytes`);
        console.log(`     Saved to ${outPath}`);
      }
    }
  }
}

/* ── Summary ───────────────────────────────────────────────────────────── */

console.log(`\n${passed + failed} check(s): ${passed} passed, ${failed} failed.\n`);
process.exit(failed > 0 ? 1 : 0);
