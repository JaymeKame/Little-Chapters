/* Twilio SMS service for parent win notifications */

import { Twilio } from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;

let client: Twilio | null = null;

function getClient(): Twilio {
  if (!client) {
    if (!accountSid || !authToken || !fromNumber) {
      throw new Error('Missing Twilio credentials. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env.local');
    }
    client = new Twilio(accountSid, authToken);
  }
  return client;
}

export interface SendSMSParams {
  to: string; // Phone number in E.164 format (e.g., +1234567890)
  message: string;
}

/* Coarse, caller-safe outcome. Deliberately NOT the provider's error text:
 * this value is returned to the browser, and Twilio's messages name our
 * account state and env vars (the old code handed the client the literal
 * string "Missing Twilio credentials. Set TWILIO_ACCOUNT_SID, ..."). The
 * detail is logged server-side where it belongs. */
export type SmsStatus = 'sent' | 'not_configured' | 'failed';

export async function sendSMS({ to, message }: SendSMSParams): Promise<{ success: boolean; status: SmsStatus }> {
  // Checked BEFORE the attempt so an unconfigured deployment is a known,
  // reportable state rather than an exception that looks like a send
  // failure — the two want very different responses from an operator.
  if (!isSMSConfigured()) {
    console.warn('[sms] skipped: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER not set');
    return { success: false, status: 'not_configured' };
  }
  try {
    const twilio = getClient();

    await twilio.messages.create({
      body: message,
      from: fromNumber,
      to: to,
    });

    return { success: true, status: 'sent' };
  } catch (error) {
    console.error('Failed to send SMS:', error);
    return { success: false, status: 'failed' };
  }
}

export function isSMSConfigured(): boolean {
  return !!(accountSid && authToken && fromNumber);
}
