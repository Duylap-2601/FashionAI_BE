import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ArgumentsHost } from '@nestjs/common';
import { GlobalExceptionFilter } from '../../src/common/filters/http-exception.filter';

function httpHost() {
  const json = jest.fn();
  const response = { status: jest.fn(() => ({ json })), locals: {} as Record<string, unknown> };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ url: '/api/health' }) }),
  } as unknown as ArgumentsHost;
  return { host, response, json };
}

describe('GlobalExceptionFilter', () => {
  it('trả 503 thay vì sập process khi health check báo lỗi (error là object)', () => {
    const { host, response, json } = httpHost();
    const healthError = new ServiceUnavailableException({
      status: 'error',
      info: { redis: { status: 'up' } },
      error: { database: { status: 'down', message: 'timeout of 1000ms exceeded' } },
      details: { database: { status: 'down' } },
    });

    expect(() => new GlobalExceptionFilter().catch(healthError, host)).not.toThrow();
    expect(response.status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 503, code: 'HTTP_503' }));
  });

  it('vẫn dùng error dạng chuỗi làm mã lỗi', () => {
    const { host, json } = httpHost();
    new GlobalExceptionFilter().catch(new BadRequestException('Sai dữ liệu'), host);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, code: 'BAD_REQUEST' }));
  });

  it('không trả message gốc của lỗi nội bộ (Prisma, đường dẫn file) cho client', () => {
    const { host, response, json } = httpHost();
    const prismaError = new Error(
      'Invalid `tx.order.create()` invocation in /Users/loi/go/projects/FashionAI_BE/src/modules/orders/orders.service.ts:233:40 Transaction API error: Transaction already closed',
    );

    new GlobalExceptionFilter().catch(prismaError, host);

    expect(response.status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.message).toBe('Hệ thống đang bận, vui lòng thử lại sau ít phút.');
    expect(JSON.stringify(body)).not.toContain('orders.service.ts');
    expect(response.locals.logError).toBe(prismaError);
  });
});
