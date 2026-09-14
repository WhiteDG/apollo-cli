import { readFileSync, existsSync } from 'node:fs';

/**
 * Minimal .env parser.
 * Only loads keys that do NOT already exist in process.env (shell wins).
 * Supports: KEY=VAL, full-line # comments, blank lines, ' and " quoting, export prefix.
 */
export function loadDotEnv(path = '.env') {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Strip optional "export "
    const line = trimmed.startsWith('export ') ? trimmed.slice(7).trimStart() : trimmed;

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;

    let key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();

    // Remove surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }

    // Only set if not already defined (shell env wins)
    if (!Object.hasOwn(process.env, key)) {
      process.env[key] = val;
    }
  }
}