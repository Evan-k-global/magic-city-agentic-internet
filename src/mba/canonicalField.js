import crypto from 'node:crypto';

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// This is intentionally o1js-free so the checkout web process can derive a
// commitment without loading any registry or proving code.
export function canonicalValueToFieldDecimal(value, fieldOrder) {
  const input = typeof value === 'string' ? value : canonicalize(value);
  const digest = crypto.createHash('sha256').update(input).digest('hex');
  return (BigInt(`0x${digest}`) % BigInt(fieldOrder)).toString();
}
