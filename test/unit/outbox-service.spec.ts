import { OUTBOX_EVENT_TYPE } from '../../src/modules/outbox/constants/outbox.constants';
import { OutboxService } from '../../src/modules/outbox/services/outbox.service';

// eventKey có dạng TYPE:aggregateId:ts; jobId cũ `outbox:${eventKey}` có 4 phần ":" nên
// BullMQ ném "Custom Id cannot contain :" và sự kiện sau thanh toán không vào hàng đợi.
const event = {
  id: '6f1c2a9e-1d2b-4c3d-9e8f-0a1b2c3d4e5f',
  eventKey: `${OUTBOX_EVENT_TYPE.PAYMENT_POST_SUCCESS}:order-1:1793698126252`,
  type: OUTBOX_EVENT_TYPE.PAYMENT_POST_SUCCESS,
  aggregateType: 'Order',
  aggregateId: 'order-1',
  payload: { orderId: 'order-1' },
};

function setup() {
  const prisma = { outboxEvent: { create: jest.fn().mockResolvedValue(event) } };
  const queue = { add: jest.fn().mockResolvedValue({}) };
  const service = new OutboxService(prisma as never, queue as never);
  return { service, prisma, queue };
}

describe('OutboxService jobId', () => {
  it('enqueueEvent đặt jobId theo id của event, không có dấu ":"', async () => {
    const { service, queue } = setup();
    await service.enqueueEvent({ type: OUTBOX_EVENT_TYPE.PAYMENT_POST_SUCCESS, aggregateType: 'Order', aggregateId: 'order-1' });

    const opts = queue.add.mock.calls[0][2];
    expect(opts.jobId).toBe(`outbox-${event.id}`);
    expect(opts.jobId).not.toContain(':');
    // Worker vẫn đọc eventKey từ data để cập nhật trạng thái OutboxEvent.
    expect(queue.add.mock.calls[0][1]).toEqual(expect.objectContaining({ eventKey: event.eventKey }));
  });

  it('createEvent trong transaction cũng không đặt jobId có dấu ":"', async () => {
    const { service, queue } = setup();
    const tx = { outboxEvent: { create: jest.fn().mockResolvedValue(event) } };
    await service.createEvent(tx, { type: OUTBOX_EVENT_TYPE.PAYMENT_POST_SUCCESS, aggregateType: 'Order', aggregateId: 'order-1' });

    expect(queue.add.mock.calls[0][2].jobId).toBe(`outbox-${event.id}`);
  });
});
