import { PushService } from '../../src/modules/notification/push.service';

const mockChunkPushNotifications = jest.fn();
const mockSendPushNotificationsAsync = jest.fn();

jest.mock('expo-server-sdk', () => ({
  Expo: Object.assign(
    jest.fn().mockImplementation(() => ({
      chunkPushNotifications: mockChunkPushNotifications,
      sendPushNotificationsAsync: mockSendPushNotificationsAsync,
    })),
    {
      isExpoPushToken: (token: unknown) =>
        typeof token === 'string' && /^(Exponent|Expo)PushToken\[/.test(token),
    },
  ),
}));

describe('PushService', () => {
  let service: PushService;

  const mockDeviceTokenService = {
    getTokensForUser: jest.fn(),
    removeByToken: jest.fn(),
  };

  const notification = {
    id: 'n1',
    type: 'ORDER_STATUS',
    title: 'Đơn hàng mới',
    message: 'Đơn #123 đã được tạo',
    data: { orderId: 'o1', orderCode: 123, type: 'NEW_ORDER' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDeviceTokenService.getTokensForUser.mockResolvedValue([]);
    mockDeviceTokenService.removeByToken.mockResolvedValue(undefined);
    mockChunkPushNotifications.mockImplementation((messages: unknown[]) => [
      messages,
    ]);
    mockSendPushNotificationsAsync.mockResolvedValue([]);
    service = new PushService(mockDeviceTokenService as any);
  });

  it('gửi push tới mọi token hợp lệ và chuẩn hoá data thành string', async () => {
    mockDeviceTokenService.getTokensForUser.mockResolvedValue([
      { token: 'ExponentPushToken[a]' },
      { token: 'ExponentPushToken[b]' },
    ]);
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: 'ok', id: 't1' },
      { status: 'ok', id: 't2' },
    ]);

    await service.sendToUser('u1', notification as any);

    expect(mockSendPushNotificationsAsync).toHaveBeenCalledTimes(1);
    const messages = mockSendPushNotificationsAsync.mock.calls[0][0];
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      to: 'ExponentPushToken[a]',
      title: 'Đơn hàng mới',
      body: 'Đơn #123 đã được tạo',
      channelId: 'default',
      data: {
        notificationId: 'n1',
        notificationType: 'ORDER_STATUS',
        orderId: 'o1',
        orderCode: '123',
        type: 'NEW_ORDER',
      },
    });
  });

  it('không cho data ghi đè notificationId/notificationType', async () => {
    mockDeviceTokenService.getTokensForUser.mockResolvedValue([
      { token: 'ExponentPushToken[a]' },
    ]);
    mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok', id: 't1' }]);

    await service.sendToUser('u1', {
      ...notification,
      data: {
        notificationId: 'forged',
        notificationType: 'FORGED',
        orderId: 'o1',
      },
    } as any);

    const messages = mockSendPushNotificationsAsync.mock.calls[0][0];
    expect(messages[0].data).toMatchObject({
      notificationId: 'n1',
      notificationType: 'ORDER_STATUS',
      orderId: 'o1',
    });
  });

  it('bỏ qua token không phải Expo push token', async () => {
    mockDeviceTokenService.getTokensForUser.mockResolvedValue([
      { token: 'not-an-expo-token' },
      { token: 'ExpoPushToken[ok]' },
    ]);
    mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok', id: 't1' }]);

    await service.sendToUser('u1', notification as any);

    const messages = mockSendPushNotificationsAsync.mock.calls[0][0];
    expect(messages).toHaveLength(1);
    expect(messages[0].to).toBe('ExpoPushToken[ok]');
  });

  it('xoá token khi Expo báo DeviceNotRegistered', async () => {
    mockDeviceTokenService.getTokensForUser.mockResolvedValue([
      { token: 'ExponentPushToken[dead]' },
    ]);
    mockSendPushNotificationsAsync.mockResolvedValue([
      {
        status: 'error',
        message: 'Device is not registered',
        details: { error: 'DeviceNotRegistered' },
      },
    ]);

    await service.sendToUser('u1', notification as any);

    expect(mockDeviceTokenService.removeByToken).toHaveBeenCalledWith(
      'ExponentPushToken[dead]',
    );
  });

  it('không ném lỗi khi gửi push thất bại (best-effort)', async () => {
    mockDeviceTokenService.getTokensForUser.mockResolvedValue([
      { token: 'ExponentPushToken[a]' },
    ]);
    mockSendPushNotificationsAsync.mockRejectedValue(new Error('network down'));

    await expect(
      service.sendToUser('u1', notification as any),
    ).resolves.toBeUndefined();
  });

  it('không gọi Expo khi user không có device token', async () => {
    await service.sendToUser('u1', notification as any);

    expect(mockChunkPushNotifications).not.toHaveBeenCalled();
    expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
  });
});
