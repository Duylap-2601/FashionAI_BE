import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    // Filter này chỉ format response HTTP. Lỗi trong WebSocket handler đi qua đây
    // sẽ crash vì switchToHttp().getResponse() không có .status()/.json(). Gateway
    // tự xử lý lỗi qua WsException nên rethrow để không nuốt mất.
    if (host.getType() !== 'http') {
      throw exception;
    }

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

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      response.locals.logError = exception;
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
