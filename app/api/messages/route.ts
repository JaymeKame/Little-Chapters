/* API route for sending parent messages (in-app + SMS) */

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { adminUnconfiguredResponse } from '@/lib/route-auth';
import { sendSMS } from '@/lib/sms';
import { generateParentMessage } from '@/lib/parent-message';
import { validateParentMessage } from '@/lib/message-validator';
import type { ReadingSessionData } from '@/lib/parent-message';

/* SMS costs money and reaches real phones: per-uid daily brake (in-memory,
 * per instance — a Twilio spend alert is the real backstop). */
const MESSAGES_PER_DAY = 6;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const sends = new Map<string, { windowStart: number; count: number }>();

function overLimit(key: string): boolean {
  const now = Date.now();
  const g = sends.get(key);
  if (!g || now - g.windowStart > WINDOW_MS) {
    sends.set(key, { windowStart: now, count: 1 });
    return false;
  }
  g.count += 1;
  return g.count > MESSAGES_PER_DAY;
}

const E164 = /^\+[1-9]\d{6,14}$/;

export async function POST(request: NextRequest) {
  try {
    const unconfigured = adminUnconfiguredResponse();
    if (unconfigured) return unconfigured;

    // Initialize Firebase Admin
    const auth = adminAuth();
    const db = adminDb();

    // Verify authentication
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing authorization header' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(token);
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const uid = decodedToken.uid;

    // Anonymous identities are free to mint — a real signed-in parent account
    // is required before anything can be sent on the operator's Twilio.
    if (decodedToken.firebase?.sign_in_provider === 'anonymous') {
      return NextResponse.json({ error: 'Sign in with a parent account first' }, { status: 403 });
    }
    if (overLimit(uid)) {
      return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
    }

    // Parse request body
    const body = await request.json();
    const sessionData: ReadingSessionData = body.sessionData;

    if (!sessionData || !sessionData.childName) {
      return NextResponse.json({ error: 'Missing session data' }, { status: 400 });
    }

    // Generate message
    const generated = generateParentMessage(sessionData);

    // Validate message
    const validation = validateParentMessage(generated.rawMessage);
    if (!validation.valid) {
      console.error('Message validation failed:', validation.errors);
      return NextResponse.json({ error: 'Message validation failed', errors: validation.errors }, { status: 400 });
    }

    // Save message to Firestore (in-app message)
    const messageRef = await db.collection('parents').doc(uid).collection('messages').add({
      message: generated.rawMessage,
      lines: generated.lines,
      childName: sessionData.childName,
      sessionData,
      createdAt: new Date().toISOString(),
      read: false,
    });

    // Get parent's phone number
    const parentDoc = await db.collection('parents').doc(uid).get();
    const parentData = parentDoc.data();
    const phoneNumber = parentData?.phoneNumber;

    // Send SMS if phone number is configured
    let smsSent = false;
    let smsError: string | undefined;

    if (phoneNumber && !E164.test(phoneNumber)) {
      smsError = 'Saved phone number is not in E.164 format';
    } else if (phoneNumber) {
      const smsResult = await sendSMS({
        to: phoneNumber,
        message: generated.rawMessage,
      });

      smsSent = smsResult.success;
      smsError = smsResult.error;

      if (smsSent) {
        // Update message with SMS sent status
        await messageRef.update({
          smsSent: true,
          smsSentAt: new Date().toISOString(),
        });
      }
    }

    return NextResponse.json({
      success: true,
      messageId: messageRef.id,
      message: generated.rawMessage,
      smsSent,
      smsError,
    });
  } catch (error) {
    console.error('Error sending parent message:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
