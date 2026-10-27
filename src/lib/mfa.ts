/**
 * Two-step verification with an authenticator app (TOTP), through Firebase Authentication with Identity Platform (Sprint 19).
 * The Firebase calls are passed in or imported lazily so the screens stay easy to test.
 */
import {
  getMultiFactorResolver,
  multiFactor,
  TotpMultiFactorGenerator,
  type Auth,
  type MultiFactorError,
  type MultiFactorResolver,
  type TotpSecret,
  type User,
} from 'firebase/auth';

/** Thrown by sign-in when the account has two-step verification turned on. Carries what is needed to finish. */
export class MfaChallenge extends Error {
  constructor(readonly resolver: MultiFactorResolver) {
    super('Enter the 6-digit code from your authenticator app.');
    this.name = 'MfaChallenge';
  }
}

export const isMfaRequiredError = (err: unknown): boolean =>
  Boolean(err) && typeof err === 'object' && (err as { code?: unknown }).code === 'auth/multi-factor-auth-required';

export function toMfaChallenge(auth: Auth, err: unknown): MfaChallenge {
  return new MfaChallenge(getMultiFactorResolver(auth, err as MultiFactorError));
}

export const isSixDigitCode = (code: string): boolean => /^\d{6}$/.test(code.trim());

/** Finishes a sign-in that was interrupted by MfaChallenge. */
export async function completeMfaSignIn(resolver: MultiFactorResolver, code: string): Promise<void> {
  const hint = resolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
  if (!hint) throw new Error('This account uses a second step that AdLens cannot check here. Use an authenticator app.');
  if (!isSixDigitCode(code)) throw new Error('Enter the 6 digits from your authenticator app.');
  await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code.trim()));
}

export interface EnrolledFactor { uid: string; displayName: string; enrolledAt: string | null }

export function listFactors(user: User): EnrolledFactor[] {
  return multiFactor(user).enrolledFactors.map((f) => ({ uid: f.uid, displayName: f.displayName ?? 'Authenticator app', enrolledAt: f.enrollmentTime ?? null }));
}

export interface TotpEnrollment {
  /** The key to type into an authenticator app. */
  secretKey: string;
  /** otpauth:// link (can be turned into a QR code by the authenticator app or any QR tool). */
  otpauthUrl: string;
  finish(code: string, label?: string): Promise<void>;
}

export async function startTotpEnrollment(user: User, issuer = 'AdLens'): Promise<TotpEnrollment> {
  const session = await multiFactor(user).getSession();
  const secret: TotpSecret = await TotpMultiFactorGenerator.generateSecret(session);
  return {
    secretKey: secret.secretKey,
    otpauthUrl: secret.generateQrCodeUrl(user.email ?? 'account', issuer),
    async finish(code, label = 'Authenticator app') {
      if (!isSixDigitCode(code)) throw new Error('Enter the 6 digits from your authenticator app.');
      await multiFactor(user).enroll(TotpMultiFactorGenerator.assertionForEnrollment(secret, code.trim()), label);
    },
  };
}

export async function removeFactor(user: User, factorUid: string): Promise<void> {
  const factor = multiFactor(user).enrolledFactors.find((f) => f.uid === factorUid);
  if (factor) await multiFactor(user).unenroll(factor);
}
