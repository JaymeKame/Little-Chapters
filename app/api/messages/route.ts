/* API route for sending parent messages (in-app + SMS) */

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { adminUnconfiguredResponse } from '@/lib/route-auth';
import { sendSMS, type SmsStatus } from '@/lib/sms';
// Shared with the write side (/api/parents/phone) so the two can never
// disagree about what a storable number is.
import { E164 } from '@/lib/phone';
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
    const deliveryMode = body.deliveryMode === 'sms' ? 'sms' : 'in-app';

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

    /* SMS is strictly an ADDITION to the in-app note above, which has
     * already been written. Every branch here is a non-failure: the parent
     * gets their message either way, and `smsStatus` is a coarse code (see
     * SmsStatus) rather than the provider's error text, which named our
     * env vars back to the browser. */
    let smsSent = false;
    let smsStatus: SmsStatus | 'no_phone' | 'invalid_number' = 'no_phone';

    if (phoneNumber && !E164.test(phoneNumber)) {
      // Predates the server-side normalisation in /api/parents/phone, so
      // older parent docs can still hold something Twilio would reject.
      console.warn('[messages] stored phone number is not E.164 for uid:', uid);
      smsStatus = 'invalid_number';
    } else if (phoneNumber && deliveryMode === 'sms') {
      const smsResult = await sendSMS({
        to: phoneNumber,
        message: generated.rawMessage,
      });

      smsSent = smsResult.success;
      smsStatus = smsResult.status;

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
      smsStatus,
    });
  } catch (error) {
    console.error('Error sending parent message:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
