/** White label (Sprint 44): the workspace's own name, logo, footer line and colour on shared pages, PDFs and scheduled emails. */
import { z } from 'zod';
import { getPlanFeatures } from '../config/plans.js';
import { getFirestoreStore, type WorkspaceBranding, type WorkspaceDoc } from './firestore.js';

const noControls = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
export const brandingInputSchema = z.object({
  enabled: z.boolean(),
  name: z.string().max(60).transform(noControls),
  footer: z.string().max(160).transform(noControls),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1a73e8').nullable(),
}).strict().refine((b) => !b.enabled || b.name.length >= 2, { message: 'Type the name to show (at least 2 characters).', path: ['name'] });

export interface Brand { name: string; footer: string; accent: string | null }
/** The brand to show, or null when it is off, unnamed, or the plan does not include white label. */
export function activeBrand(ws: Pick<WorkspaceDoc, 'plan' | 'branding'> | null | undefined): Brand | null {
  const b: WorkspaceBranding | null | undefined = ws?.branding;
  if (!ws || !b || !b.enabled || b.name.length < 2 || !getPlanFeatures(ws.plan).whiteLabel) return null;
  return { name: b.name, footer: b.footer, accent: b.accent };
}
export async function brandForWorkspace(wsId: string): Promise<(Brand & { logo: string | null }) | null> {
  const store = getFirestoreStore();
  const ws = await store.getWorkspace(wsId);
  const brand = activeBrand(ws);
  if (!brand) return null;
  const logo = ws?.hasLogo ? (await store.getWorkspaceLogo(wsId).catch(() => null))?.dataUrl ?? null : null;
  return { ...brand, logo };
}
