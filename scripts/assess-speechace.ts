/* Feed a WAV file through SpeechAce's scripted-text scoring API — the
 * counterpart of scripts/assess-wav.ts (Azure) for vendor comparison.
 *
 *   node scripts/assess-speechace.ts <file.wav> "<reference text>" [dialect]
 *
 * SpeechAce is batch REST (finished audio upload), not streaming: one POST to
 * /api/scoring/text/v9/json returns overall + per-word + per-phone scores
 * (0–100), and — on Pro-tier plans/trials — fluency (words-correct-per-minute,
 * pauses) and intonation via include_fluency/include_intonation.
 *
 * Reads SPEECHACE_API_KEY from .env.local (or the environment).
 * SAVE_JSON=1 writes the full raw response to <file>.speechace.json.
 * If a sibling <file>.json holds speechocean762 expert scores, prints them
 * alongside, same as assess-wav.ts.                                          */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  for (const line of readFileSync(join(root, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {
  /* no .env.local — rely on the environment */
}

const [wavPath, referenceText, dialect = 'en-us'] = process.argv.slice(2);
if (!wavPath || !referenceText) {
  console.error('Usage: node scripts/assess-speechace.ts <file.wav> "<reference text>" [dialect]');
  process.exit(1);
}
const key = process.env.SPEECHACE_API_KEY;
if (!key) {
  console.error('SPEECHACE_API_KEY not set — add it to .env.local (SpeechAce dashboard → API key).');
  process.exit(1);
}

/* Response subset we consume (everything is preserved via SAVE_JSON). */
interface SpeechacePhone {
  phone?: string;
  quality_score?: number;
  sound_most_like?: string | null;
}
interface SpeechaceWord {
  word?: string;
  quality_score?: number;
  phone_score_list?: SpeechacePhone[];
}
interface SpeechaceResponse {
  status?: string;
  short_message?: string;
  detail_message?: string;
  text_score?: {
    quality_score?: number;
    word_score_list?: SpeechaceWord[];
    fluency?: {
      overall_metrics?: {
        word_correct_per_minute?: number;
        correct_word_count?: number;
        word_count?: number;
        all_pause_count?: number;
        all_pause_duration?: number;
        speech_rate?: number;
      };
    };
    speechace_score?: { pronunciation?: number; fluency?: number };
    cefr_score?: { pronunciation?: string; fluency?: string };
  };
}

const url =
  `https://api.speechace.co/api/scoring/text/v9/json` +
  `?key=${encodeURIComponent(key)}&dialect=${encodeURIComponent(dialect)}&user_id=calibration-study`;

const form = new FormData();
form.append('text', referenceText);
form.append('user_audio_file', new Blob([readFileSync(resolve(wavPath))], { type: 'audio/wav' }), basename(wavPath));
// Pro-tier extras — harmless on Basic (SpeechAce ignores or errors them; we retry without on error).
form.append('include_fluency', '1');
form.append('include_intonation', '1');

let res = await fetch(url, { method: 'POST', body: form });
let data = (await res.json()) as SpeechaceResponse;
if (data.status !== 'success' && /fluency|intonation|plan|premium|pro/i.test(data.detail_message ?? data.short_message ?? '')) {
  // Plan doesn't cover the extras — retry with pronunciation only.
  const bare = new FormData();
  bare.append('text', referenceText);
  bare.append('user_audio_file', new Blob([readFileSync(resolve(wavPath))], { type: 'audio/wav' }), basename(wavPath));
  res = await fetch(url, { method: 'POST', body: bare });
  data = (await res.json()) as SpeechaceResponse;
}
if (data.status !== 'success') {
  console.error(`SpeechAce error (HTTP ${res.status}): ${data.short_message ?? ''} ${data.detail_message ?? ''}`.trim());
  process.exit(1);
}

if (process.env.SAVE_JSON) {
  const out = resolve(wavPath).replace(/\.wav$/i, '.speechace.json');
  writeFileSync(out, JSON.stringify(data, null, 1));
}

const ts = data.text_score ?? {};
const words = ts.word_score_list ?? [];
console.log(`\nReference:  ${referenceText}`);
console.log(`SpeechAce overall quality: ${ts.quality_score ?? '–'} / 100`);
if (ts.speechace_score) {
  console.log(`  speechace_score — pronunciation ${ts.speechace_score.pronunciation ?? '–'}, fluency ${ts.speechace_score.fluency ?? '–'}`);
}
const fm = ts.fluency?.overall_metrics;
if (fm) {
  console.log(
    `  fluency — WCPM ${fm.word_correct_per_minute ?? '–'}, words correct ${fm.correct_word_count ?? '–'}/${fm.word_count ?? '–'}, ` +
      `pauses ${fm.all_pause_count ?? '–'} (${fm.all_pause_duration ?? '–'}s), speech rate ${fm.speech_rate ?? '–'}`,
  );
}

const metaPath = resolve(wavPath).replace(/\.wav$/i, '.json');
if (existsSync(metaPath)) {
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
    expert?: { accuracy?: number; fluency?: number; prosodic?: number; total?: number };
    expert_words?: { text?: string; accuracy?: number }[];
  };
  if (meta.expert?.total != null) {
    console.log(
      `Expert (×10): overall ${meta.expert.total * 10}  accuracy ${(meta.expert.accuracy ?? NaN) * 10}  fluency ${(meta.expert.fluency ?? NaN) * 10}`,
    );
  }
  if (meta.expert_words) {
    console.log('Expert per-word: ' + meta.expert_words.map((w) => `${w.text} ${(w.accuracy ?? NaN) * 10}`).join(', '));
  }
}

console.log('\nPer-word (SpeechAce):');
for (const w of words) {
  const phones = (w.phone_score_list ?? [])
    .map((p) => {
      const heard = p.sound_most_like && p.sound_most_like !== p.phone ? `→${p.sound_most_like}` : '';
      return `${p.phone}${heard}:${p.quality_score != null ? Math.round(p.quality_score) : '–'}`;
    })
    .join(' ');
  console.log(`  ${(w.word ?? '?').padEnd(14)} ${String(w.quality_score != null ? Math.round(w.quality_score) : '–').padStart(4)}   ${phones}`);
}
