import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import {
  GarmentCategory,
  LiveTryOnCredentialStatus,
  LiveTryOnReservationStatus,
  LiveTryOnSessionStatus,
  Prisma,
  Product,
  ProductStatus,
  UserTier,
} from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CreateLiveSessionDto } from './dto/create-live-session.dto';
import { DecartRealtimeService } from './decart-realtime.service';

interface LiveTryOnPolicy {
  enabled: boolean;
  transport: 'direct';
  disabledReason?: string;
  maxDurationSeconds: number;
  tokenTtlSeconds: number;
  graceSeconds: number;
  userDailySeconds: number;
  globalDailyCredits: number;
  maxConcurrentSessions: number;
  rateCreditsPerSecond: number;
  policyVersion: string;
  betaUserIds: Set<string>;
  betaProductIds: Set<string>;
  allowedCategories: Set<GarmentCategory>;
}

@Injectable()
export class LiveTryOnService {
  private readonly logger = new Logger(LiveTryOnService.name);
  private missingMigrationLogged = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly decart: DecartRealtimeService,
  ) {}

  async getQuota(user: AuthenticatedUser) {
    const policy = this.getPolicy();
    const eligibility = this.getEligibility(user, policy);
    const quotaDate = utcDateKey(new Date());
    const budget = await this.prisma.liveTryOnBudget.findUnique({
      where: { scopeKey_date: { scopeKey: `user:${user.id}`, date: quotaDate } },
    });
    const activeLease = await this.prisma.liveTryOnLease.findUnique({ where: { userId: user.id } });
    const activeSession = activeLease && activeLease.expiresAt > new Date()
      ? await this.prisma.liveTryOnSession.findUnique({ where: { id: activeLease.sessionId } })
      : null;

    const reserved = budget?.reservedSeconds ?? 0;
    const allocated = budget?.allocatedSeconds ?? 0;
    const limit = policy.enabled ? policy.userDailySeconds : 0;

    return {
      enabled: policy.enabled,
      eligible: eligibility.eligible,
      disabledReason: eligibility.disabledReason ?? policy.disabledReason,
      unit: 'seconds' as const,
      limit,
      reserved,
      allocated,
      remaining: Math.max(0, limit - reserved - allocated),
      resetAt: nextUtcReset().toISOString(),
      maxDurationSeconds: policy.maxDurationSeconds,
      activeSession: activeSession
        ? {
            sessionId: activeSession.id,
            status: activeSession.status,
            blockedUntil: activeSession.blockedUntil.toISOString(),
          }
        : null,
    };
  }

  async getGarment(user: AuthenticatedUser, productId: string) {
    const policy = this.getPolicy();
    this.assertEnabledAndEligible(user, policy);
    if (!isUuid(productId)) {
      throw new BadRequestException({ code: 'INVALID_PRODUCT_ID', message: 'productId must be a UUID' });
    }
    const product = await this.resolveLiveProduct(productId, policy);
    await this.assertGarmentUrlReadable(product.garmentUrl);
    return this.mapGarment(product);
  }

  async createSession(user: AuthenticatedUser, dto: CreateLiveSessionDto, idempotencyKey: string, origin?: string) {
    const policy = this.getPolicy();
    this.assertEnabledAndEligible(user, policy);
    if (!idempotencyKey || !isUuid(idempotencyKey)) {
      throw new BadRequestException({ code: 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key must be a UUID' });
    }
    if (!isUuid(dto.productId)) {
      throw new BadRequestException({ code: 'INVALID_PRODUCT_ID', message: 'productId must be a UUID' });
    }

    const bodyHash = hashJson({ productId: dto.productId });
    const existing = await this.prisma.liveTryOnSession.findUnique({
      where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } },
    });
    if (existing) {
      if (existing.idempotencyBodyHash !== bodyHash) {
        throw new ConflictException({ code: 'IDEMPOTENCY_BODY_MISMATCH', message: 'Idempotency-Key was already used with a different body' });
      }
      throw new ConflictException({
        code: existing.credentialStatus === LiveTryOnCredentialStatus.ISSUING ? 'SESSION_PENDING' : 'SESSION_ALREADY_ISSUED',
        message: 'Live Try-On session was already requested for this key',
        sessionId: existing.id,
        blockedUntil: existing.blockedUntil.toISOString(),
      });
    }

    const activeLease = await this.prisma.liveTryOnLease.findUnique({ where: { userId: user.id } });
    if (activeLease && activeLease.expiresAt > new Date()) {
      throw new ConflictException({ code: 'LIVE_SESSION_ACTIVE', message: 'A Live Try-On lease is still active', blockedUntil: activeLease.expiresAt.toISOString() });
    }

    const product = await this.resolveLiveProduct(dto.productId, policy);
    await this.assertGarmentUrlReadable(product.garmentUrl);
    const now = new Date();
    const quotaDate = utcDateKey(now);
    const blockedUntil = new Date(now.getTime() + (policy.tokenTtlSeconds + policy.maxDurationSeconds + policy.graceSeconds) * 1000);

    const session = await this.reserveSession(user.id, product.id, idempotencyKey, bodyHash, quotaDate, blockedUntil, policy);

    try {
      const token = await this.decart.createClientToken({ origin, maxDurationSeconds: policy.maxDurationSeconds });
      await this.prisma.liveTryOnSession.update({
        where: { id: session.id },
        data: {
          credentialStatus: LiveTryOnCredentialStatus.ISSUED,
          issuedAt: now,
          tokenExpiresAt: token.tokenExpiresAt,
          providerMetadata: token.raw ? (token.raw as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
      });

      return {
        sessionId: session.id,
        transport: policy.transport,
        connection: {
          clientToken: token.clientToken,
          tokenExpiresAt: token.tokenExpiresAt.toISOString(),
        },
        serverNow: new Date().toISOString(),
        blockedUntil: session.blockedUntil.toISOString(),
        model: session.model,
        maxDurationSeconds: policy.maxDurationSeconds,
        garment: this.mapGarment(product),
      };
    } catch (error) {
      await this.releaseFailedReservation(session.id, user.id, quotaDate, policy.maxDurationSeconds);
      throw error;
    }
  }

  async endSession(user: AuthenticatedUser, sessionId: string, reason?: string) {
    const session = await this.prisma.liveTryOnSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== user.id) {
      throw new NotFoundException({ code: 'LIVE_SESSION_NOT_FOUND', message: 'Live Try-On session not found' });
    }

    const now = new Date();
    const clientEndGraceSeconds = Number(this.config.get<string>('DECART_LIVE_CLIENT_END_GRACE_SECONDS') ?? '15');
    const shortenedBlockedUntil = new Date(now.getTime() + clientEndGraceSeconds * 1000);
    const blockedUntil = shortenedBlockedUntil < session.blockedUntil ? shortenedBlockedUntil : session.blockedUntil;

    const updated = await this.prisma.liveTryOnSession.update({
      where: { id: session.id },
      data: {
        status: LiveTryOnSessionStatus.ENDED,
        clientEndedAt: session.clientEndedAt ?? now,
        endedReason: session.endedReason ?? reason ?? 'client_end',
        blockedUntil,
      },
    });
    await this.prisma.liveTryOnLease.updateMany({
      where: { userId: user.id, sessionId: session.id, expiresAt: { gt: blockedUntil } },
      data: { expiresAt: blockedUntil },
    });

    return {
      sessionId: updated.id,
      status: updated.status,
      blockedUntil: updated.blockedUntil.toISOString(),
    };
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'live-try-on-session-reconcile' })
  async reconcileExpiredSessions() {
    if (!this.getPolicy().enabled) return;

    const now = new Date();
    try {
      const candidates = await this.prisma.liveTryOnSession.findMany({
        where: {
          reservationStatus: LiveTryOnReservationStatus.RESERVED,
          blockedUntil: { lte: now },
          credentialStatus: {
            in: [
              LiveTryOnCredentialStatus.ISSUING,
              LiveTryOnCredentialStatus.ISSUED,
              LiveTryOnCredentialStatus.ISSUE_UNKNOWN,
            ],
          },
        },
        orderBy: { blockedUntil: 'asc' },
        take: 50,
      });

      for (const session of candidates) {
        await this.settleExpiredSession(session.id).catch(() => undefined);
      }
    } catch (error) {
      if (isMissingLiveTryOnTableError(error)) {
        if (!this.missingMigrationLogged) {
          this.logger.warn('Live Try-On migration is not applied; session reconcile worker is skipped. Run prisma migrate deploy before enabling Live Try-On.');
          this.missingMigrationLogged = true;
        }
        return;
      }
      throw error;
    }
  }

  private async reserveSession(
    userId: string,
    productId: string,
    idempotencyKey: string,
    bodyHash: string,
    quotaDate: string,
    blockedUntil: Date,
    policy: LiveTryOnPolicy,
  ) {
    return this.withSerializableRetry((tx) => this.reserveSessionTx(
      tx,
      userId,
      productId,
      idempotencyKey,
      bodyHash,
      quotaDate,
      blockedUntil,
      policy,
    ));
  }

  private async reserveSessionTx(
    tx: Prisma.TransactionClient,
    userId: string,
    productId: string,
    idempotencyKey: string,
    bodyHash: string,
    quotaDate: string,
    blockedUntil: Date,
    policy: LiveTryOnPolicy,
  ) {
      const activeConcurrency = await tx.liveTryOnLease.count({ where: { expiresAt: { gt: new Date() } } });
      if (activeConcurrency >= policy.maxConcurrentSessions) {
        throw new ForbiddenException({ code: 'LIVE_CONCURRENCY_EXCEEDED', message: 'Live Try-On concurrency limit reached' });
      }

      const scopeKey = `user:${userId}`;
      const budget = await tx.liveTryOnBudget.upsert({
        where: { scopeKey_date: { scopeKey, date: quotaDate } },
        create: { scopeKey, date: quotaDate, userId, limitSeconds: policy.userDailySeconds },
        update: {},
      });
      const remaining = policy.userDailySeconds - budget.reservedSeconds - budget.allocatedSeconds;
      if (remaining < policy.maxDurationSeconds) {
        throw new ForbiddenException({ code: 'LIVE_QUOTA_EXCEEDED', message: 'Live Try-On quota exceeded', remaining });
      }

      const globalScopeKey = 'global';
      const globalLimitSeconds = Math.floor(policy.globalDailyCredits / policy.rateCreditsPerSecond);
      const globalBudget = await tx.liveTryOnBudget.upsert({
        where: { scopeKey_date: { scopeKey: globalScopeKey, date: quotaDate } },
        create: { scopeKey: globalScopeKey, date: quotaDate, limitSeconds: globalLimitSeconds },
        update: {},
      });
      const globalRemaining = globalLimitSeconds - globalBudget.reservedSeconds - globalBudget.allocatedSeconds;
      if (globalRemaining < policy.maxDurationSeconds) {
        throw new ForbiddenException({ code: 'LIVE_GLOBAL_BUDGET_EXCEEDED', message: 'Live Try-On global budget exceeded', remaining: globalRemaining });
      }

      const session = await tx.liveTryOnSession.create({
        data: {
          userId,
          productId,
          model: this.decart.model,
          transport: policy.transport,
          idempotencyKey,
          idempotencyBodyHash: bodyHash,
          quotaDate,
          reservedSeconds: policy.maxDurationSeconds,
          policyVersion: policy.policyVersion,
          rateCreditsPerSecond: policy.rateCreditsPerSecond,
          blockedUntil,
        },
      });

      await tx.liveTryOnBudget.update({
        where: { id: budget.id },
        data: { reservedSeconds: { increment: policy.maxDurationSeconds } },
      });
      await tx.liveTryOnBudget.update({
        where: { id: globalBudget.id },
        data: { reservedSeconds: { increment: policy.maxDurationSeconds } },
      });
      await tx.liveTryOnLease.upsert({
        where: { userId },
        create: { userId, sessionId: session.id, expiresAt: blockedUntil },
        update: { sessionId: session.id, expiresAt: blockedUntil },
      });

      return session;
  }

  private async releaseFailedReservation(sessionId: string, userId: string, quotaDate: string, seconds: number) {
    await this.prisma.$transaction(async (tx) => {
      await tx.liveTryOnSession.update({
        where: { id: sessionId },
        data: {
          credentialStatus: LiveTryOnCredentialStatus.ISSUE_FAILED,
          reservationStatus: LiveTryOnReservationStatus.RELEASED,
          status: LiveTryOnSessionStatus.FAILED,
        },
      });
      await tx.liveTryOnBudget.update({
        where: { scopeKey_date: { scopeKey: `user:${userId}`, date: quotaDate } },
        data: { reservedSeconds: { decrement: seconds } },
      });
      await tx.liveTryOnBudget.updateMany({
        where: { scopeKey: 'global', date: quotaDate },
        data: { reservedSeconds: { decrement: seconds } },
      });
      await tx.liveTryOnLease.deleteMany({ where: { userId, sessionId } });
    });
  }

  private async settleExpiredSession(sessionId: string) {
    await this.withSerializableRetry(async (tx) => {
      const session = await tx.liveTryOnSession.findUnique({ where: { id: sessionId } });
      if (!session || session.reservationStatus !== LiveTryOnReservationStatus.RESERVED) return;
      if (session.blockedUntil > new Date()) return;

      const allocatedSeconds = session.reservedSeconds;
      await tx.liveTryOnSession.update({
        where: { id: session.id },
        data: {
          status: session.status === LiveTryOnSessionStatus.ACTIVE ? LiveTryOnSessionStatus.EXPIRED : session.status,
          credentialStatus: session.credentialStatus === LiveTryOnCredentialStatus.ISSUING
            ? LiveTryOnCredentialStatus.ISSUE_UNKNOWN
            : session.credentialStatus,
          reservationStatus: LiveTryOnReservationStatus.ALLOCATED,
          allocatedSeconds,
        },
      });
      await tx.liveTryOnBudget.update({
        where: { scopeKey_date: { scopeKey: `user:${session.userId}`, date: session.quotaDate } },
        data: {
          reservedSeconds: { decrement: session.reservedSeconds },
          allocatedSeconds: { increment: allocatedSeconds },
        },
      });
      await tx.liveTryOnBudget.updateMany({
        where: { scopeKey: 'global', date: session.quotaDate },
        data: {
          reservedSeconds: { decrement: session.reservedSeconds },
          allocatedSeconds: { increment: allocatedSeconds },
        },
      });
      await tx.liveTryOnLease.deleteMany({ where: { userId: session.userId, sessionId: session.id } });
    });
  }

  private async withSerializableRetry<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    const maxAttempts = Number(this.config.get<string>('DECART_LIVE_DB_RETRY_ATTEMPTS') ?? '3');
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        lastError = error;
        if (!isRetryableTransactionError(error) || attempt === maxAttempts) break;
      }
    }
    throw lastError;
  }

  private async resolveLiveProduct(productId: string, policy: LiveTryOnPolicy) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException({ code: 'LIVE_GARMENT_NOT_FOUND', message: 'Product not found' });
    }
    if (product.status !== ProductStatus.ACTIVE || !product.garmentUrl) {
      throw new BadRequestException({ code: 'LIVE_GARMENT_UNAVAILABLE', message: 'Product is not available for Live Try-On' });
    }
    if (!policy.allowedCategories.has(product.category)) {
      throw new BadRequestException({ code: 'LIVE_GARMENT_CATEGORY_UNSUPPORTED', message: 'Product category is not enabled for Live Try-On' });
    }
    if (policy.betaProductIds.size > 0 && !policy.betaProductIds.has(product.id)) {
      throw new ForbiddenException({ code: 'LIVE_PRODUCT_NOT_ALLOWED', message: 'Product is not allowlisted for Live Try-On beta' });
    }
    return product;
  }

  private mapGarment(product: Product) {
    return {
      productId: product.id,
      imageUrl: product.garmentUrl,
      prompt: buildPrompt(product),
      category: product.category,
    };
  }

  private async assertGarmentUrlReadable(url: string) {
    try {
      const response = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: Number(this.config.get<string>('DECART_LIVE_GARMENT_FETCH_TIMEOUT_MS') ?? '10000'),
        maxContentLength: Number(this.config.get<string>('DECART_LIVE_GARMENT_MAX_BYTES') ?? `${8 * 1024 * 1024}`),
      });
      const contentType = String(response.headers['content-type'] ?? '');
      if (!contentType.startsWith('image/')) {
        throw new BadRequestException({ code: 'LIVE_GARMENT_BAD_CONTENT_TYPE', message: `Garment URL must return image content-type, got ${contentType || 'unknown'}` });
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException({ code: 'LIVE_GARMENT_UNREADABLE', message: 'Garment URL must be publicly readable before starting Live Try-On' });
    }
  }

  private assertEnabledAndEligible(user: AuthenticatedUser, policy: LiveTryOnPolicy) {
    const eligibility = this.getEligibility(user, policy);
    if (!policy.enabled || !eligibility.eligible) {
      throw new ForbiddenException({ code: 'LIVE_TRYON_DISABLED', message: eligibility.disabledReason ?? policy.disabledReason ?? 'Live Try-On is disabled' });
    }
  }

  private getEligibility(user: AuthenticatedUser, policy: LiveTryOnPolicy) {
    if (!policy.enabled) return { eligible: false, disabledReason: policy.disabledReason ?? 'feature_disabled' };
    if (user.tier === UserTier.FREE) return { eligible: false, disabledReason: 'free_not_allowed' };
    if (user.tierExpiresAt && user.tierExpiresAt.getTime() < Date.now()) return { eligible: false, disabledReason: 'subscription_expired' };
    if (policy.betaUserIds.size > 0 && !policy.betaUserIds.has(user.id)) return { eligible: false, disabledReason: 'not_in_beta' };
    return { eligible: true };
  }

  private getPolicy(): LiveTryOnPolicy {
    const enabled = this.config.get<string>('DECART_LIVE_TRYON_ENABLED') === 'true';
    return {
      enabled,
      transport: 'direct',
      disabledReason: enabled ? undefined : 'feature_disabled',
      maxDurationSeconds: Number(this.config.get<string>('DECART_LIVE_MAX_DURATION_SECONDS') ?? '60'),
      tokenTtlSeconds: this.decart.getTokenTtlSeconds(),
      graceSeconds: Number(this.config.get<string>('DECART_LIVE_GRACE_SECONDS') ?? '30'),
      userDailySeconds: Number(this.config.get<string>('DECART_LIVE_USER_DAILY_SECONDS') ?? '300'),
      globalDailyCredits: Number(this.config.get<string>('DECART_LIVE_GLOBAL_DAILY_CREDITS') ?? '12000'),
      maxConcurrentSessions: Number(this.config.get<string>('DECART_LIVE_MAX_CONCURRENT_SESSIONS') ?? '5'),
      rateCreditsPerSecond: Number(this.config.get<string>('DECART_LIVE_RATE_CREDITS_PER_SECOND') ?? '2'),
      policyVersion: this.config.get<string>('DECART_LIVE_POLICY_VERSION') ?? 'live-v1',
      betaUserIds: csvSet(this.config.get<string>('DECART_LIVE_BETA_USER_IDS')),
      betaProductIds: csvSet(this.config.get<string>('DECART_LIVE_BETA_PRODUCT_IDS')),
      allowedCategories: categorySet(this.config.get<string>('DECART_LIVE_ALLOWED_CATEGORIES') ?? 'UPPER'),
    };
  }
}

function buildPrompt(product: Product) {
  const maxPromptLength = 858;
  const instruction = 'Virtual try-on. Preserve garment color, pattern, silhouette, and construction details.';
  const details = [product.color, product.material, product.name, product.description]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const availableLength = maxPromptLength - instruction.length - 1;
  const shortenedDetails = details.length > availableLength
    ? `${details.slice(0, availableLength - 3).trimEnd()}...`
    : details;
  return [instruction, shortenedDetails].filter(Boolean).join(' ');
}

function csvSet(value?: string) {
  return new Set((value ?? '').split(',').map((item) => item.trim()).filter(Boolean));
}

function categorySet(value: string) {
  const categories = new Set<GarmentCategory>();
  for (const item of value.split(',')) {
    const key = item.trim().toUpperCase();
    if (key in GarmentCategory) categories.add(GarmentCategory[key as keyof typeof GarmentCategory]);
  }
  return categories.size > 0 ? categories : new Set([GarmentCategory.UPPER]);
}

function hashJson(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function utcDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function nextUtcReset() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isRetryableTransactionError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === 'P2034';
}

function isMissingLiveTryOnTableError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === 'P2021' || String(error.message).includes('live_try_on_sessions');
}
