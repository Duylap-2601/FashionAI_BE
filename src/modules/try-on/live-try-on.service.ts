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
  LayerRole,
  LiveTryOnCredentialStatus,
  LiveTryOnReservationStatus,
  LiveTryOnSessionStatus,
  Prisma,
  Product,
  ProductImage,
  ProductStatus,
  UserTier,
} from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { resolveLayerRole } from '../products/utils/layer-role.util';
import { AdminSettingsService } from '../admin/admin-settings.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CreateLiveSessionDto, LiveSessionItemDto } from './dto/create-live-session.dto';
import { DecartRealtimeService } from './decart-realtime.service';
import { nextQuotaReset, quotaDateKey } from '../../common/utils/quota-date.util';
import { buildCleanGarmentImageUrl } from './utils/garment-image.util';
import { assertValidLayerCombination } from './utils/garment-combo.util';
import { buildLiveComboPrompt, pickPrimaryIndex } from './utils/live-combo.util';

interface LiveTryOnPolicy {
  enabled: boolean;
  transport: 'direct';
  disabledReason?: string;
  maxDurationSeconds: number;
  tokenTtlSeconds: number;
  graceSeconds: number;
  userDailySeconds: number;
  globalDailySeconds: number;
  maxConcurrentSessions: number;
  rateCreditsPerSecond: number;
  policyVersion: string;
  allowedCategories: Set<GarmentCategory>;
  pauseTimeoutSeconds: number;
  tier: UserTier;
}

type LiveProduct = Product & { images?: ProductImage[] };

interface LiveGarmentReference {
  product: LiveProduct;
  imageUrl: string;
  color: string | null;
}

/**
 * Một combo Live Try-On. Decart chỉ nhận 1 ảnh tham chiếu mỗi phiên nên
 * `primaryIndex` trỏ tới món cấp ảnh; các món còn lại chỉ nằm trong prompt.
 */
interface LiveComboReference {
  items: LiveGarmentReference[];
  primaryIndex: number;
}

/** Include dùng chung cho mọi lượt đọc session cần trả về garment. */
const LIVE_SESSION_GARMENT_INCLUDE = {
  product: { include: { images: true } },
  items: { include: { product: { include: { images: true } } } },
} as const;

interface LiveSessionWithGarments {
  id: string;
  status: LiveTryOnSessionStatus;
  reservedSeconds: number;
  usedSeconds: number;
  activeStartedAt: Date | null;
  blockedUntil: Date;
  pauseExpiresAt: Date | null;
  revision: number;
  colorName: string | null;
  product: LiveProduct;
  providerMetadata?: Prisma.JsonValue | null;
  items?: {
    productId: string;
    imageUrl: string;
    colorName: string | null;
    isPrimary: boolean;
    position: number;
    product: LiveProduct;
  }[];
}

