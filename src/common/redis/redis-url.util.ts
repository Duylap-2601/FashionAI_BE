export function normalizeRedisUrl(raw?: string): string | undefined {
  if (!raw) return undefined;

  let value = raw.trim();
  if (value.startsWith('REDIS_URL=')) {
    value = value.slice('REDIS_URL='.length).trim();
  }

  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1).trim();
  }

  return value || undefined;
}

export function parseRedisUrl(raw?: string): URL | undefined {
  const value = normalizeRedisUrl(raw);
  if (!value) return undefined;

  try {
    const url = new URL(value);
    if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
      throw new Error(`unsupported Redis protocol ${url.protocol}`);
    }
    return url;
  } catch (err: any) {
    // Do not include the raw URL here; it may contain credentials.
    console.warn(`Invalid REDIS_URL ignored: ${err.message}`);
    return undefined;
  }
}
