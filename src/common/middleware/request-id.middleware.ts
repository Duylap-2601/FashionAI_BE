import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import { isValidRequestId, resolveRequestId } from '../logging/logging.utils';

type RequestWithId = Request & { id?: string };

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(private readonly configService: ConfigService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const request = req as RequestWithId;
    const trustRequestIdHeader = Number(this.configService.get<string>('TRUST_PROXY_HOPS', '0')) > 0;
    const requestId = isValidRequestId(request.id)
      ? request.id
      : resolveRequestId(req.headers['x-request-id'], trustRequestIdHeader);
    request.id = requestId;
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}
