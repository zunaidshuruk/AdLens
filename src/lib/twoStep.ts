/** The browser's copy of the "I passed my second step" proof. It is useless without the matching sign-in (the server checks). */
const KEY = 'adlens.2fa.proof';
export const TWO_STEP_EVENT = 'adlens:two-step-required';

export function getProof(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setProof(proof: string): void {
  try {
    window.localStorage.setItem(KEY, proof);
  } catch {
    /* private mode: the person will be asked again on the next visit */
  }
}

export function clearProof(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Tells the app to show the code screen (the server said a code is needed). */
export function announceTwoStepRequired(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(TWO_STEP_EVENT));
}
