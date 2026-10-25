/**
 * Turns report definitions (server/reports registry, listed with JSON Schema inputs) into what each
 * AI engine needs (Sprint 15). Pure functions, shared by server and browser.
 *
 * - Date arguments are NOT given to the model. The UI's selected range (and comparison) is injected,
 *   so a model can never invent or misread dates.
 * - Cloud (Gemini): function declarations using `parametersJsonSchema` (standard JSON Schema).
 * - On-device (small context): shortlist the 3–4 most relevant tools and show a compact text menu.
 */

export type ToolSource = 'ga4' | 'search_console' | 'meta' | 'combined';

export interface ToolDefinition {
  id: string; // e.g. "ga4.trafficBreakdown"
  title: string;
  description: string;
  source: ToolSource;
  input: Record<string, unknown>; // JSON Schema
}

export const DATE_ARG_KEYS = ['startDate', 'endDate', 'compareStartDate', 'compareEndDate'] as const;

type Schema = Record<string, unknown>;
const isObj = (v: unknown): v is Schema => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Valid for Gemini: letters, digits, underscore, dot, colon, dash; starts with a letter or underscore. */
export const TOOL_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/;

/** Removes $schema and the hidden arguments (and their "required" entries), recursively safe for objects. */
export function sanitizeToolSchema(input: Schema, hideKeys: readonly string[] = []): Schema {
  const out: Schema = { ...input };
  delete out.$schema;
  out.type = 'object';

  if (isObj(out.properties)) {
    const props: Schema = {};
    for (const [k, v] of Object.entries(out.properties)) {
      if (hideKeys.includes(k)) continue;
      props[k] = isObj(v) ? stripNested(v) : v;
    }
    out.properties = props;
  } else {
    out.properties = {};
  }
  if (Array.isArray(out.required)) {
    const req = (out.required as unknown[]).filter((k) => typeof k === 'string' && !hideKeys.includes(k));
    if (req.length) out.required = req;
    else delete out.required;
  }
  return out;
}

function stripNested(schema: Schema): Schema {
  const s: Schema = { ...schema };
  delete s.$schema;
  if (isObj(s.items)) s.items = stripNested(s.items);
  if (isObj(s.properties)) {
    s.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, isObj(v) ? stripNested(v) : v]));
  }
  return s;
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parametersJsonSchema?: Schema;
}

export function toGeminiFunctionDeclarations(
  tools: ToolDefinition[],
  opts: { hideDateArgs?: boolean } = {}
): GeminiFunctionDeclaration[] {
  const hide = opts.hideDateArgs === false ? [] : DATE_ARG_KEYS;
  return tools.map((t) => {
    if (!TOOL_NAME_RE.test(t.id)) throw new Error(`Invalid tool name: ${t.id}`);
    const schema = sanitizeToolSchema(t.input, hide);
    const hasParams = isObj(schema.properties) && Object.keys(schema.properties).length > 0;
    return {
      name: t.id,
      description: `${t.description}`.slice(0, 1000),
      ...(hasParams ? { parametersJsonSchema: schema } : {}),
    };
  });
}

export interface DateDefaults {
  startDate: string;
  endDate: string;
  compareStartDate?: string;
  compareEndDate?: string;
}

/** Model arguments + the UI's date range. Hidden date keys from the model are always overwritten. */
export function withDateDefaults(args: Record<string, unknown> | undefined, dates: DateDefaults): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    if (!(DATE_ARG_KEYS as readonly string[]).includes(k)) clean[k] = v;
  }
  clean.startDate = dates.startDate;
  clean.endDate = dates.endDate;
  if (dates.compareStartDate && dates.compareEndDate) {
    clean.compareStartDate = dates.compareStartDate;
    clean.compareEndDate = dates.compareEndDate;
  }
  return clean;
}

// ---------------------------------------------------------------------------
// Shortlisting for small models
// ---------------------------------------------------------------------------

const STOP = new Set(['the', 'a', 'an', 'of', 'for', 'and', 'or', 'to', 'in', 'on', 'by', 'is', 'are', 'was', 'were', 'what', 'which', 'how', 'my', 'me', 'our', 'with', 'this', 'that', 'last', 'week', 'month', 'show', 'tell', 'give', 'do', 'did', 'does', 'has', 'have', 'it', 'than', 'from', 'vs']);

/** Words in a question that point at a data source. */
const SOURCE_HINTS: Record<ToolSource, RegExp> = {
  ga4: /\b(traffic|sessions?|users?|visitors?|engagement|conversions?|key ?events?|channels?|country|countries|device|browser|landing|pages?|referr\w*|chatgpt|perplexity|gemini|claude|copilot|ai)\b/i,
  search_console: /\b(search|seo|quer(?:y|ies)|keywords?|ranking|rank|position|impressions?|ctr|clicks?|sitemaps?|cannibali\w*|google search)\b/i,
  meta: /\b(meta|facebook|instagram|ads?|campaigns?|spend|spent|cpc|cpm|cpl|cost|budget|reach|frequency|leads?|ad ?sets?|creatives?)\b/i,
  combined: /\b(roas|compare|versus|against|funnel|overall|everything|snapshot)\b/i,
};

function tokens(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2') // split camelCase ids
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function scoreTool(question: string, tool: ToolDefinition): number {
  const q = new Set(tokens(question));
  let score = 0;
  for (const t of tokens(`${tool.id} ${tool.title}`)) if (q.has(t)) score += 3;
  for (const t of new Set(tokens(tool.description))) if (q.has(t)) score += 1;
  if (SOURCE_HINTS[tool.source].test(question)) score += 2;
  return score;
}

/**
 * The few most relevant tools for a question. `availableSources` hides tools whose data source the
 * project has not connected. With no keyword match, falls back to each source's overview report.
 */
export function shortlistTools(
  question: string,
  tools: ToolDefinition[],
  opts: { max?: number; availableSources?: ToolSource[] } = {}
): ToolDefinition[] {
  const max = opts.max ?? 4;
  const pool = opts.availableSources ? tools.filter((t) => opts.availableSources!.includes(t.source) || t.source === 'combined') : tools;
  const ranked = pool
    .map((t) => ({ t, s: scoreTool(question, t) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.t.id.localeCompare(b.t.id));
  if (ranked.length > 0) return ranked.slice(0, max).map((x) => x.t);
  return pool.filter((t) => /overview/i.test(t.id)).slice(0, max);
}

/** One-line description: first sentence, trimmed. */
function firstSentence(text: string, limit = 140): string {
  const s = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return s.length > limit ? `${s.slice(0, limit - 1)}…` : s;
}

/**
 * Compact text menu for small models, e.g.
 *   ga4.trafficBreakdown(dimension: channel|sourceMedium|…, limit?: number) – Traffic grouped by …
 */
export function buildToolMenu(tools: ToolDefinition[], opts: { hideDateArgs?: boolean } = {}): string {
  const hide = opts.hideDateArgs === false ? [] : DATE_ARG_KEYS;
  return tools
    .map((t) => {
      const schema = sanitizeToolSchema(t.input, hide);
      const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
      const props = isObj(schema.properties) ? schema.properties : {};
      const args = Object.entries(props).map(([name, def]) => {
        const d = isObj(def) ? def : {};
        const type = Array.isArray(d.enum) ? (d.enum as unknown[]).slice(0, 8).join('|') + (d.enum.length > 8 ? '|…' : '') : String(d.type ?? 'any');
        return `${name}${required.has(name) ? '' : '?'}: ${type}`;
      });
      return `${t.id}(${args.join(', ')}) – ${firstSentence(t.description)}`;
    })
    .join('\n');
}
