/**
 * Optional larger on-device model through WebLLM + WebGPU (Sprint 15c).
 *
 * Why it is optional: AdLens does not bundle WebLLM. The owner either serves the WebLLM module from their own address
 * (recommended: `npm pack @mlc-ai/web-llm`, host the ES module file, set VITE_WEBLLM_MODULE_URL) or leaves it unset, in which case this
 * feature is simply hidden and nothing changes. The page never loads code from an address it was not built with.
 *
 * Everything that touches the browser or the network is passed in, so this file is unit-tested with a fake module.
 * The engine is presented as a `LanguageModelLike`, so the existing private-mode pipeline (askOnDevice) and the privacy rule are reused unchanged.
 */
import type { LanguageModelLike, ModelSession } from './onDeviceEngine.js';

export interface ChatCompletionLike {
  choices?: { message?: { content?: string | null } }[];
}

export interface WebLlmEngineLike {
  chat: { completions: { create(request: Record<string, unknown>): Promise<ChatCompletionLike> } };
  interruptGenerate?(): void | Promise<void>;
  unload?(): Promise<void>;
}

export interface WebLlmModuleLike {
  CreateMLCEngine(modelId: string, config?: { initProgressCallback?: (p: { progress?: number }) => void }): Promise<WebLlmEngineLike>;
  /** Present in recent versions. Tells whether the model files are already stored in this browser. */
  hasModelInCache?(modelId: string): Promise<boolean>;
  prebuiltAppConfig?: { model_list?: { model_id: string }[] };
}

export interface WebLlmModelChoice { id: string; label: string; approxDownloadMB: number; note: string }

/**
 * Small instruction-tuned models, smallest first. IDs must exist in the WebLLM version the owner hosts; the list shown to people is
 * filtered against that version's own model list at run time (see `availableModels`).
 */
export const MODEL_CATALOG: WebLlmModelChoice[] = [
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Small (Llama 3.2 1B)', approxDownloadMB: 900, note: 'Fastest, runs on most laptops with a graphics chip.' },
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Balanced (Qwen 2.5 1.5B)', approxDownloadMB: 1100, note: 'Good at following the answer format.' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Larger (Llama 3.2 3B)', approxDownloadMB: 2300, note: 'Best answers; needs a stronger graphics chip and more memory.' },
];

export const DEFAULT_MODEL_ID = MODEL_CATALOG[0].id;

export function availableModels(mod: WebLlmModuleLike | null): WebLlmModelChoice[] {
  const list = mod?.prebuiltAppConfig?.model_list;
  if (!Array.isArray(list) || list.length === 0) return MODEL_CATALOG;
  const ids = new Set(list.map((m) => m.model_id));
  const filtered = MODEL_CATALOG.filter((m) => ids.has(m.id));
  return filtered.length > 0 ? filtered : MODEL_CATALOG;
}

/** True when the browser exposes WebGPU and a graphics adapter answers. */
export async function detectWebGpu(nav: unknown = typeof navigator === 'undefined' ? null : navigator): Promise<boolean> {
  try {
    const gpu = (nav as { gpu?: { requestAdapter?: () => Promise<unknown> } } | null)?.gpu;
    if (!gpu || typeof gpu.requestAdapter !== 'function') return false;
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

/** Only an https address, or a path on this site. Never an http, data:, blob: or credentialed address. */
export function isAllowedModuleUrl(url: string, origin = typeof location === 'undefined' ? 'https://localhost' : location.origin): boolean {
  const raw = url.trim();
  if (!raw) return false;
  try {
    const u = new URL(raw, origin);
    if (u.username || u.password) return false;
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) return false;
    return true;
  } catch {
    return false;
  }
}

export type ModuleImporter = (url: string) => Promise<unknown>;
const defaultImporter: ModuleImporter = (url) => import(/* @vite-ignore */ url);

export async function loadWebLlmModule(url: string, importer: ModuleImporter = defaultImporter, origin?: string): Promise<WebLlmModuleLike> {
  if (!isAllowedModuleUrl(url, origin)) throw new Error('The WebLLM address is not allowed.');
  const mod = (await importer(url)) as Partial<WebLlmModuleLike> | null;
  if (!mod || typeof mod.CreateMLCEngine !== 'function') throw new Error('That file is not the WebLLM module.');
  return mod as WebLlmModuleLike;
}

// ---------------------------------------------------------------------------
// Engine as a LanguageModelLike
// ---------------------------------------------------------------------------

const engines = new Map<string, Promise<WebLlmEngineLike>>();

/** Frees graphics memory. Called when the person switches model or turns the feature off. */
export async function unloadWebLlm(): Promise<void> {
  const pending = [...engines.values()];
  engines.clear();
  for (const p of pending) {
    try { await (await p).unload?.(); } catch { /* already gone */ }
  }
}

const abortError = () => Object.assign(new Error('Stopped'), { name: 'AbortError' });

export interface WebLlmOptions {
  maxTokens?: number;
  temperature?: number;
}

export function createWebLlmLanguageModel(mod: WebLlmModuleLike, modelId: string, hasGpu: boolean, opts: WebLlmOptions = {}): LanguageModelLike {
  const load = (onProgress?: (fraction: number) => void): Promise<WebLlmEngineLike> => {
    let p = engines.get(modelId);
    if (!p) {
      p = mod.CreateMLCEngine(modelId, { initProgressCallback: (info) => onProgress?.(Math.max(0, Math.min(1, Number(info?.progress) || 0))) });
      p.catch(() => engines.delete(modelId));
      engines.set(modelId, p);
    }
    return p;
  };
  return {
    async availability() {
      if (!hasGpu) return 'unavailable';
      if (engines.has(modelId)) return 'available';
      try {
        return (await mod.hasModelInCache?.(modelId)) ? 'available' : 'downloadable';
      } catch {
        return 'downloadable';
      }
    },
    async create(options) {
      const monitor = options?.monitor as ((m: { addEventListener: (t: string, cb: (e: { loaded: number }) => void) => void }) => void) | undefined;
      let listener: ((e: { loaded: number }) => void) | null = null;
      monitor?.({ addEventListener: (_t, cb) => { listener = cb; } });
      const engine = await load((f) => listener?.({ loaded: f }));
      const system = (options?.initialPrompts as { role: string; content: string }[] | undefined)?.find((m) => m.role === 'system')?.content;
      const session: ModelSession = {
        async prompt(input, o) {
          if (o?.signal?.aborted) throw abortError();
          const onAbort = () => { void engine.interruptGenerate?.(); };
          o?.signal?.addEventListener('abort', onAbort);
          try {
            const res = await engine.chat.completions.create({
              messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: input }],
              temperature: opts.temperature ?? 0.2,
              max_tokens: opts.maxTokens ?? 600,
              response_format: { type: 'json_object' },
            });
            if (o?.signal?.aborted) throw abortError();
            return res.choices?.[0]?.message?.content ?? '';
          } finally {
            o?.signal?.removeEventListener('abort', onAbort);
          }
        },
        destroy() { /* the loaded engine stays warm for the next question */ },
      };
      return session;
    },
  };
}
