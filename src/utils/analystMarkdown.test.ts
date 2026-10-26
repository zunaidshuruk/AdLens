import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_CHART_JSON_CHARS,
  parseAnalystMarkdown,
  parseChartSpec,
  parseInline,
  type Block,
  type Inline,
} from './analystMarkdown.js';

const text = (v: string): Inline => ({ t: 'text', v });
const CHART = '{"type":"bar","title":"Sessions by channel","labels":["Organic","Direct"],"series":[{"name":"Sessions","values":[1200,800]}]}';

test('inline: bold, italic, code and https links', () => {
  assert.deepEqual(parseInline('a **b** c'), [text('a '), { t: 'bold', c: [text('b')] }, text(' c')]);
  assert.deepEqual(parseInline('an *italic* word'), [text('an '), { t: 'italic', c: [text('italic')] }, text(' word')]);
  assert.deepEqual(parseInline('an _italic_ word'), [text('an '), { t: 'italic', c: [text('italic')] }, text(' word')]);
  assert.deepEqual(parseInline('use `x*y`'), [text('use '), { t: 'code', v: 'x*y' }]);
  assert.deepEqual(parseInline('**bold *and italic***'), [
    { t: 'bold', c: [text('bold '), { t: 'italic', c: [text('and italic')] }] },
  ]);
  assert.deepEqual(parseInline('[docs](https://example.com/a)'), [{ t: 'link', href: 'https://example.com/a', c: [text('docs')] }]);
});

test('inline: things that are NOT formatting stay as written', () => {
  assert.deepEqual(parseInline('5 * 3 * 2'), [text('5 * 3 * 2')]);
  assert.deepEqual(parseInline('snake_case_name'), [text('snake_case_name')]);
  assert.deepEqual(parseInline('unclosed **bold'), [text('unclosed **bold')]);
});

test('inline: unsafe links and HTML are never turned into links or markup', () => {
  const js = parseInline('[x](javascript:alert(1))');
  assert.equal(js.some((n) => n.t === 'link'), false);
  const data = parseInline('[x](data:text/html;base64,AAAA)');
  assert.equal(data.some((n) => n.t === 'link'), false);
  const html = parseInline('<img src=x onerror=alert(1)> <script>x</script>');
  assert.deepEqual(html, [text('<img src=x onerror=alert(1)> <script>x</script>')]);
});

test('blocks: headings, paragraph, bullet and numbered lists', () => {
  const md = '# Title\n\n## Section\n\nSome **text** here\nsecond line\n\n- one\n- two\n\n1. first\n2) second';
  const b = parseAnalystMarkdown(md);
  assert.deepEqual(
    b.map((x) => x.type),
    ['heading', 'heading', 'paragraph', 'list', 'list']
  );
  assert.equal((b[0] as Extract<Block, { type: 'heading' }>).level, 1);
  assert.equal((b[1] as Extract<Block, { type: 'heading' }>).level, 2);
  assert.deepEqual((b[2] as Extract<Block, { type: 'paragraph' }>).content[2], text(' here second line'));
  assert.equal((b[3] as Extract<Block, { type: 'list' }>).ordered, false);
  assert.equal((b[3] as Extract<Block, { type: 'list' }>).items.length, 2);
  assert.equal((b[4] as Extract<Block, { type: 'list' }>).ordered, true);
  assert.equal((b[4] as Extract<Block, { type: 'list' }>).items.length, 2);
});

test('blocks: heading levels above 4 are capped at 4', () => {
  const b = parseAnalystMarkdown('###### Deep');
  assert.equal((b[0] as Extract<Block, { type: 'heading' }>).level, 4);
});

test('blocks: table with header and rows; short rows are padded', () => {
  const md = '| Channel | Sessions |\n|---|---:|\n| Organic | **1,200** |\n| Direct |';
  const [t] = parseAnalystMarkdown(md);
  assert.equal(t.type, 'table');
  const tbl = t as Extract<Block, { type: 'table' }>;
  assert.equal(tbl.header.length, 2);
  assert.equal(tbl.rows.length, 2);
  assert.deepEqual(tbl.rows[0][1], [{ t: 'bold', c: [text('1,200')] }]);
  assert.equal(tbl.rows[1].length, 2);
});

