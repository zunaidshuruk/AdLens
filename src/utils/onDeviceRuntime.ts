/**
 * Chooses which on-device engine runs Private mode (Sprint 15c): Chrome's built-in model first, then, if the owner enabled it
 * and the person opted in, a larger WebGPU model. The privacy rule is unchanged because both look the same to `askOnDevice`:
 * nothing here ever calls the cloud.
 */
import type { OnDeviceStatus } from './aiEngineRouter.js';
import { detectOnDeviceStatus, getLanguageModel, ON_DEVICE_SYSTEM_PROMPT, type LanguageModelLike } from './onDeviceEngine.js';
import { STRUCTURED_SYSTEM_PROMPT, finalizeStructured } from './structuredAnswer.js';
import { DEFAULT_MODEL_ID, createWebLlmLanguageModel, detectWebGpu, loadWebLlmModule, type WebLlmModuleLike } from './webLlmEngine.js';

export interface WebLlmSettings { enabled: boolean; modelId: string }
export const DEFAULT_WEBLLM_SETTINGS: WebLlmSettings = { enabled: false, modelId: DEFAULT_MODEL_ID };
export const WEBLLM_SETTINGS_KEY = 'adlens_webllm_v1';

export function parseWebLlmSettings(raw: unknown): WebLlmSettings {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return { enabled: o.enabled === true, modelId: typeof o.modelId === 'string' && /^[\w.-]{1,80}$/.test(o.modelId) ? o.modelId : DEFAULT_MODEL_ID };
    }
  } catch { /* fall through */ }
  return { ...DEFAULT_WEBLLM_SETTINGS };
}

export function loadWebLlmSettings(storage?: Pick<Storage, 'getItem'> | null): WebLlmSettings {
  try {
    const s = storage !== undefined ? storage : typeof window !== 'undefined' ? window.localStorage : null;
    return s ? parseWebLlmSettings(s.getItem(WEBLLM_SETTINGS_KEY)) : { ...DEFAULT_WEBLLM_SETTINGS };
  } catch {
    return { ...DEFAULT_WEBLLM_SETTINGS };
  }
}

export function saveWebLlmSettings(settings: WebLlmSettings, storage?: Pick<Storage, 'setItem'> | null): void {
  try {
    const s = storage !== undefined ? storage : typeof window !== 'undefined' ? window.localStorage : null;
    s?.setItem(WEBLLM_SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* a browser that blocks storage simply forgets the choice */ }
}

/** The address the owner built this copy of AdLens with, or '' (feature hidden). */
export function webLlmModuleUrl(): string {
  try {
    const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_WEBLLM_MODULE_URL;
    return typeof v === 'string' ? v.trim() : '';
  } catch {
    return '';
  }
}

export type RuntimeKind = 'chrome' | 'webllm' | 'none';

/** Pure choice. Chrome's built-in model wins whenever it can run (or be downloaded). */
export function pickRuntimeKind(input: { chrome: OnDeviceStatus; webGpu: boolean; moduleConfigured: boolean; webLlmEnabled: boolean }): RuntimeKind {
  if (input.chrome !== 'unsupported') return 'chrome';
  if (input.moduleConfigured && input.webLlmEnabled && input.webGpu) return 'webllm';
  return 'none';
}

export interface ResolvedRuntime {
  kind: RuntimeKind;
  status: OnDeviceStatus;
  lm: LanguageModelLike | null;
  label: string;
  systemPrompt?: string;
  finalize?: typeof finalizeStructured;
  /** What the screen can offer: only when the owner configured WebLLM and this device has WebGPU. */
  webLlmOffered: boolean;
  module: WebLlmModuleLike | null;
}

export interface ResolveDeps {
  settings?: WebLlmSettings;
  url?: string;
  chromeLm?: LanguageModelLike | null;
  gpu?: () => Promise<boolean>;
  loadModule?: (url: string) => Promise<WebLlmModuleLike>;
}

export async function resolveRuntime(deps: ResolveDeps = {}): Promise<ResolvedRuntime> {
  const settings = deps.settings ?? loadWebLlmSettings();
  const url = deps.url ?? webLlmModuleUrl();
  const chromeLm = deps.chromeLm !== undefined ? deps.chromeLm : getLanguageModel();
  const chrome = await detectOnDeviceStatus(chromeLm);
  const webGpu = url ? await (deps.gpu ?? detectWebGpu)() : false;
  const webLlmOffered = Boolean(url) && webGpu;
  const kind = pickRuntimeKind({ chrome, webGpu, moduleConfigured: Boolean(url), webLlmEnabled: settings.enabled });
  if (kind === 'chrome') {
    return { kind, status: chrome, lm: chromeLm, label: 'Chrome built-in AI (on this device)', systemPrompt: ON_DEVICE_SYSTEM_PROMPT, webLlmOffered, module: null };
  }
  if (kind === 'webllm') {
    try {
      const module = await (deps.loadModule ?? ((u: string) => loadWebLlmModule(u)))(url);
      const lm = createWebLlmLanguageModel(module, settings.modelId, webGpu);
      const raw = await lm.availability();
      const status: OnDeviceStatus = raw === 'available' ? 'available' : raw === 'downloadable' ? 'downloadable' : 'unsupported';
      return { kind, status, lm, label: 'Larger on-device model (WebGPU, on this device)', systemPrompt: STRUCTURED_SYSTEM_PROMPT, finalize: finalizeStructured, webLlmOffered, module };
    } catch {
      return { kind: 'none', status: 'unsupported', lm: null, label: '', webLlmOffered, module: null };
    }
  }
  return { kind: 'none', status: 'unsupported', lm: null, label: '', webLlmOffered, module: null };
}
