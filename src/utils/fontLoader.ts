import type { FontFamilyId } from './themeEngine.js';

/** Plus Jakarta Sans ships with the app. Every other font downloads only when someone picks it. */
const LOADERS: Partial<Record<FontFamilyId, (() => Promise<unknown>)[]>> = {
  mada: [() => import('@fontsource/mada/400.css'), () => import('@fontsource/mada/500.css'), () => import('@fontsource/mada/600.css'), () => import('@fontsource/mada/700.css')],
  poppins: [() => import('@fontsource/poppins/400.css'), () => import('@fontsource/poppins/500.css'), () => import('@fontsource/poppins/600.css'), () => import('@fontsource/poppins/700.css')],
  'noto-sans': [() => import('@fontsource/noto-sans/400.css'), () => import('@fontsource/noto-sans/500.css'), () => import('@fontsource/noto-sans/600.css'), () => import('@fontsource/noto-sans/700.css')],
  inter: [() => import('@fontsource/inter/400.css'), () => import('@fontsource/inter/500.css'), () => import('@fontsource/inter/600.css'), () => import('@fontsource/inter/700.css')],
  roboto: [() => import('@fontsource/roboto/400.css'), () => import('@fontsource/roboto/500.css'), () => import('@fontsource/roboto/700.css')],
};

const done = new Set<FontFamilyId>();

/** Loads the font files for a choice (once). Never throws: if the download fails the fallback font is used. */
export async function ensureFontLoaded(id: FontFamilyId | undefined): Promise<void> {
  if (!id || done.has(id)) return;
  const loaders = LOADERS[id];
  if (!loaders) { done.add(id); return; }
  try {
    await Promise.all(loaders.map((l) => l()));
    done.add(id);
  } catch {
    /* offline or blocked: the fallback font keeps the app readable */
  }
}
