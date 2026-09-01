/** Pure billing-portal policy, isolated so customer/session wiring is testable
 * without contacting Stripe. Stripe remains the hosted plan/card UI. */
export function billingPortalReturnUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/settings?billing=returned`;
}

export function billingPortalConfigurationId(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.STRIPE_PORTAL_CONFIGURATION_ID?.trim() || undefined;
}
