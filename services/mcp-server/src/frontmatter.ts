// Minimal YAML front-matter writer/parser. We only handle the limited subset
// phaedrus emits (scalar strings, ISO dates, string arrays). For anything more
// exotic the content repo's existing files stay untouched.

type Scalar = string | number | boolean | null;
type Value = Scalar | Scalar[];

function quote(s: string): string {
  if (/^[A-Za-z0-9._\-+/:]+$/.test(s) && !/^(true|false|null|yes|no|on|off)$/i.test(s)) return s;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function emitValue(v: Value): string {
  if (Array.isArray(v)) return `[${v.map((x) => emitValue(x as Value)).join(', ')}]`;
  if (v === null) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  return quote(v);
}

export function renderFrontMatter(data: Record<string, Value>, body: string): string {
  const lines = ['---'];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) continue;
    lines.push(`${k}: ${emitValue(v)}`);
  }
  lines.push('---', '');
  return lines.join('\n') + body.replace(/^\n+/, '') + (body.endsWith('\n') ? '' : '\n');
}

export function splitFrontMatter(source: string): { data: Record<string, string>; body: string } {
  const m = source.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: source };
  const data: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_\-]+):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2];
  }
  return { data, body: m[2] };
}
