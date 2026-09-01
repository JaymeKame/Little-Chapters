import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { billingPortalConfigurationId, billingPortalReturnUrl } from '../lib/billing-portal.ts';

assert.equal(billingPortalReturnUrl('https://littlechapters.example/'), 'https://littlechapters.example/settings?billing=returned');
assert.equal(billingPortalConfigurationId({ STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_test' }), 'bpc_test');
assert.equal(billingPortalConfigurationId({}), undefined);

const route = readFileSync(new URL('../app/api/payments/portal/route.ts', import.meta.url), 'utf8');
const stripe = readFileSync(new URL('../lib/stripe.ts', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../app/settings/page.tsx', import.meta.url), 'utf8');
assert.match(route, /customerBelongsTo\(customerId, uid/);
assert.match(route, /billingPortalConfigurationId\(\)/);
assert.match(stripe, /billingPortal\.sessions\.create/);
assert.match(stripe, /configuration: configurationId/);
assert.match(settings, /api\/payments\/subscription/);
assert.match(settings, /api\/payments\/portal/);
assert.match(settings, /subscription !== 'active'.*router\.push\('\/payment'\)/s);
console.log('Account management contract passed: owned customer, configured hosted portal, safe return, and subscription refresh');
