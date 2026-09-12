import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { getGhnConfig } from './ghn.config';

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
      const axiosError = error as AxiosError<{ message?: string }>;
      this.logger.warn(`provider=GHN operation=get path=${path} statusCode=${axiosError.response?.status ?? 'NETWORK'} duration=${Date.now() - startedAt} result=failed`);
      throw new BadGatewayException(axiosError.response?.data?.message || 'GHN request failed');
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
      const axiosError = error as AxiosError<{ message?: string }>;
      this.logger.warn(`provider=GHN operation=post path=${path} statusCode=${axiosError.response?.status ?? 'NETWORK'} duration=${Date.now() - startedAt} result=failed`);
      throw new BadGatewayException(axiosError.response?.data?.message || 'GHN request failed');
    }
  }
}
