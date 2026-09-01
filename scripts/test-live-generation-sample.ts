import { generateStoryDraft } from '../lib/story-generator.server.ts';
import type { InterestId } from '../lib/profile.ts';

const cases: Array<{ stage:number; interest:InterestId; childName:string; companionName:string }> = [];
const interests: InterestId[] = ['dogs','space','dinosaurs','trains','unicorns','ocean'];
const names = ['Mia','Sam','Leo','Nia','Ava'];
const companions = ['Pip','Momo','Tavi','Nori'];
for (let index = 0; index < 20; index += 1) cases.push({ stage:[1,3,5,7,9][index % 5], interest:interests[index % interests.length], childName:names[index % names.length], companionName:companions[index % companions.length] });

async function main() {
 if (!process.env.OPENAI_API_KEY) {
  console.log(JSON.stringify({ status:'UNVERIFIED', reason:'OPENAI_API_KEY is unavailable in this execution environment', attempted:0, required:20 }, null, 2));
 } else {
  const outcomes: Array<{ stage:number; interest:InterestId; ok:boolean; attempts:number; acceptedAttempt:number | null; rules:string[] }> = [];
  for (const sample of cases) {
    const outcome = await generateStoryDraft({ ...sample, interests:[sample.interest] });
    outcomes.push({ stage:sample.stage, interest:sample.interest, ok:outcome.ok, attempts:outcome.diagnostic.attempts.length,
      acceptedAttempt:outcome.diagnostic.attempts.find((attempt) => attempt.result === 'accepted')?.attempt ?? null,
      rules:[...new Set(outcome.diagnostic.attempts.flatMap((attempt) => attempt.ruleCodes))] });
  }
  const accepted = outcomes.filter((outcome) => outcome.ok);
  const byRule = Object.fromEntries([...new Set(outcomes.flatMap((outcome) => outcome.rules))].map((rule) => [rule, outcomes.filter((outcome) => outcome.rules.includes(rule)).length]));
  console.log(JSON.stringify({ status:'VERIFIED', attempted:outcomes.length, providerSuccess:outcomes.filter((outcome) => outcome.attempts > 0).length,
    validBlueprints:accepted.length, attempt1Success:accepted.filter((outcome) => outcome.acceptedAttempt === 1).length,
    eventualSuccess:accepted.length, failuresByRule:byRule, outcomes }, null, 2));
 }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
