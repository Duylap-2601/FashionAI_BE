import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../database/prisma.service';
import { OUTBOX_QUEUE, OutboxEventType } from '../constants/outbox.constants';
import { OutboxJobData } from '../types/outbox.types';

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(OUTBOX_QUEUE) private readonly outboxQueue: Queue<OutboxJobData>,
  ) {}

  /**
   * Create an outbox event in the same DB transaction as the state change.
   * The worker will pick it up and process it asynchronously.
   */
  async createEvent(
    tx: { outboxEvent: { create: (args: any) => Promise<any> } },
    params: {
      type: OutboxEventType;
      aggregateType: string;
      aggregateId: string;
      payload?: Record<string, unknown>;
    },
  ) {
    const eventKey = `${params.type}:${params.aggregateId}:${Date.now()}`;
    const event = await tx.outboxEvent.create({
      data: {
        eventKey,
        type: params.type,
        aggregateType: params.aggregateType,
        aggregateId: params.aggregateId,
        payload: params.payload as any,
        status: 'PENDING',
      },
    });

    await this.outboxQueue.add(
      event.type,
      {
        eventKey: event.eventKey,
        type: event.type as OutboxEventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: (event.payload as Record<string, unknown>) ?? undefined,
      },
      {
        jobId: `outbox:${event.eventKey}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 500,
        removeOnFail: 200,
      },
    );

    this.logger.log(`Outbox event created: ${event.type} for ${event.aggregateType}:${event.aggregateId}`);
    return event;
  }

  /**
   * Enqueue an outbox event outside a transaction (for use in webhook handlers
   * where the DB state has already been committed).
   */
  async enqueueEvent(params: {
    type: OutboxEventType;
    aggregateType: string;
    aggregateId: string;
    payload?: Record<string, unknown>;
  }) {
    const event = await this.prisma.outboxEvent.create({
      data: {
        eventKey: `${params.type}:${params.aggregateId}:${Date.now()}`,
        type: params.type,
        aggregateType: params.aggregateType,
        aggregateId: params.aggregateId,
        payload: params.payload as any,
        status: 'PENDING',
      },
    });

    await this.outboxQueue.add(
      event.type,
      {
        eventKey: event.eventKey,
        type: event.type as OutboxEventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: (event.payload as Record<string, unknown>) ?? undefined,
      },
      {
        jobId: `outbox:${event.eventKey}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 500,
        removeOnFail: 200,
      },
    );

    this.logger.log(`Outbox job enqueued: ${event.type} eventKey=${event.eventKey} aggregate=${event.aggregateType}:${event.aggregateId}`);
    return event;
  }
}
