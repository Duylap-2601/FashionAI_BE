import { NotFoundException } from '@nestjs/common';
import { NotificationService } from '../../src/modules/notification/notification.service';

describe('NotificationService', () => {
  let service: NotificationService;

  const mockPrisma = {
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const mockEmitter = {
    toUser: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationService(mockPrisma as any, mockEmitter as any);
  });

  describe('create', () => {
    it('ghi DB rồi emit tới đúng user (DB là nguồn sự thật)', async () => {
      const saved = { id: 'n1', userId: 'u1', type: 'SYSTEM' };
      mockPrisma.notification.create.mockResolvedValue(saved);

      const result = await service.create({
        userId: 'u1',
        type: 'SYSTEM' as any,
        title: 't',
        message: 'm',
      });

      expect(mockPrisma.notification.create).toHaveBeenCalled();
      expect(mockEmitter.toUser).toHaveBeenCalledWith('u1', 'notification', saved);
      expect(result).toBe(saved);
    });

    it('KHÔNG emit nếu ghi DB thất bại', async () => {
      mockPrisma.notification.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.create({ userId: 'u1', type: 'SYSTEM' as any, title: 't', message: 'm' }),
      ).rejects.toThrow('db down');
      expect(mockEmitter.toUser).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('trả items kèm meta có unread count', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([{ id: 'n1' }]);
      mockPrisma.notification.count
        .mockResolvedValueOnce(5) // total
        .mockResolvedValueOnce(2); // unread

      const result = await service.list('u1', 1, 20);

      expect(result.items).toHaveLength(1);
      expect(result.meta).toMatchObject({ total: 5, unread: 2, page: 1, limit: 20 });
    });

    it('giới hạn limit tối đa 100', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.notification.count.mockResolvedValue(0);

      const result = await service.list('u1', 1, 500);

      expect(result.meta.limit).toBe(100);
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });

  describe('markRead', () => {
    it('ném NotFound khi id không thuộc user (count=0)', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.markRead('u1', 'other-user-notif')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('đánh dấu đã đọc với guard userId', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.markRead('u1', 'n1');

      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'n1', userId: 'u1' },
        data: { isRead: true },
      });
      expect(result).toEqual({ id: 'n1', isRead: true });
    });
  });

  describe('markAllRead', () => {
    it('trả số lượng đã cập nhật', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.markAllRead('u1');

      expect(result).toEqual({ updated: 3 });
    });
  });
});
