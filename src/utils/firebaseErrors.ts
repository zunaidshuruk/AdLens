export interface PasswordRulesState {
  minLength: boolean;
  hasUpper: boolean;
  hasLower: boolean;
  hasNumber: boolean;
  allValid: boolean;
  score: number; // 0 to 4
  label: 'Weak' | 'Fair' | 'Good' | 'Strong';
}

export function evaluatePasswordRules(password: string): PasswordRulesState {
  const minLength = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const allValid = minLength && hasUpper && hasLower && hasNumber;

  let passedCount = 0;
  if (minLength) passedCount += 1;
  if (hasUpper) passedCount += 1;
  if (hasLower) passedCount += 1;
  if (hasNumber) passedCount += 1;

  let label: 'Weak' | 'Fair' | 'Good' | 'Strong' = 'Weak';
  if (passedCount <= 1) {
    label = 'Weak';
  } else if (passedCount === 2) {
    label = 'Fair';
  } else if (passedCount === 3) {
    label = 'Good';
  } else {
    label = 'Strong';
  }

  return {
    minLength,
    hasUpper,
    hasLower,
    hasNumber,
    allValid,
    score: passedCount,
    label,
  };
}

export function extractFirebaseErrorCode(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const maybeCode = (err as { code?: unknown }).code;
  if (typeof maybeCode === 'string') return maybeCode;
  const maybeMsg = (err as { message?: unknown }).message;
  if (typeof maybeMsg === 'string') {
    const match = maybeMsg.match(/\((auth\/[a-z0-9-]+)\)/i);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return '';
}

export function mapFirebaseErrorMessage(errOrCode: unknown): string {
  const code =
    typeof errOrCode === 'string' && errOrCode.startsWith('auth/')
      ? errOrCode
      : extractFirebaseErrorCode(errOrCode);

  switch (code) {
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'Email or password is incorrect';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists — sign in instead';
    case 'auth/weak-password':
      return 'Password is too weak. Use at least 8 characters including uppercase, lowercase, and a number.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'Network error. Please check your internet connection and try again.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in window was closed before completing. Please try again.';
    case 'auth/popup-blocked':
      return 'Popup was blocked by your browser. Redirecting to sign in...';
    case 'auth/account-exists-with-different-credential':
      return 'You already have an AdLens account with this email. Sign in with your existing method to link Google/Microsoft.';
    case 'auth/expired-action-code':
      return 'This link has expired. Please send a new link.';
    case 'auth/invalid-action-code':
      return 'This link is invalid or has already been used. Please send a new link.';
    case 'auth/requires-recent-login':
      return 'For security, please re-enter your current password and try again.';
    case 'auth/credential-already-in-use':
      return 'This social account is already linked to another AdLens account.';
    case 'auth/provider-already-linked':
      return 'This sign-in method is already linked to your account.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/unauthorized-continue-uri':
    case 'auth/invalid-continue-uri':
      return 'We could not send the verification email from this web address. The site owner needs to add this domain under Firebase, Authentication, Settings, Authorized domains.';
    case 'auth/quota-exceeded':
      return 'The daily limit for verification emails was reached. Please try again tomorrow, or contact the site owner.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact your administrator.';
    default:
      if (errOrCode instanceof Error && errOrCode.message && !errOrCode.message.includes('Firebase:')) {
        return errOrCode.message;
      }
      return 'Something went wrong with authentication. Please try again.';
  }
}