test('blocks: quote, rule and code fence', () => {
  const b = parseAnalystMarkdown('> a note\n\n---\n\n```\nraw *text*\n```');
  assert.deepEqual(b.map((x) => x.type), ['quote', 'hr', 'code']);
  assert.equal((b[2] as Extract<Block, { type: 'code' }>).text, 'raw *text*');
});

test('chart: a valid chart block becomes a chart; surrounding text is kept', () => {
  const b = parseAnalystMarkdown(`**Organic leads.**\n\n\`\`\`chart\n${CHART}\n\`\`\`\n\n*Period: last 28 days*`);
  assert.deepEqual(b.map((x) => x.type), ['paragraph', 'chart', 'paragraph']);
  const spec = (b[1] as Extract<Block, { type: 'chart' }>).spec;
  assert.deepEqual(spec, {
    type: 'bar',
    title: 'Sessions by channel',
    labels: ['Organic', 'Direct'],
    series: [{ name: 'Sessions', values: [1200, 800] }],
  });
});

test('chart: invalid charts are dropped, never shown as broken output', () => {
  const bad = [
    '{not json',
    '[]',
    '{"type":"scatter","labels":["a"],"series":[{"name":"x","values":[1]}]}',
    '{"type":"bar","labels":[],"series":[{"name":"x","values":[]}]}',
    '{"type":"bar","labels":["a","b"],"series":[{"name":"x","values":[1]}]}',
    '{"type":"bar","labels":["a"],"series":[{"name":"x","values":["1"]}]}',
    '{"type":"bar","labels":["a"],"series":[{"name":"x","values":[null]}]}',
    '{"type":"pie","labels":["a","b"],"series":[{"name":"x","values":[1,2]},{"name":"y","values":[1,2]}]}',
    '{"type":"pie","labels":["a","b"],"series":[{"name":"x","values":[1,-2]}]}',
    '{"type":"bar","labels":["a"],"series":[]}',
    `{"type":"bar","labels":["a"],"series":[{"name":"${'x'.repeat(MAX_CHART_JSON_CHARS)}","values":[1]}]}`,
  ];
  for (const raw of bad) assert.equal(parseChartSpec(raw), null, raw.slice(0, 60));
  const b = parseAnalystMarkdown('Answer\n\n```chart\n{broken\n```');
  assert.deepEqual(b.map((x) => x.type), ['paragraph']);
});

test('chart: limits on labels and series are enforced; long names are trimmed', () => {
  const many = Array.from({ length: 25 }, (_, i) => `L${i}`);
  assert.equal(parseChartSpec(JSON.stringify({ type: 'bar', labels: many, series: [{ name: 's', values: many.map(() => 1) }] })), null);
  const six = Array.from({ length: 6 }, (_, i) => ({ name: `s${i}`, values: [1] }));
  assert.equal(parseChartSpec(JSON.stringify({ type: 'line', labels: ['a'], series: six })), null);
  const ok = parseChartSpec(JSON.stringify({ type: 'line', title: 'T'.repeat(200), labels: ['a'], series: [{ name: '', values: [1] }] }));
  assert.equal(ok?.title.length, 60);
  assert.equal(ok?.series[0].name, 'Value');
});

test('robustness: empty, non-string and hostile input never throw', () => {
  assert.deepEqual(parseAnalystMarkdown(''), []);
  assert.deepEqual(parseAnalystMarkdown(undefined as unknown as string), []);
  const hostile = '*'.repeat(5000) + '_'.repeat(5000) + '['.repeat(2000) + '`'.repeat(2000);
  assert.doesNotThrow(() => parseAnalystMarkdown(hostile));
  assert.doesNotThrow(() => parseAnalystMarkdown('|'.repeat(3000) + '\n' + '-'.repeat(3000)));
});
