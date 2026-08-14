/* Feed a WAV file through the same Azure pronunciation assessment the
 * browser pipeline uses — for testing with recorded child speech instead of
 * a live mic (e.g. speechocean762 clips, or a kid's saved recording).
 *
 *   node scripts/assess-wav.ts <file.wav> "<reference text>" [locale]
 *
 * Mirrors lib/pronunciation.ts exactly: same PronunciationAssessmentConfig
 * (miscue, phoneme granularity, IPA, prosody for English), same kid-friendly
 * timeouts, continuous recognition, and the SAME exported aggregate() for
 * passage-level scoring — so this validates the real scoring path, only the
 * audio source differs (WAV file instead of getUserMedia).
 *
 * Reads AZURE_SPEECH_KEY / AZURE_SPEECH_REGION from .env.local (or the
 * environment). If a sibling <file>.json exists with speechocean762-style
 * expert scores {accuracy,fluency,prosodic,total: 0-10}, prints them ×10
 * next to Azure's 0-100 scores for comparison.                              */

import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregate, type WordScore } from '../lib/pronunciation.ts';

const require = createRequire(import.meta.url);
// CJS package — createRequire sidesteps ESM named-export interop pitfalls.
const sdk = require('microsoft-cognitiveservices-speech-sdk');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* Minimal .env.local loader (Next.js isn't running here). */
try {
  for (const line of readFileSync(join(root, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {
  /* no .env.local — rely on the environment */
}

const [wavPath, referenceText, locale = 'en-US'] = process.argv.slice(2);
if (!wavPath || !referenceText) {
  console.error('Usage: node scripts/assess-wav.ts <file.wav> "<reference text>" [locale]');
  process.exit(1);
}
const key = process.env.AZURE_SPEECH_KEY;
const region = process.env.AZURE_SPEECH_REGION;
if (!key || !region) {
  console.error('AZURE_SPEECH_KEY / AZURE_SPEECH_REGION not set — see docs/AZURE_SPEECH_SETUP.md.');
  process.exit(1);
}

const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
speechConfig.speechRecognitionLanguage = locale;
speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, '15000');
speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, '2200');

const paConfig = new sdk.PronunciationAssessmentConfig(
  referenceText,
  sdk.PronunciationAssessmentGradingSystem.HundredMark,
  sdk.PronunciationAssessmentGranularity.Phoneme,
  true,
);
paConfig.phonemeAlphabet = 'IPA';
if (locale.toLowerCase().startsWith('en')) paConfig.enableProsodyAssessment = true;

const audioConfig = sdk.AudioConfig.fromWavFileInput(readFileSync(resolve(wavPath)));
const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
paConfig.applyTo(recognizer);

const segments: unknown[] = [];
const transcriptParts: string[] = [];
let cancelError: string | null = null;

recognizer.recognized = (_s: unknown, e: { result: { reason: number; text?: string; properties: { getProperty(id: number): string } } }) => {
  if (e.result.reason !== sdk.ResultReason.RecognizedSpeech) return;
  const json = e.result.properties.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult);
  if (!json) return;
  segments.push(JSON.parse(json));
  if (e.result.text) transcriptParts.push(e.result.text);
};
recognizer.canceled = (_s: unknown, e: { reason: number; errorDetails?: string }) => {
  if (e.reason === sdk.CancellationReason.Error) cancelError = e.errorDetails ?? 'Speech service error.';
};

await new Promise<void>((resolvePromise, rejectPromise) => {
  recognizer.sessionStopped = () => resolvePromise();
  recognizer.startContinuousRecognitionAsync(
    () => {},
    (err: string) => rejectPromise(new Error(err)),
  );
});
await new Promise<void>((r) => recognizer.stopContinuousRecognitionAsync(r, () => r()));
recognizer.close();

if (cancelError && segments.length === 0) {
  console.error(`Assessment failed: ${cancelError}`);
  process.exit(1);
}

const { scores, words } = aggregate(segments as never[], referenceText);

console.log(`\nReference:  ${referenceText}`);
console.log(`Heard:      ${transcriptParts.join(' ') || '(nothing recognized)'}`);
if (cancelError) console.log(`⚠️  partial — connection error mid-file: ${cancelError}`);

console.log('\nAzure scores (0-100):');
console.log(`  overall ${scores.pronunciation}  accuracy ${scores.accuracy}  fluency ${scores.fluency}  completeness ${scores.completeness}  prosody ${scores.prosody ?? '–'}`);

const metaPath = resolve(wavPath).replace(/\.wav$/i, '.json');
if (existsSync(metaPath)) {
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
    accuracy?: number; fluency?: number; prosodic?: number; total?: number;
    words?: { text?: string; accuracy?: number }[];
  };
  if (meta.total != null) {
    console.log('Expert scores (speechocean762, ×10 to match):');
    console.log(`  overall ${meta.total! * 10}  accuracy ${(meta.accuracy ?? NaN) * 10}  fluency ${(meta.fluency ?? NaN) * 10}  prosody ${(meta.prosodic ?? NaN) * 10}`);
  }
  if (meta.words) {
    console.log('Expert per-word: ' + meta.words.map((w) => `${w.text} ${(w.accuracy ?? NaN) * 10}`).join(', '));
  }
}

console.log('\nPer-word (Azure):');
for (const w of words as WordScore[]) {
  const flag = w.errorType === 'None' ? ' ' : ` [${w.errorType}]`;
  const phones = w.phonemes.length ? `   ${w.phonemes.map((p) => `${p.phoneme}:${p.accuracy ?? '–'}`).join(' ')}` : '';
  console.log(`  ${w.word.padEnd(14)} ${String(w.accuracy ?? '–').padStart(4)}${flag}${phones}`);
}

if (process.env.RAW) console.log('\nRaw segments:\n' + JSON.stringify(segments, null, 2));
