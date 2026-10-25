/**
 * Chooses which AI engine answers a question (Sprint 15). Pure function: no browser or network access.
 *
 * Engines
 * - "cloud":      Gemini API through the AdLens server. Default. Smarter, handles every language.
 * - "on-device":  a small model running in the user's browser (Chrome built-in Gemini Nano first).
 *                 Opt-in "Private mode": questions and answers never leave the device.
 *
 * THE PRIVACY RULE (tested exhaustively): when the user chose on-device, the question is NEVER sent
 * to the cloud unless (a) they switched on "Allow cloud fallback", or (b) they pressed
 * "Ask the cloud model" for this one question (forceCloudOnce).
 */

export type EnginePreference = 'cloud' | 'on-device';
export type OnDeviceStatus = 'unsupported' | 'downloadable' | 'downloading' | 'available';

export interface EngineSettings {
  preference: EnginePreference;
  /** Only meaningful in on-device mode. Default false. */
  allowCloudFallback: boolean;
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = { preference: 'cloud', allowCloudFallback: false };

export interface EngineEnvironment {
  onDevice: OnDeviceStatus;
  online: boolean;
  /** Is the Gemini key configured on the server? */
  cloudConfigured: boolean;
  /** AI questions left this month for the workspace plan; null = unlimited or unknown. */
  cloudQuotaRemaining: number | null;
}

export type EngineReason =
  | 'cloud-chosen'
  | 'cloud-explicit'
  | 'cloud-fallback'
  | 'on-device-chosen'
  | 'on-device-cloud-unavailable'
  | 'blocked';

export type EngineOffer = 'download-model' | 'wait-for-download' | 'ask-cloud-once' | 'connect-internet' | 'enable-on-device';

export interface EngineDecision {
  engine: 'cloud' | 'on-device' | 'none';
  reason: EngineReason;
  /** Short, user-facing explanation. */
  message: string;
  offer?: EngineOffer;
  /** True when the question will be sent to Google's Gemini API. Show this in the UI. */
  dataLeavesDevice: boolean;
}

// ---------------------------------------------------------------------------
// Language support
// ---------------------------------------------------------------------------

export type Script =
  | 'latin' | 'bengali' | 'devanagari' | 'arabic' | 'cyrillic' | 'han' | 'kana' | 'hangul' | 'thai' | 'other';

const SCRIPT_TESTS: [Script, RegExp][] = [
  ['bengali', /\p{Script=Bengali}/u],
  ['devanagari', /\p{Script=Devanagari}/u],
  ['arabic', /\p{Script=Arabic}/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['kana', /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ['han', /\p{Script=Han}/u],
  ['hangul', /\p{Script=Hangul}/u],
  ['thai', /\p{Script=Thai}/u],
  ['latin', /\p{Script=Latin}/u],
];

/** Dominant writing system of the letters in `text` (Japanese kana outranks Han). Digits only → latin. */
export function detectScript(text: string): Script {
  const counts = new Map<Script, number>();
  for (const ch of text) {
    if (!/\p{L}/u.test(ch)) continue;
    const hit = SCRIPT_TESTS.find(([, re]) => re.test(ch));
    const script: Script = hit ? hit[0] : 'other';
    counts.set(script, (counts.get(script) ?? 0) + 1);
  }
  if (counts.size === 0) return 'latin';
  if ((counts.get('kana') ?? 0) > 0) return 'kana';
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Chrome's docs list English, Japanese and Spanish for the Prompt API, so Latin script (en/es; other
 * Latin-script languages can't be told apart here) and Japanese are treated as supported.
 */
const ON_DEVICE_SCRIPTS: ReadonlySet<Script> = new Set<Script>(['latin', 'kana']);

export function onDeviceSupportsText(text: string): boolean {
  return ON_DEVICE_SCRIPTS.has(detectScript(text));
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const cloudUsable = (env: EngineEnvironment): boolean =>
  env.cloudConfigured && env.online && env.cloudQuotaRemaining !== 0;

const cloud = (reason: EngineReason, message: string, offer?: EngineOffer): EngineDecision => ({
  engine: 'cloud', reason, message, ...(offer ? { offer } : {}), dataLeavesDevice: true,
});
const onDevice = (reason: EngineReason, message: string): EngineDecision => ({
  engine: 'on-device', reason, message, dataLeavesDevice: false,
});
const none = (message: string, offer?: EngineOffer): EngineDecision => ({
  engine: 'none', reason: 'blocked', message, ...(offer ? { offer } : {}), dataLeavesDevice: false,
});

export function chooseEngine(
  settings: EngineSettings,
  env: EngineEnvironment,
  question: string,
  opts: { forceCloudOnce?: boolean } = {}
): EngineDecision {
  // An explicit "Ask the cloud model" press for this one question.
  if (opts.forceCloudOnce) {
    return cloudUsable(env)
      ? cloud('cloud-explicit', 'Sent to the cloud model for this question only.')
      : none(cloudBlockedMessage(env), env.online ? undefined : 'connect-internet');
  }

  // ---- Cloud is the chosen engine (default) ----
  if (settings.preference === 'cloud') {
    if (cloudUsable(env)) return cloud('cloud-chosen', 'Answered by the cloud model (Gemini).');
    if (env.onDevice === 'available') {
      return onDevice('on-device-cloud-unavailable', `${cloudBlockedMessage(env)} Using the on-device model instead.`);
    }
    if (env.onDevice === 'downloadable') {
      return none(`${cloudBlockedMessage(env)} You can use the free on-device model instead.`, 'download-model');
    }
    return none(cloudBlockedMessage(env), env.online ? undefined : 'connect-internet');
  }

  // ---- On-device (Private mode) is the chosen engine ----
  const fallbackOk = settings.allowCloudFallback && cloudUsable(env);

  if (!onDeviceSupportsText(question)) {
    return fallbackOk
      ? cloud('cloud-fallback', 'The on-device model does not support this language, so the cloud model answered.')
      : none(
          'The on-device model supports English, Spanish and Japanese. Ask in one of those, or send this question to the cloud model.',
          cloudUsable(env) ? 'ask-cloud-once' : undefined
        );
  }

  switch (env.onDevice) {
    case 'available':
      return onDevice('on-device-chosen', 'Answered on your device. Your question did not leave this browser.');
    case 'downloadable':
      return fallbackOk
        ? cloud('cloud-fallback', 'The on-device model is not downloaded yet, so the cloud model answered.', 'download-model')
        : none('Download the on-device model to use Private mode.', 'download-model');
    case 'downloading':
      return fallbackOk
        ? cloud('cloud-fallback', 'The on-device model is still downloading, so the cloud model answered.', 'wait-for-download')
        : none('The on-device model is still downloading. Please wait a moment.', 'wait-for-download');
    case 'unsupported':
    default:
      return fallbackOk
        ? cloud('cloud-fallback', 'This browser cannot run the on-device model, so the cloud model answered.')
        : none(
            'This browser or device cannot run the on-device model. You can use the cloud model instead.',
            cloudUsable(env) ? 'ask-cloud-once' : undefined
          );
  }
}

function cloudBlockedMessage(env: EngineEnvironment): string {
  if (!env.cloudConfigured) return 'The cloud AI is not set up on this server.';
  if (!env.online) return 'You appear to be offline.';
  if (env.cloudQuotaRemaining === 0) return 'The monthly cloud AI limit has been reached.';
  return 'The cloud model is unavailable.';
}
