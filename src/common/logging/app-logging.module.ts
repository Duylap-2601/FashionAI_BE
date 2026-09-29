import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { IncomingMessage, ServerResponse } from 'http';
import { Params } from 'nestjs-pino';
import {
  getRouteTemplate,
  resolveRequestId,
  sanitizeErrorForLog,
} from './logging.utils';

type ExpressRequest = IncomingMessage & {
  headers: IncomingMessage['headers'] & { 'x-request-id'?: string | string[] };
  id?: string;
  method?: string;
  url?: string;
  baseUrl?: string;
  route?: { path?: unknown };
};

type ExpressResponse = ServerResponse & {
  locals?: { logError?: unknown };
  statusCode: number;
  setHeader(name: string, value: number | string | readonly string[]): ServerResponse;
};

@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Params => {
        const environment = configService.get<string>('NODE_ENV', 'development');
        const service = configService.get<string>('SERVICE_NAME', 'fashionai-be');
        const version = configService.get<string>('APP_VERSION', '1.0.0');
        const logLevel = configService.get<string>('LOG_LEVEL', environment === 'production' ? 'info' : 'debug');
        const pretty = environment !== 'production' && configService
          .get<string>('LOG_PRETTY', environment === 'production' ? 'false' : 'true')
          .toLowerCase() === 'true';
        const trustRequestIdHeader = Number(configService.get<string>('TRUST_PROXY_HOPS', '0')) > 0;

        return {
          pinoHttp: {
            level: logLevel,
            messageKey: 'message',
            timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
            base: {
              service,
              environment,
              version,
            },
            formatters: {
              level: (label) => ({ level: label }),
            },
            customAttributeKeys: {
              req: 'request',
              res: 'response',
              responseTime: 'duration_ms',
            },
            redact: {
              paths: [
                'request.headers.authorization',
                'request.headers.cookie',
                'response.headers.set-cookie',
                '*.password',
                '*.accessToken',
                '*.refreshToken',
                '*.token',
                '*.otp',
                '*.apiKey',
                '*.signature',
                '*.connectionString',
              ],
              censor: '[REDACTED]',
            },
            transport: pretty
              ? {
                  target: 'pino-pretty',
                  options: {
                    colorize: true,
                    colorizeObjects: false,
                    customColors:
                      'trace:white,debug:blue,info:green,warn:yellow,error:red,fatal:bgRed',
                    levelFirst: true,
                    singleLine: true,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname',
                  },
                }
              : undefined,
            genReqId: (req: IncomingMessage, res: ServerResponse) => {
              const request = req as ExpressRequest;
              const response = res as ExpressResponse;
              const requestId = resolveRequestId(request.headers['x-request-id'], trustRequestIdHeader);
              request.id = requestId;
              request.headers['x-request-id'] = requestId;
              response.setHeader('X-Request-Id', requestId);
              return requestId;
            },
            serializers: {
              req: (req) => {
                const request = req.raw as ExpressRequest;
                return {
                  request_id: request.id,
                  method: request.method,
                  route: getRouteTemplate(request),
                };
              },
              res: (res) => ({
                status_code: res.statusCode,
              }),
            },
            customProps: (req: IncomingMessage, res: ServerResponse) => {
              const request = req as ExpressRequest;
              const response = res as ExpressResponse;
              const statusCode = response.statusCode;
              const route = getRouteTemplate(request);
              return {
                context: 'HTTP',
                event: 'http.request.completed',
                request_id: request.id,
                method: request.method,
                route,
                status_code: statusCode,
                outcome: statusCode >= 500 ? 'error' : statusCode >= 400 ? 'client_error' : 'success',
                error: response.locals?.logError
                  ? sanitizeErrorForLog(response.locals.logError)
                  : undefined,
              };
            },
            customLogLevel: (req, res, err) => {
              const request = req as ExpressRequest;
              const path = request.url?.split('?', 1)[0];
              if (!err && res.statusCode < 400 && path?.startsWith('/api/health')) return 'silent';
              if (err || res.statusCode >= 500) return 'error';
              return 'info';
            },
            customSuccessMessage: () => 'HTTP request completed',
            customErrorMessage: () => 'HTTP request completed with error',
          },
        };
      },
    }),
  ],
})
export class AppLoggingModule {}
