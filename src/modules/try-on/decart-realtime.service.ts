import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface DecartClientTokenRequest {
  origin?: string;
  maxDurationSeconds: number;
}

export interface DecartClientTokenResponse {
  clientToken: string;
  tokenExpiresAt: Date;
  raw?: Record<string, unknown>;
}

@Injectable()
export class DecartRealtimeService {
  private readonly logger = new Logger(DecartRealtimeService.name);
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly tokenTtlSeconds: number;
  private readonly provider: 'decart' | 'mock';

  constructor(private readonly config: ConfigService) {
    this.endpoint = normalizeClientTokenEndpoint(
      this.config.get<string>('DECART_CLIENT_TOKEN_ENDPOINT') ?? 'https://api.decart.ai/v1/client/tokens',
    );
    this.apiKey = this.config.get<string>('DECART_API_KEY') ?? '';
    this.tokenTtlSeconds = Number(this.config.get<string>('DECART_LIVE_TOKEN_TTL_SECONDS') ?? '120');
    this.provider = this.config.get<string>('DECART_LIVE_TRYON_PROVIDER') === 'mock' ? 'mock' : 'decart';
  }

  get model() {
    return this.config.get<string>('DECART_LIVE_MODEL') ?? 'lucy-vton-3.5';
  }

  getTokenTtlSeconds() {
    return this.tokenTtlSeconds;
  }

  async createClientToken(request: DecartClientTokenRequest): Promise<DecartClientTokenResponse> {
    const tokenExpiresAt = new Date(Date.now() + this.tokenTtlSeconds * 1000);

    if (this.provider === 'mock') {
      return {
        clientToken: `mock-live-token-${cryptoRandom()}`,
        tokenExpiresAt,
        raw: { provider: 'mock' },
      };
    }

    if (!this.apiKey) {
      throw new ServiceUnavailableException({ code: 'DECART_NOT_CONFIGURED', message: 'Decart API key is not configured' });
    }

    try {
      const response = await axios.post<Record<string, unknown>>(
        this.endpoint,
        {
          expiresIn: this.tokenTtlSeconds,
          allowedModels: [this.model],
          allowedOrigins: request.origin ? [request.origin] : undefined,
          constraints: {
            realtime: {
              maxSessionDuration: request.maxDurationSeconds,
            },
          },
        },
        {
          headers: { 'x-api-key': this.apiKey },
          timeout: Number(this.config.get<string>('DECART_CLIENT_TOKEN_TIMEOUT_MS') ?? '10000'),
        },
      );

      const token = readString(response.data, 'apiKey') ?? readString(response.data, 'clientToken') ?? readString(response.data, 'token');
      const expiresAt = readString(response.data, 'expiresAt') ?? readString(response.data, 'tokenExpiresAt');
      if (!token) {
        throw new BadGatewayException({ code: 'DECART_BAD_RESPONSE', message: 'Decart did not return a client token' });
      }

      return {
        clientToken: token,
        tokenExpiresAt: expiresAt ? new Date(expiresAt) : tokenExpiresAt,
        raw: redactTokenFields(response.data),
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.logger.warn(`[Decart] create client token failed: status=${error.response?.status ?? 'network'}`);
      }
      throw new BadGatewayException({ code: 'DECART_TOKEN_FAILED', message: 'Unable to create Decart client token' });
    }
  }
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function redactTokenFields(record: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !key.toLowerCase().includes('token')));
}

function cryptoRandom() {
  return Math.random().toString(36).slice(2, 12);
}

function normalizeClientTokenEndpoint(endpoint: string) {
  return endpoint.replace('/v1/client-tokens', '/v1/client/tokens');
}
