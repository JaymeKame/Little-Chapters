/* Server-only Firebase Admin init. NEVER import this from a 'use client'
 * module. Used by the reading API routes to verify Firebase ID tokens.
 *
 * Credentials: set FIREBASE_SERVICE_ACCOUNT to the service-account JSON (raw
 * or base64) in the server environment — NOT NEXT_PUBLIC_*. Falls back to
 * Application Default Credentials when unset.                                */

import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App,
} from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';

let cached: App | undefined;

/** True when explicit admin credentials are configured. Routes should fail
 *  FAST (503) when this is false — applicationDefault() on a non-GCP machine
 *  stalls for seconds probing the GCE metadata server before erroring. */
export function adminCredentialsConfigured(): boolean {
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT?.trim() ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim(),
  );
}

function adminApp(): App {
  if (cached) return cached;
  if (getApps().length) {
    cached = getApps()[0];
    return cached;
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  const credential = raw
    ? cert(JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')))
    : applicationDefault();
  cached = initializeApp({ credential, storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET });
  return cached;
}

export function adminAuth(): Auth {
  return getAuth(adminApp());
}

export function adminDb(): Firestore {
  return getFirestore(adminApp());
}

export function adminStorage(): Storage {
  return getStorage(adminApp());
}

export function adminStorageConfigured(): boolean {
  return adminCredentialsConfigured() && Boolean(process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
}
