import { chromium } from 'playwright';

const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
let passed = 0;

async function check(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
  passed += 1;
  console.log(`  ✓  ${label}`);
}

await page.goto(base);
// Copy updated as part of the V1 final-polish pass — headline is now
// "A short daily reading adventure." (see app/page.tsx). This selector
// gets the child's-first-name-invitation-shaped CTA instead so it stays
// robust across small copy tweaks.
await page.waitForSelector('text=Try a Chapter Free Tonight');
await check(page.url() === `${base}/`, 'new anonymous visitor remains on acquisition');

await page.evaluate(() => localStorage.setItem('little-chapters-profile', JSON.stringify({
  childId: 'entry-browser-child', childName: 'Sam', age: 6,
  interests: ['dogs', 'space', 'ocean'], createdAt: Date.now(),
})));
await page.goto(base);
await page.waitForURL('**/home');
await check(page.url().endsWith('/home'), 'known same-browser profile bypasses acquisition');

await page.goto(`${base}/setup`);
await page.waitForURL('**/home');
await check(page.url().endsWith('/home'), 'Setup cannot overwrite an existing profile');

await browser.close();
console.log(`Entry browser: ${passed} passed, 0 failed`);
