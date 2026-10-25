import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getServerConfig } from '../config.js';

export class FirebaseAdminConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirebaseAdminConfigError';
  }
}

let cachedAdminApp: App | null = null;
let cachedServiceAccountSignature: string | null = null;
let testTokenVerifier: ((token: string) => Promise<DecodedIdToken>) | null = null;
let testUserDeleter: ((uid: string) => Promise<void>) | null = null;

export function setTestTokenVerifier(
  verifier: ((token: string) => Promise<DecodedIdToken>) | null
): void {
  testTokenVerifier = verifier;
}

export function setTestUserDeleter(
  deleter: ((uid: string) => Promise<void>) | null
): void {
  testUserDeleter = deleter;
}

function isAuthUserNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code =
    (err as { code?: unknown; errorInfo?: { code?: unknown } }).code ??
    (err as { errorInfo?: { code?: unknown } }).errorInfo?.code;
  if (code === 'auth/user-not-found') return true;
  const msg = (err as { message?: unknown }).message;
  return typeof msg === 'string' && msg.includes('auth/user-not-found');
}

export async function deleteAuthUser(uid: string): Promise<void> {
  try {
    if (testUserDeleter) {
      await testUserDeleter(uid);
      return;
    }
    const app = getFirebaseAdminApp();
    await getAuth(app).deleteUser(uid);
  } catch (err) {
    if (isAuthUserNotFoundError(err)) {
      return;
    }
    throw err;
  }
}

export function parseServiceAccountJson(rawJson: string): ServiceAccount {
  const trimmed = rawJson.trim();
  if (!trimmed) {
    throw new FirebaseAdminConfigError('FIREBASE_SERVICE_ACCOUNT_JSON is not set.');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    throw new FirebaseAdminConfigError('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new FirebaseAdminConfigError('FIREBASE_SERVICE_ACCOUNT_JSON must be a JSON object.');
  }

  const projectId =
    (typeof parsed.project_id === 'string' && parsed.project_id.trim()) ||
    (typeof parsed.projectId === 'string' && parsed.projectId.trim()) ||
    '';
  const clientEmail =
    (typeof parsed.client_email === 'string' && parsed.client_email.trim()) ||
    (typeof parsed.clientEmail === 'string' && parsed.clientEmail.trim()) ||
    '';
  const rawPrivateKey =
    (typeof parsed.private_key === 'string' && parsed.private_key) ||
    (typeof parsed.privateKey === 'string' && parsed.privateKey) ||
    '';

  if (!projectId || !clientEmail || !rawPrivateKey) {
    throw new FirebaseAdminConfigError(
      'FIREBASE_SERVICE_ACCOUNT_JSON is missing required fields (project_id, client_email, private_key).'
    );
  }

  return {
    projectId,
    clientEmail,
    privateKey: rawPrivateKey.replace(/\\n/g, '\n'),
  };
}

export function getFirebaseAdminApp(): App {
  const { firebaseServiceAccountJson } = getServerConfig();
  const serviceAccount = parseServiceAccountJson(firebaseServiceAccountJson);
  const sig = `${serviceAccount.projectId}:${serviceAccount.clientEmail}`;

  if (cachedAdminApp && cachedServiceAccountSignature === sig) {
    return cachedAdminApp;
  }

  const existing = getApps().find((a) => a.name === 'adlens-admin');
  if (existing && cachedServiceAccountSignature === sig) {
    cachedAdminApp = existing;
    return existing;
  }

  const appName = existing ? `adlens-admin-${Date.now()}` : 'adlens-admin';
  cachedAdminApp = initializeApp(
    {
      credential: cert(serviceAccount),
      projectId: serviceAccount.projectId,
    },
    appName
  );
  cachedServiceAccountSignature = sig;
  return cachedAdminApp;
}

export async function verifyIdToken(token: string): Promise<DecodedIdToken> {
  if (!token || typeof token !== 'string' || !token.trim()) {
    throw new Error('ID token is empty.');
  }

  if (testTokenVerifier) {
    return testTokenVerifier(token.trim());
  }

  const app = getFirebaseAdminApp();
  return getAuth(app).verifyIdToken(token.trim());
}
