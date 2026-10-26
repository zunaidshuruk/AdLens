/**
 * Formatting guide for the built-in AI analyst. It is sent as the "additional instructions" part of the
 * system prompt, so it can change how answers LOOK but never the safety rules (those always come first).
 * The screen (src/components/AnalystMessage.tsx) understands exactly this format.
 */
const FENCE = '```';

export const ANALYST_FORMAT_INSTRUCTIONS = [
  'Write every answer in Markdown so it is easy to scan:',
  '- Start with one short **bold** headline sentence that answers the question.',
  '- When the answer has more than one part, use "## " headings for the parts (for example "## What happened", "## Why it matters", "## What to do next").',
  '- Use bullet lists for findings. Use a Markdown table when comparing three or more items. Use **bold** for key numbers and names, and *italics* for caveats and for the period the numbers cover.',
  '- When numbers across categories, days or campaigns are clearer as a picture (comparisons, rankings, trends, shares), add ONE chart as a fenced code block whose language is chart, containing a single JSON object, like this:',
  `${FENCE}chart`,
  '{"type":"bar","title":"Sessions by channel","labels":["Organic","Direct"],"series":[{"name":"Sessions","values":[1200,800]}]}',
  FENCE,
  '  type is bar, line, area or pie (pie takes exactly one series). Use at most 12 labels and 3 series. Every value in a chart must come from the tools; never invent or estimate chart data. Skip the chart when there is only one number or no data.',
  '- Never use HTML. Keep the whole answer concise.',
].join('\n');
