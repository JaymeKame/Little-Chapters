/* API route for sending parent messages (in-app + SMS) */

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { sendSMS } from '@/lib/sms';
import { generateParentMessage } from '@/lib/parent-message';
import { validateParentMessage } from '@/lib/message-validator';
import type { ReadingSessionData } from '@/lib/parent-message';

export async function POST(request: NextRequest) {
  try {
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

    if (phoneNumber) {
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
