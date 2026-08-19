/* Creates (or reuses) the Stripe product and its recurring prices, then writes
 * the resulting price IDs into .env.local.
 *
 * The amounts come from PLANS in lib/stripe.ts — the same array the payment
 * screen renders — so what Stripe charges cannot drift from what the app
 * quotes. Safe to run more than once: an existing product/price with matching
 * amount, interval and currency is reused rather than duplicated.
 *
 *   npx tsx scripts/setup-stripe-prices.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ENV_PATH = path.join(process.cwd(), '.env.local');
const PRODUCT_NAME = 'Little Chapters';

function loadEnv(): void {
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

/** Rewrites KEY=... in place, or appends it if the key is absent. */
function writeEnv(key: string, value: string): void {
  const raw = readFileSync(ENV_PATH, 'utf8');
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  writeFileSync(ENV_PATH, re.test(raw) ? raw.replace(re, line) : `${raw.replace(/\n*$/, '\n')}${line}\n`);
}

const money = (cents: number, currency: string) =>
  `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;

async function main() {
  loadEnv();
  const key = process.env.STRIPE_SECRET_KEY;

  if (!key) {
    console.error('STRIPE_SECRET_KEY is empty in .env.local — do step 1 first.');
    process.exit(1);
  }
  if (key.startsWith('sk_live_')) {
    console.error('That is a LIVE key. This script only runs against test mode.');
    console.error('Use the sk_test_… key from dashboard.stripe.com/test/apikeys.');
    process.exit(1);
  }
  if (!key.startsWith('sk_test_')) {
    console.error(`STRIPE_SECRET_KEY does not look like a secret key (got "${key.slice(0, 8)}…").`);
    console.error('It should start sk_test_. A pk_… key is the publishable one and will not work.');
    process.exit(1);
  }

  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(key, { apiVersion: '2026-07-29.dahlia' });
  const { PLANS } = await import('../lib/stripe');

  // Reuse the product if it already exists, so re-running does not litter the
  // dashboard with duplicates named the same thing.
  const existingProducts = await stripe.products.list({ active: true, limit: 100 });
  let product = existingProducts.data.find((p) => p.name === PRODUCT_NAME);

  if (product) {
    console.log(`product   reusing ${product.id} ("${product.name}")`);
  } else {
    product = await stripe.products.create({
      name: PRODUCT_NAME,
      description: 'A new chapter every day, written for your child’s reading level.',
    });
    console.log(`product   created ${product.id} ("${product.name}")`);
  }

  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });

  for (const plan of PLANS) {
    const match = prices.data.find(
      (p) =>
        p.unit_amount === plan.amount &&
        p.currency === plan.currency &&
        p.recurring?.interval === plan.interval &&
        p.recurring?.interval_count === 1,
    );

    const price = match ?? (await stripe.prices.create({
      product: product.id,
      unit_amount: plan.amount,
      currency: plan.currency,
      recurring: { interval: plan.interval },
    }));

    const envKey = plan.id === 'monthly' ? 'STRIPE_MONTHLY_PRICE_ID' : 'STRIPE_YEARLY_PRICE_ID';
    writeEnv(envKey, price.id);
    console.log(
      `${plan.id.padEnd(9)} ${match ? 'reusing' : 'created'} ${price.id}  ` +
      `${money(plan.amount, plan.currency)} / ${plan.interval}  → ${envKey}`,
    );
  }

  console.log('\n.env.local updated. Restart the dev server so it picks the new values up.');
}

main().catch((err) => {
  console.error('\nFailed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
