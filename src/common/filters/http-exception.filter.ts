import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = 'Lỗi hệ thống không xác định';
    let code = 'INTERNAL_SERVER_ERROR';
    let details: any = null;

    if (exception instanceof HttpException) {
      const res = exception.getResponse() as any;
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        message = res.message || exception.message;
        code = res.error ? res.error.toUpperCase().replace(/\s+/g, '_') : `HTTP_${status}`;
        if (Array.isArray(res.message)) {
          details = res.message;
          message = 'Dữ liệu đầu vào không hợp lệ';
          code = 'VALIDATION_ERROR';
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    const logLine = `[${request.method}] ${request.url} → ${status} (${code}): ${JSON.stringify(message)}`;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        logLine,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      // 4xx là lỗi phía client (token hết hạn, validate sai...). Stack trace của
      // chúng chỉ trỏ vào internals của passport/nest nên làm ngập log mà không
      // thêm thông tin gì để lần ra lỗi.
      this.logger.warn(logLine);
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      code,
      message,
      path: request.url,
      details,
      timestamp: new Date().toISOString(),
    });
  }
}
