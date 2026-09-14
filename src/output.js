/**
 * Table and JSON output utilities.
 */

const CJK = /[\u4e00-\u9fff\u3400-\u4dbf\uff00-\uffef]/;

function cjkWidth(s) {
  let w = 0;
  for (const ch of s) w += CJK.test(ch) ? 2 : 1;
  return w;
}

function padEnd(s, width) {
  const cur = cjkWidth(s);
  const need = Math.max(0, width - cur);
  return s + ' '.repeat(need);
}

/**
 * Render array of objects as a space-aligned table.
 * First row = header.
 */
export function table(rows) {
  if (rows.length === 0) return '';
  const keys = Object.keys(rows[0]);
  const widths = keys.map(k => Math.max(cjkWidth(k), ...rows.map(r => cjkWidth(String(r[k] ?? '')))));
  const lines = [];
  const sep = [];
  for (let i = 0; i < keys.length; i++) {
    const w = widths[i];
    sep.push('─'.repeat(w));
  }
  lines.push(keys.map((k, i) => padEnd(k, widths[i])).join('  '));
  lines.push(sep.join('──'));
  for (const row of rows) {
    lines.push(keys.map((k, i) => padEnd(String(row[k] ?? ''), widths[i])).join('  '));
  }
  return lines.join('\n');
}

/**
 * Print data either as JSON or as human table.
 */
export function output(data, opts = {}) {
  if (opts.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }
  if (Array.isArray(data) && data.length > 0) {
    process.stdout.write(table(data) + '\n');
  } else if (Array.isArray(data)) {
    process.stdout.write('(空)\n');
  } else {
    process.stdout.write(table([data]) + '\n');
  }
}