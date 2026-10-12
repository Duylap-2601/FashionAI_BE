import { BadGatewayException, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { getGhnConfig } from './ghn.config';

interface GhnErrorBody {
  message?: string;
  code_message?: string;
  code_message_value?: string;
  data?: unknown;
}

@Injectable()
export class GhnClient {
  private readonly logger = new Logger(GhnClient.name);

  constructor(private readonly configService: ConfigService) {}

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const config = getGhnConfig(this.configService);
    const startedAt = Date.now();

    try {
      const response = await axios.get<T>(`${config.baseUrl}${path}`, {
        timeout: 15000,
        params,
        headers: {
          Token: config.token,
          ShopId: config.shopId,
        },
      });
      this.logger.log(`provider=GHN operation=get path=${path} statusCode=${response.status} duration=${Date.now() - startedAt} result=success`);
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError<GhnErrorBody>;
      const safeError = this.toSafeError(axiosError.response?.data);
      this.logger.warn(`provider=GHN operation=get path=${path} statusCode=${axiosError.response?.status ?? 'NETWORK'} duration=${Date.now() - startedAt} result=failed error=${JSON.stringify(safeError)}`);
      this.throwMappedError(axiosError.response?.status, safeError);
      throw new BadGatewayException(safeError);
    }
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const config = getGhnConfig(this.configService);
    const startedAt = Date.now();

    try {
      const response = await axios.post<T>(`${config.baseUrl}${path}`, body, {
        timeout: 15000,
        headers: {
          Token: config.token,
          ShopId: config.shopId,
          'Content-Type': 'application/json',
        },
      });
      this.logger.log(`provider=GHN operation=post path=${path} statusCode=${response.status} duration=${Date.now() - startedAt} result=success`);
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError<GhnErrorBody>;
      const safeError = this.toSafeError(axiosError.response?.data);
      this.logger.error(`provider=GHN operation=post path=${path} statusCode=${axiosError.response?.status ?? 'NETWORK'} duration=${Date.now() - startedAt} result=failed requestBody=${JSON.stringify(this.redactBody(body))} error=${JSON.stringify(safeError)}`);
      this.throwMappedError(axiosError.response?.status, safeError);
      throw new BadGatewayException(safeError);
    }
  }

  private toSafeError(body?: GhnErrorBody) {
    return {
      message: body?.message || 'GHN request failed',
      codeMessage: body?.code_message,
      codeMessageValue: body?.code_message_value,
    };
  }

  private throwMappedError(status: number | undefined, safeError: { message: string; codeMessage?: string; codeMessageValue?: string }) {
    if (status === 400) {
      const providerCode = safeError.codeMessage;
      const domainCode = providerCode?.includes('ADDRESS') || providerCode?.includes('WARD')
        ? 'ADDRESS_RECONFIRM_REQUIRED'
        : 'SHIPPING_ROUTE_UNAVAILABLE';
      throw new UnprocessableEntityException({
        code: domainCode,
        message: safeError.codeMessageValue || safeError.message || 'GHN không hỗ trợ tuyến giao hàng này.',
        details: { providerCode },
      });
    }
  }

  private redactBody(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.redactBody(item));
    if (!value || typeof value !== 'object') return value;

    const piiKeys = new Set([
      'to_name',
      'to_phone',
      'to_address',
      'from_phone',
      'from_address',
      'return_phone',
      'return_address',
      'note',
      'items',
      'Token',
      'token',
    ]);
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        piiKeys.has(key) ? '[REDACTED]' : this.redactBody(item),
      ]),
    );
  }
}
