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

export async function sendSMS({ to, message }: SendSMSParams): Promise<{ success: boolean; error?: string }> {
  try {
    const twilio = getClient();
    
    await twilio.messages.create({
      body: message,
      from: fromNumber,
      to: to,
    });

    return { success: true };
  } catch (error) {
    console.error('Failed to send SMS:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export function isSMSConfigured(): boolean {
  return !!(accountSid && authToken && fromNumber);
}
