import { HttpException, HttpStatus } from '@nestjs/common';
import { ChatGateway } from '../../src/modules/chat/chat.gateway';

describe('ChatGateway.handleSend', () => {
  let gateway: ChatGateway;

  const mockAuth = { authenticate: jest.fn() };
  const mockQuota = { assertQuota: jest.fn() };
  const mockRedis = { acquireLock: jest.fn(), releaseLock: jest.fn() };
  const mockChat = { streamChat: jest.fn() };

  const futureExp = Math.floor(Date.now() / 1000) + 3600;

  function socketWithUser(user: any) {
    return { id: 's1', data: { user }, emit: jest.fn(), disconnect: jest.fn() } as any;
  }

  async function* streamOf(events: any[]) {
    for (const e of events) yield e;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    gateway = new ChatGateway(
      mockAuth as any,
      mockQuota as any,
      mockRedis as any,
      mockChat as any,
    );
  });

  it('emit token rồi done khi stream thành công, và giải phóng lock', async () => {
    mockQuota.assertQuota.mockResolvedValue(undefined);
    mockRedis.acquireLock.mockResolvedValue(true);
    mockChat.streamChat.mockReturnValue(
      streamOf([
        { type: 'token', data: 'Xin' },
        { type: 'token', data: ' chào' },
        { type: 'done', data: { sessionId: 'sess-1' } },
      ]),
    );

    const socket = socketWithUser({ id: 'u1', tier: 'FREE', exp: futureExp });
    await gateway.handleSend(socket, { message: 'hi' } as any);

    expect(socket.emit).toHaveBeenCalledWith('chat:token', { data: 'Xin' });
    expect(socket.emit).toHaveBeenCalledWith('chat:token', { data: ' chào' });
    expect(socket.emit).toHaveBeenCalledWith('chat:done', { sessionId: 'sess-1' });
    expect(mockRedis.releaseLock).toHaveBeenCalledWith('ws:chat:lock:u1');
  });

  it('chặn và emit lỗi khi hết hạn mức, không stream', async () => {
    mockQuota.assertQuota.mockRejectedValue(
      new HttpException(
        { code: 'QUOTA_EXCEEDED', message: 'Hết lượt' },
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );

    const socket = socketWithUser({ id: 'u1', tier: 'FREE', exp: futureExp });
    await gateway.handleSend(socket, { message: 'hi' } as any);

    expect(socket.emit).toHaveBeenCalledWith('chat:error', {
      code: 'QUOTA_EXCEEDED',
      message: 'Hết lượt',
    });
    expect(mockChat.streamChat).not.toHaveBeenCalled();
    expect(mockRedis.acquireLock).not.toHaveBeenCalled();
  });

  it('emit BUSY khi không lấy được lock (đang có request khác)', async () => {
    mockQuota.assertQuota.mockResolvedValue(undefined);
    mockRedis.acquireLock.mockResolvedValue(false);

    const socket = socketWithUser({ id: 'u1', tier: 'FREE', exp: futureExp });
    await gateway.handleSend(socket, { message: 'hi' } as any);

    expect(socket.emit).toHaveBeenCalledWith(
      'chat:error',
      expect.objectContaining({ code: 'BUSY' }),
    );
    expect(mockChat.streamChat).not.toHaveBeenCalled();
  });

  it('chặn khi token đã hết hạn', async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 10;
    const socket = socketWithUser({ id: 'u1', tier: 'FREE', exp: pastExp });

    await gateway.handleSend(socket, { message: 'hi' } as any);

    expect(socket.emit).toHaveBeenCalledWith(
      'chat:error',
      expect.objectContaining({ code: 'TOKEN_EXPIRED' }),
    );
    expect(mockQuota.assertQuota).not.toHaveBeenCalled();
  });

  it('giải phóng lock kể cả khi stream ném lỗi giữa chừng', async () => {
    mockQuota.assertQuota.mockResolvedValue(undefined);
    mockRedis.acquireLock.mockResolvedValue(true);
    // eslint-disable-next-line require-yield
    async function* boom() {
      throw new HttpException({ code: 'X', message: 'Phiên chat không tồn tại' }, 400);
    }
    mockChat.streamChat.mockReturnValue(boom());

    const socket = socketWithUser({ id: 'u1', tier: 'FREE', exp: futureExp });
    await gateway.handleSend(socket, { message: 'hi', sessionId: 'x' } as any);

    expect(socket.emit).toHaveBeenCalledWith(
      'chat:error',
      expect.objectContaining({ message: 'Phiên chat không tồn tại' }),
    );
    expect(mockRedis.releaseLock).toHaveBeenCalledWith('ws:chat:lock:u1');
  });
});
