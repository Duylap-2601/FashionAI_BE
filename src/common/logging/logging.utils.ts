import { randomUUID } from 'crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_STACK_LENGTH = 6000;

export interface SanitizedLogError {
  type: string;
  message: string;
  stack?: string;
}

export function createRequestId(): string {
  return randomUUID();
}

export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

export function resolveRequestId(headerValue: unknown, trustHeader: boolean): string {
  if (trustHeader) {
    const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (isValidRequestId(candidate)) return candidate;
  }

  return createRequestId();
}

export function truncateLogValue(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return value;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...[truncated]`;
}

export function sanitizeErrorForLog(error: unknown): SanitizedLogError {
  if (error instanceof Error) {
    return {
      type: error.name || 'Error',
      message: truncateLogValue(error.message, MAX_MESSAGE_LENGTH) ?? 'Unknown error',
      stack: truncateLogValue(error.stack, MAX_STACK_LENGTH),
    };
  }

  return {
    type: 'NonError',
    message: truncateLogValue(String(error), MAX_MESSAGE_LENGTH) ?? 'Unknown error',
  };
}

export function getRouteTemplate(req: { baseUrl?: string; route?: { path?: unknown } }): string {
  const routePath = req.route?.path;
  if (typeof routePath !== 'string') return 'unmatched_route';

  const baseUrl = req.baseUrl ?? '';
  const template = `${baseUrl}${routePath}`.replace(/\/+/g, '/');
  return template || '/';
}
