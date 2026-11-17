const REDACTED_KEYS = new Set([
  'password',
  'passwordhash',
  'accesstoken',
  'refreshtoken',
  'token',
  'secret',
  'clinicalnotes',
  'diagnosis',
  'medicalnotes',
  'qrhashsignature',
]);

const LARGE_BINARY_KEYS = new Set(['qrdataurl']);

export function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[MAX_DEPTH]';
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeAuditValue(item, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    if (REDACTED_KEYS.has(normalized)) {
      out[key] = '[REDACTED]';
      continue;
    }
    if (LARGE_BINARY_KEYS.has(normalized)) {
      out[key] = '[BINARY_OMITTED]';
      continue;
    }
    if (entry !== undefined) {
      out[key] = sanitizeAuditValue(entry, depth + 1);
    }
  }
  return out;
}

export function computeChangedFields(
  oldValue: unknown,
  newValue: unknown,
): string[] {
  const before =
    oldValue && typeof oldValue === 'object' && !Array.isArray(oldValue)
      ? (oldValue as Record<string, unknown>)
      : {};
  const after =
    newValue && typeof newValue === 'object' && !Array.isArray(newValue)
      ? (newValue as Record<string, unknown>)
      : {};

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];

  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changed.push(key);
    }
  }

  return changed.sort();
}
