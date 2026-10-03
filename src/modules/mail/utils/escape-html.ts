export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeHeader(value: string): string {
  if (/\r|\n|[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('Invalid mail header value');
  }
  return value;
}
