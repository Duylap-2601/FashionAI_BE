import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../../database/prisma.service';
import { OUTBOX_QUEUE, OUTBOX_EVENT_TYPE } from '../constants/outbox.constants';
import { OutboxJobData } from '../types/outbox.types';
import { ShipmentService } from '../../shipping/shipment.service';

@Processor(OUTBOX_QUEUE)
export class OutboxProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboxProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shipmentService: ShipmentService,
  ) {
    super();
  }

  async process(job: Job<OutboxJobData>): Promise<void> {
    const { type, aggregateId, payload, eventKey } = job.data;
    this.logger.log(`Processing outbox: ${type} aggregate=${aggregateId}`);

    try {
      switch (type) {
        case OUTBOX_EVENT_TYPE.SHIPMENT_CREATE_REQUESTED:
          await this.handleShipmentCreate(payload!);
          break;
        case OUTBOX_EVENT_TYPE.SHIPMENT_CANCEL_REQUESTED:
          await this.handleShipmentCancel(payload!);
          break;
        case OUTBOX_EVENT_TYPE.PAYMENT_POST_SUCCESS:
          await this.handlePaymentPostSuccess(payload!);
          break;
        default:
          this.logger.warn(`Unknown outbox event type: ${type}`);
          return;
      }

      await this.prisma.outboxEvent.update({
        where: { eventKey },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
    } catch (error) {
      this.logger.error(`Outbox event failed: ${type} aggregate=${aggregateId}`, error);
      await this.prisma.outboxEvent.update({
        where: { eventKey },
        data: {
          status: 'FAILED_RETRYABLE',
          attemptCount: { increment: 1 },
          lastError: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  private async handleShipmentCreate(payload: Record<string, unknown>) {
    const orderId = payload.orderId as string;
    const orderCode = payload.orderCode as number | string | undefined;
    if (!orderId) throw new Error('Missing orderId in SHIPMENT_CREATE_REQUESTED');

    this.logger.log(`Shipment create job started | orderId=${orderId} | orderCode=${orderCode ?? 'unknown'}`);

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new Error(`Order ${orderId} not found`);
    if (order.status !== 'CONFIRMED') {
      this.logger.warn(`Shipment create job skipped | orderId=${orderId} | orderCode=${order.orderCode} | status=${order.status}`);
      return;
    }

    const shipment = await this.shipmentService.createShipmentFromOrder(order);
    this.logger.log(`Shipment create job completed | orderId=${orderId} | orderCode=${order.orderCode} | shipmentId=${shipment.id} | providerOrderCode=${shipment.providerOrderCode ?? 'none'}`);
  }

  private async handleShipmentCancel(payload: Record<string, unknown>) {
    const shipmentId = payload.shipmentId as string;
    if (!shipmentId) throw new Error('Missing shipmentId in SHIPMENT_CANCEL_REQUESTED');

    await this.shipmentService.cancelShipmentById(shipmentId);
  }

  private async handlePaymentPostSuccess(payload: Record<string, unknown>) {
    const orderId = payload.orderId as string;
    this.logger.log(`Payment post-success for order ${orderId} (no-op for now)`);
  }
}
