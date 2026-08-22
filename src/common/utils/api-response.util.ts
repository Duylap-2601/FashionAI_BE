import { Request } from 'express';

export interface ApiSuccessResponse<T> {
  success: true;
  code: string;
  message: string;
  timestamp: string;
  path?: string;
  data: T;
  meta?: unknown;
}

/**
 * Envelope chuẩn cho mọi response thành công: { success, code, message, data }.
 * Dùng chung để tất cả controller trả về cùng một shape (error envelope do
 * GlobalExceptionFilter đảm nhiệm).
 */
export function buildApiResponse<T>(
  req: Request,
  code: string,
  message: string,
  data: T,
  meta?: unknown,
): ApiSuccessResponse<T> {
  return {
    success: true,
    code,
    message,
    timestamp: new Date().toISOString(),
    path: req.originalUrl ?? req.url,
    data,
    ...(meta !== undefined ? { meta } : {}),
  };
}