@Injectable()
export class LiveTryOnService {
  private readonly logger = new Logger(LiveTryOnService.name);
  private missingMigrationLogged = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly decart: DecartRealtimeService,
    private readonly adminSettings: AdminSettingsService,
  ) {}

  async getQuota(user: AuthenticatedUser) {
    const policy = await this.getPolicy(user.tier);
    const eligibility = this.getEligibility(user, policy);
    const quotaDate = quotaDateKey(new Date());
    const budget = await this.prisma.liveTryOnBudget.findUnique({
      where: { scopeKey_date: { scopeKey: `user:${user.id}`, date: quotaDate } },
    });
    const activeLease = await this.prisma.liveTryOnLease.findUnique({ where: { userId: user.id } });
    const activeSession = activeLease && activeLease.expiresAt > new Date()
      ? await this.prisma.liveTryOnSession.findUnique({
          where: { id: activeLease.sessionId },
          include: { items: { orderBy: { position: 'asc' } } },
        })
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
      resetAt: nextQuotaReset().toISOString(),
      maxDurationSeconds: policy.maxDurationSeconds,
      activeSession: activeSession
        ? {
            sessionId: activeSession.id,
            productId: activeSession.productId,
            productIds: activeSession.items.length
              ? activeSession.items.map((item) => item.productId)
              : [activeSession.productId],
            status: activeSession.status,
            blockedUntil: activeSession.blockedUntil.toISOString(),
            remainingSeconds: this.computeRemainingSeconds(activeSession, new Date()),
          }
        : null,
    };
  }

  async getGarment(user: AuthenticatedUser, productId: string, color?: string) {
    const policy = await this.getPolicy(user.tier);
    this.assertEnabledAndEligible(user, policy);
    if (!isUuid(productId)) {
      throw new BadRequestException({ code: 'INVALID_PRODUCT_ID', message: 'productId must be a UUID' });
    }
    const product = await this.resolveLiveProduct(productId, policy);
    const garment = this.resolveLiveGarment(product, color);
    await this.assertGarmentUrlReadable(garment.imageUrl);
    return this.mapGarment({ items: [garment], primaryIndex: 0 });
  }

  /**
   * Preview combo trước khi mở phiên: FE gọi để biết ảnh tham chiếu nào sẽ được
   * dùng và prompt nào sẽ gửi, không tiêu quota.
   */
  async previewCombo(user: AuthenticatedUser, dto: CreateLiveSessionDto) {
    const policy = await this.getPolicy(user.tier);
    this.assertEnabledAndEligible(user, policy);
    const combo = await this.resolveLiveCombo(normalizeRequestedItems(dto), policy);
    return this.mapGarment(combo);
  }

  async createSession(user: AuthenticatedUser, dto: CreateLiveSessionDto, idempotencyKey: string, origin?: string) {
    const policy = await this.getPolicy(user.tier);
    this.assertEnabledAndEligible(user, policy);
    if (!idempotencyKey || !isUuid(idempotencyKey)) {
      throw new BadRequestException({ code: 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key must be a UUID' });
    }
    const requested = normalizeRequestedItems(dto);
    const bodyHash = hashJson({
      items: requested.map((item) => ({
        productId: item.productId,
        color: normalizeColorName(item.color) || null,
      })),
    });
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

    const combo = await this.resolveLiveCombo(requested, policy);
    const primary = combo.items[combo.primaryIndex];
    const now = new Date();
    const quotaDate = quotaDateKey(now);
    const blockedUntil = new Date(now.getTime() + (policy.tokenTtlSeconds + policy.maxDurationSeconds + policy.graceSeconds + policy.pauseTimeoutSeconds) * 1000);

    const session = await this.reserveSession(user.id, primary.product.id, idempotencyKey, bodyHash, quotaDate, blockedUntil, policy, primary.color, combo);

    try {
      const token = await this.decart.createClientToken({ origin, maxDurationSeconds: session.reservedSeconds });
      await this.prisma.liveTryOnSession.update({
        where: { id: session.id },
        data: {
          credentialStatus: LiveTryOnCredentialStatus.ISSUED,
          issuedAt: now,
          tokenExpiresAt: token.tokenExpiresAt,
          activeStartedAt: now,
          providerMetadata: this.buildProviderMetadata(token.raw, combo),
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
        maxDurationSeconds: session.reservedSeconds,
        remainingSeconds: session.reservedSeconds,
        status: LiveTryOnSessionStatus.ACTIVE,
        revision: session.revision,
        garment: this.mapGarment(combo),
      };
    } catch (error) {
      await this.releaseFailedReservation(session.id, user.id, quotaDate, session.reservedSeconds);
      throw error;
    }
  }

  async getSession(user: AuthenticatedUser, sessionId: string) {
    const session = await this.prisma.liveTryOnSession.findUnique({ where: { id: sessionId }, include: LIVE_SESSION_GARMENT_INCLUDE });
    if (!session || session.userId !== user.id) {
      throw new NotFoundException({ code: 'LIVE_SESSION_NOT_FOUND', message: 'Live Try-On session not found' });
    }
    return this.mapSessionStatus(session);
  }

  async pauseSession(user: AuthenticatedUser, sessionId: string, reason?: string) {
    const session = await this.prisma.liveTryOnSession.findUnique({ where: { id: sessionId }, include: LIVE_SESSION_GARMENT_INCLUDE });
    if (!session || session.userId !== user.id) {
      throw new NotFoundException({ code: 'LIVE_SESSION_NOT_FOUND', message: 'Live Try-On session not found' });
    }
    if (session.status !== LiveTryOnSessionStatus.ACTIVE) return this.mapSessionStatus(session);

    const policy = await this.getPolicy(user.tier);
    const now = new Date();
    const usedSeconds = this.computeUsedSeconds(session, now);
    const updated = await this.prisma.liveTryOnSession.update({
      where: { id: session.id },
      data: {
        status: LiveTryOnSessionStatus.PAUSED,
        usedSeconds,
        activeStartedAt: null,
        pausedAt: now,
        pauseExpiresAt: new Date(now.getTime() + policy.pauseTimeoutSeconds * 1000),
        revision: { increment: 1 },
        endedReason: reason ?? session.endedReason,
      },
      include: LIVE_SESSION_GARMENT_INCLUDE,
    });
    return this.mapSessionStatus(updated);
  }

  async resumeSession(user: AuthenticatedUser, sessionId: string, origin?: string, productId?: string, color?: string) {
    const session = await this.prisma.liveTryOnSession.findUnique({ where: { id: sessionId }, include: LIVE_SESSION_GARMENT_INCLUDE });
    if (!session || session.userId !== user.id) {
      throw new NotFoundException({ code: 'LIVE_SESSION_NOT_FOUND', message: 'Live Try-On session not found' });
    }
    const policy = await this.getPolicy(user.tier);
    this.assertEnabledAndEligible(user, policy);
    if (session.status !== LiveTryOnSessionStatus.PAUSED) {
      throw new ConflictException({ code: 'LIVE_SESSION_NOT_PAUSED', message: 'Live session is not paused' });
    }
    if (session.pauseExpiresAt && session.pauseExpiresAt.getTime() <= Date.now()) {
      throw new ConflictException({ code: 'LIVE_PAUSE_EXPIRED', message: 'Paused Live session expired' });
    }

    const remainingSeconds = this.computeRemainingSeconds(session, new Date());
    if (remainingSeconds <= 0) {
      throw new ConflictException({ code: 'LIVE_SESSION_EXHAUSTED', message: 'Live session has no remaining seconds' });
    }

    // Resume: nếu client gửi productId thì coi là đổi sang 1 món mới, ngược lại
    // dựng lại đúng combo đã lưu của phiên.
    const combo = productId
      ? await this.resolveLiveCombo([{ productId, color }], policy)
      : await this.reResolveCombo(session, policy);
    const primary = combo.items[combo.primaryIndex];
    const token = await this.decart.createClientToken({ origin, maxDurationSeconds: remainingSeconds });
    const now = new Date();
    const updated = await this.prisma.liveTryOnSession.update({
      where: { id: session.id },
      data: {
        status: LiveTryOnSessionStatus.ACTIVE,
        credentialStatus: LiveTryOnCredentialStatus.ISSUED,
        issuedAt: now,
        tokenExpiresAt: token.tokenExpiresAt,
        activeStartedAt: now,
        pausedAt: null,
        productId: primary.product.id,
        colorName: primary.color,
        revision: { increment: 1 },
        providerMetadata: this.buildProviderMetadata(token.raw, combo),
        ...(productId
          ? {
              // Đổi món khi resume: thay toàn bộ items bằng món mới.
              items: {
                deleteMany: {},
                create: this.buildSessionItemsData(combo),
              },
            }
          : {}),
      },
      include: LIVE_SESSION_GARMENT_INCLUDE,
    });

    return {
      ...this.mapSessionStatus(updated),
      transport: policy.transport,
      connection: {
        clientToken: token.clientToken,
        tokenExpiresAt: token.tokenExpiresAt.toISOString(),
      },
      model: updated.model,
      maxDurationSeconds: remainingSeconds,
      garment: this.mapGarment(combo),
    };
  }

  async endSession(user: AuthenticatedUser, sessionId: string, reason?: string) {
    const session = await this.prisma.liveTryOnSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== user.id) {
      throw new NotFoundException({ code: 'LIVE_SESSION_NOT_FOUND', message: 'Live Try-On session not found' });
    }

    const now = new Date();
    const usedSeconds = this.computeUsedSeconds(session, now);
    const blockedUntil = now;

    const updated = await this.prisma.liveTryOnSession.update({
      where: { id: session.id },
      data: {
        status: LiveTryOnSessionStatus.ENDED,
        reservationStatus: LiveTryOnReservationStatus.ALLOCATED,
        usedSeconds,
        allocatedSeconds: usedSeconds,
        activeStartedAt: null,
        clientEndedAt: session.clientEndedAt ?? now,
        endedReason: session.endedReason ?? reason ?? 'client_end',
        blockedUntil,
        revision: { increment: 1 },
      },
    });

    if (session.reservationStatus === LiveTryOnReservationStatus.RESERVED) {
      await this.prisma.$transaction(async (tx) => {
        await tx.liveTryOnBudget.update({
          where: { scopeKey_date: { scopeKey: `user:${user.id}`, date: session.quotaDate } },
          data: {
            reservedSeconds: { decrement: session.reservedSeconds },
            allocatedSeconds: { increment: usedSeconds },
          },
        });
        await tx.liveTryOnBudget.updateMany({
          where: { scopeKey: 'global', date: session.quotaDate },
          data: {
            reservedSeconds: { decrement: session.reservedSeconds },
            allocatedSeconds: { increment: usedSeconds },
          },
        });
        await tx.liveTryOnLease.deleteMany({ where: { userId: user.id, sessionId: session.id } });
      });
    }

    return {
      sessionId: updated.id,
      status: updated.status,
      blockedUntil: updated.blockedUntil.toISOString(),
      remainingSeconds: Math.max(0, updated.reservedSeconds - usedSeconds),
      revision: updated.revision,
    };
  }

  private mapSessionStatus(session: LiveSessionWithGarments) {
    const now = new Date();
    return {
      sessionId: session.id,
      status: session.status,
      remainingSeconds: this.computeRemainingSeconds(session, now),
      serverNow: now.toISOString(),
      activeStartedAt: session.activeStartedAt?.toISOString() ?? null,
      blockedUntil: session.blockedUntil.toISOString(),
      pauseExpiresAt: session.pauseExpiresAt?.toISOString() ?? null,
      revision: session.revision,
      garment: this.mapGarment(this.comboFromSession(session)),
    };
  }

  /**
   * Dựng lại combo từ DB. Phiên cũ (trước migration) không có `items` nên fall
   * back về 1 món từ `productId` + providerMetadata.
   */
  private comboFromSession(session: LiveSessionWithGarments): LiveComboReference {
    const persisted = sessionItems(session);
    if (persisted.length === 0) {
      return {
        items: [this.garmentFromSession(session.product, session.colorName, session.providerMetadata)],
        primaryIndex: 0,
      };
    }

    const sorted = [...persisted].sort((a, b) => a.position - b.position);
    const items = sorted.map((item) => ({
      product: item.product,
      imageUrl: item.imageUrl,
      color: item.colorName,
    }));
    const primaryIndex = Math.max(0, sorted.findIndex((item) => item.isPrimary));
    return { items, primaryIndex };
  }

  private computeUsedSeconds(session: { reservedSeconds: number; usedSeconds: number; activeStartedAt: Date | null }, now: Date) {
    const activeSeconds = session.activeStartedAt ? Math.max(0, Math.ceil((now.getTime() - session.activeStartedAt.getTime()) / 1000)) : 0;
    return Math.min(session.reservedSeconds, session.usedSeconds + activeSeconds);
  }

  private computeRemainingSeconds(session: { reservedSeconds: number; usedSeconds: number; activeStartedAt: Date | null }, now: Date) {
    return Math.max(0, session.reservedSeconds - this.computeUsedSeconds(session, now));
  }

  private async settleSessionUsage(tx: Prisma.TransactionClient, session: { userId: string; id: string; quotaDate: string; reservedSeconds: number; usedSeconds: number; activeStartedAt: Date | null }) {
    const allocatedSeconds = this.computeUsedSeconds(session, new Date());
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
    return allocatedSeconds;
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'live-try-on-session-reconcile' })
  async reconcileExpiredSessions() {
    if (!(await this.getPolicy()).enabled) return;

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
    colorName: string | null = null,
    combo?: LiveComboReference,
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
      colorName,
      combo,
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
    colorName: string | null = null,
    combo?: LiveComboReference,
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
      if (remaining <= 0) {
        throw new ForbiddenException({ code: 'LIVE_QUOTA_EXCEEDED', message: 'Live Try-On quota exceeded', remaining });
      }

      const globalScopeKey = 'global';
      const globalLimitSeconds = policy.globalDailySeconds;
      const globalBudget = await tx.liveTryOnBudget.upsert({
        where: { scopeKey_date: { scopeKey: globalScopeKey, date: quotaDate } },
        create: { scopeKey: globalScopeKey, date: quotaDate, limitSeconds: globalLimitSeconds },
        update: {},
      });
      const globalRemaining = globalLimitSeconds - globalBudget.reservedSeconds - globalBudget.allocatedSeconds;
      if (globalRemaining <= 0) {
        throw new ForbiddenException({ code: 'LIVE_GLOBAL_BUDGET_EXCEEDED', message: 'Live Try-On global budget exceeded', remaining: globalRemaining });
      }
      const sessionBudgetSeconds = Math.min(policy.maxDurationSeconds, remaining, globalRemaining);
      const minSessionSeconds = Number(this.config.get<string>('DECART_LIVE_MIN_SESSION_SECONDS') ?? '5');
      if (sessionBudgetSeconds < minSessionSeconds) {
        throw new ForbiddenException({ code: 'LIVE_SESSION_BUDGET_TOO_LOW', message: 'Live Try-On remaining seconds are below the minimum session duration', remaining: sessionBudgetSeconds });
      }

      const session = await tx.liveTryOnSession.create({
        data: {
          userId,
          productId,
          model: this.decart.model,
          transport: policy.transport,
          tier: policy.tier,
          idempotencyKey,
          idempotencyBodyHash: bodyHash,
          colorName,
          quotaDate,
          reservedSeconds: sessionBudgetSeconds,
          policyVersion: policy.policyVersion,
          rateCreditsPerSecond: policy.rateCreditsPerSecond,
          blockedUntil,
          // Lưu từng món trong cùng transaction với reservation.
          ...(combo ? { items: { create: this.buildSessionItemsData(combo) } } : {}),
        },
      });

      await tx.liveTryOnBudget.update({
        where: { id: budget.id },
        data: { reservedSeconds: { increment: sessionBudgetSeconds } },
      });
      await tx.liveTryOnBudget.update({
        where: { id: globalBudget.id },
        data: { reservedSeconds: { increment: sessionBudgetSeconds } },
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

      const allocatedSeconds = await this.settleSessionUsage(tx, session);
      await tx.liveTryOnSession.update({
        where: { id: session.id },
        data: {
          status: session.status === LiveTryOnSessionStatus.ACTIVE ? LiveTryOnSessionStatus.EXPIRED : session.status,
          credentialStatus: session.credentialStatus === LiveTryOnCredentialStatus.ISSUING
            ? LiveTryOnCredentialStatus.ISSUE_UNKNOWN
            : session.credentialStatus,
          reservationStatus: LiveTryOnReservationStatus.ALLOCATED,
          allocatedSeconds,
          usedSeconds: allocatedSeconds,
          activeStartedAt: null,
        },
      });
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

  private async resolveLiveProduct(productId: string, policy: LiveTryOnPolicy): Promise<LiveProduct> {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, include: { images: true } });
    if (!product) {
      throw new NotFoundException({ code: 'LIVE_GARMENT_NOT_FOUND', message: 'Product not found' });
    }
    if (product.status !== ProductStatus.ACTIVE || !product.garmentUrl) {
      throw new BadRequestException({ code: 'LIVE_GARMENT_UNAVAILABLE', message: 'Product is not available for Live Try-On' });
    }
    if (!policy.allowedCategories.has(product.category)) {
      throw new BadRequestException({ code: 'LIVE_GARMENT_CATEGORY_UNSUPPORTED', message: 'Product category is not enabled for Live Try-On' });
    }
    return product;
  }

  private resolveLiveGarment(product: LiveProduct, requestedColor?: string | null): LiveGarmentReference {
    const colors = parseProductColors(product.colors);
    const normalizedRequestedColor = normalizeColorName(requestedColor);
    if (normalizedRequestedColor && colors.length > 0 && !colors.some(color => normalizeColorName(color) === normalizedRequestedColor)) {
      throw new BadRequestException({ code: 'LIVE_GARMENT_COLOR_INVALID', message: 'Selected color is not available for this product' });
    }
    if (normalizedRequestedColor && colors.length === 0) {
      throw new BadRequestException({ code: 'LIVE_GARMENT_COLOR_INVALID', message: 'Product has no valid colors for the selected color' });
    }

    const color = normalizedRequestedColor
      ? colors.find(item => normalizeColorName(item) === normalizedRequestedColor) ?? null
      : colors[0] ?? product.color ?? null;
    const normalizedColor = normalizeColorName(color);
    const colorImage = normalizedColor
      ? product.images?.find(image => normalizeColorName(image.colorName) === normalizedColor)
      : undefined;
    const genericImage = product.images?.find(image => image.colorName == null);
    const rawImageUrl = colorImage?.imageUrl || genericImage?.imageUrl || product.garmentUrl;
    return {
      product,
      // Chuẩn hoá về khung vuông nền trắng: Decart coi ảnh tham chiếu là source
      // of truth nên ảnh catalog còn người mẫu/phông sẽ bị tái tạo theo.
      imageUrl: buildCleanGarmentImageUrl(rawImageUrl),
      color,
    };
  }

  /**
   * Resolve cả combo: validate luật ghép lớp, lấy ảnh đã chuẩn hoá cho từng món
   * và chọn món cấp ảnh tham chiếu cho Decart.
   */
  private async resolveLiveCombo(
    requested: LiveSessionItemDto[],
    policy: LiveTryOnPolicy,
  ): Promise<LiveComboReference> {
    const items: LiveGarmentReference[] = [];
    for (const item of requested) {
      if (!isUuid(item.productId)) {
        throw new BadRequestException({ code: 'INVALID_PRODUCT_ID', message: 'productId must be a UUID' });
      }
      const product = await this.resolveLiveProduct(item.productId, policy);
      items.push(this.resolveLiveGarment(product, item.color));
    }

    assertValidLayerCombination(items.map((item) => resolveLayerRole(item.product)));

    const primaryIndex = pickPrimaryIndex(items.map((item) => resolveLayerRole(item.product)));
    await this.assertGarmentUrlReadable(items[primaryIndex].imageUrl);
    return { items, primaryIndex };
  }

  /**
   * Resume phiên cũ: resolve lại từ DB để ảnh/màu phản ánh catalog hiện tại
   * (sản phẩm có thể đã bị gỡ hoặc đổi ảnh trong lúc phiên đang pause).
   */
  private async reResolveCombo(session: LiveSessionWithGarments, policy: LiveTryOnPolicy) {
    const persisted = sessionItems(session);
    const requested: LiveSessionItemDto[] = persisted.length
      ? [...persisted]
          .sort((a, b) => a.position - b.position)
          .map((item) => ({ productId: item.productId, color: item.colorName ?? undefined }))
      : [{ productId: session.product.id, color: session.colorName ?? undefined }];
    return this.resolveLiveCombo(requested, policy);
  }

  private buildSessionItemsData(combo: LiveComboReference) {
    return combo.items.map((item, index) => ({
      productId: item.product.id,
      layerRole: resolveLayerRole(item.product),
      colorName: item.color,
      imageUrl: item.imageUrl,
      isPrimary: index === combo.primaryIndex,
      position: index,
    }));
  }

  private garmentFromSession(product: LiveProduct, colorName: string | null, providerMetadata?: Prisma.JsonValue | null): LiveGarmentReference {
    const garment = readGarmentMetadata(providerMetadata);
    if (garment?.imageUrl) {
      return {
        product,
        imageUrl: garment.imageUrl,
        color: garment.color ?? colorName ?? product.color ?? null,
      };
    }
    const fallback = this.resolveLiveGarment(product, colorName);
    return {
      product,
      imageUrl: fallback.imageUrl,
      color: fallback.color ?? product.color ?? null,
    };
  }

  /**
   * Shape trả về cho client: giữ nguyên các field cũ (ứng với món primary) và
   * thêm `items` để FE hiển thị cả combo.
   */
  private mapGarment(combo: LiveComboReference) {
    const primary = combo.items[combo.primaryIndex];
    const isCombo = combo.items.length > 1;
    const prompt = isCombo
      ? buildLiveComboPrompt(
          combo.items.map((item) => ({
            layerRole: resolveLayerRole(item.product),
            name: item.product.name,
            color: item.color,
            material: item.product.material,
          })),
        )
      : buildPrompt(primary.product, primary.color);

    return {
      productId: primary.product.id,
      imageUrl: primary.imageUrl,
      prompt,
      category: primary.product.category,
      layerRole: resolveLayerRole(primary.product),
      color: primary.color,
      items: combo.items.map((item, index) => ({
        productId: item.product.id,
        name: item.product.name,
        imageUrl: item.imageUrl,
        layerRole: resolveLayerRole(item.product),
        category: item.product.category,
        color: item.color,
        isPrimary: index === combo.primaryIndex,
      })),
    };
  }

  private buildProviderMetadata(raw: unknown, combo: LiveComboReference): Prisma.InputJsonValue {
    const primary = combo.items[combo.primaryIndex];
    return {
      decart: raw ?? null,
      garment: {
        imageUrl: primary.imageUrl,
        color: primary.color,
      },
    } as Prisma.InputJsonValue;
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
    if (user.tierExpiresAt && user.tierExpiresAt.getTime() < Date.now()) return { eligible: false, disabledReason: 'subscription_expired' };
    return { eligible: true };
  }

  private async getPolicy(tier: UserTier = UserTier.MEMBER): Promise<LiveTryOnPolicy> {
    const settings = await this.adminSettings.getLiveTryOnSettings();
    const tierPolicy = settings.tiers[tier] ?? settings.tiers.FREE;
    const enabled = settings.enabled && tierPolicy.liveEnabled;
    return {
      enabled,
      transport: 'direct',
      disabledReason: enabled ? undefined : settings.enabled ? 'tier_not_allowed' : 'feature_disabled',
      maxDurationSeconds: tierPolicy.maxSessionSeconds,
      tokenTtlSeconds: this.decart.getTokenTtlSeconds(),
      graceSeconds: Number(this.config.get<string>('DECART_LIVE_GRACE_SECONDS') ?? '30'),
      userDailySeconds: tierPolicy.dailySeconds,
      globalDailySeconds: settings.globalDailySeconds,
      maxConcurrentSessions: settings.maxConcurrentSessions,
      rateCreditsPerSecond: Number(this.config.get<string>('DECART_LIVE_RATE_CREDITS_PER_SECOND') ?? '2'),
      policyVersion: `live-v${settings.version}`,
      allowedCategories: new Set(settings.allowedCategories),
      pauseTimeoutSeconds: settings.pauseTimeoutSeconds,
      tier,
    };
  }
}

// Decart chỉ nhận prompt text, nên lớp mặc phải nói rõ bằng lời; thiếu nó thì
// provider không biết blazer phải khoác ngoài hay áo sơ mi mặc bên trong.
const LAYER_PROMPT_HINTS: Record<LayerRole, string> = {
  [LayerRole.OUTER]: 'Wear it as an outer layer, open over the existing top.',
  [LayerRole.INNER]: 'Wear it as the top layer on the torso.',
  [LayerRole.BOTTOM]: 'Wear it on the lower body, keeping the existing top.',
  [LayerRole.FULL_BODY]: 'Wear it as a single full-body garment.',
};

function buildPrompt(product: Product, selectedColor?: string | null) {
  // Leave room below the provider's reported prompt limit.
  const maxPromptLength = 700;
  const instruction = 'Try on the reference garment. Match its color, pattern, fabric and fit.';
  const layerHint = LAYER_PROMPT_HINTS[resolveLayerRole(product)];
  const details = [selectedColor ?? product.color, product.material, product.name, product.description]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const availableLength = maxPromptLength - instruction.length - layerHint.length - 2;
  const shortenedDetails = details.length > availableLength
    ? `${details.slice(0, availableLength - 3).trimEnd()}...`
    : details;
  return [instruction, layerHint, shortenedDetails].filter(Boolean).join(' ');
}

/**
 * Chuẩn hoá input về danh sách món. Client cũ gửi `productId`/`color` phẳng,
 * client mới gửi `items`. Gửi `items` thì bỏ qua field phẳng.
 */
function normalizeRequestedItems(dto: CreateLiveSessionDto): LiveSessionItemDto[] {
  if (dto.items?.length) return dto.items;
  if (dto.productId) return [{ productId: dto.productId, color: dto.color }];
  throw new BadRequestException({
    code: 'LIVE_ITEMS_REQUIRED',
    message: 'Provide either productId or a non-empty items array',
  });
}

type PersistedSessionItem = NonNullable<LiveSessionWithGarments['items']>[number];

/**
 * Chỉ nhận item đã load đủ product. Phiên tạo trước migration không có items,
 * và một số lượt update không include quan hệ này.
 */
function sessionItems(session: LiveSessionWithGarments): PersistedSessionItem[] {
  if (!Array.isArray(session.items)) return [];
  return session.items.filter((item) => item?.product?.id);
}

function normalizeColorName(color?: string | null) {
  return color?.trim().toLowerCase() || '';
}

function parseProductColors(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object' && 'name' in item) {
        const name = (item as { name?: unknown }).name;
        return typeof name === 'string' ? name.trim() : '';
      }
      return '';
    })
    .filter((item): item is string => Boolean(item));
}

function readGarmentMetadata(value: Prisma.JsonValue | null | undefined): { imageUrl?: string; color?: string | null } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const garment = (value as { garment?: unknown }).garment;
  if (!garment || typeof garment !== 'object' || Array.isArray(garment)) return null;
  const record = garment as { imageUrl?: unknown; color?: unknown };
  return {
    imageUrl: typeof record.imageUrl === 'string' ? record.imageUrl : undefined,
    color: typeof record.color === 'string' ? record.color : null,
  };
}

function hashJson(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
