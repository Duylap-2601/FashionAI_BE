import { ConfigService } from '@nestjs/config';
import { ChatService } from '../../src/modules/chat/chat.service';
import { PrismaService } from '../../src/database/prisma.service';
import { QuotaService } from '../../src/common/services/quota.service';
import { ProductSuggestionService } from '../../src/modules/products/product-suggestion.service';

const createCompletion = jest.fn();
jest.mock('openai', () =>
  jest.fn().mockImplementation(() => ({ chat: { completions: { create: createCompletion } } })),
);

describe('ChatService', () => {
  let service: ChatService;
  let prisma: any;
  let quota: any;

  const catalogRows = [
    { id: 'shirt-1', name: 'Áo Sơ Mi Trắng', category: 'UPPER', garmentType: 'SHIRT', color: 'Trắng', colors: [{ name: 'Trắng' }], material: null, price: '550000' },
    { id: 'skirt-1', name: 'Chân Váy Be', category: 'LOWER', garmentType: 'SKIRT', color: 'Be', colors: [{ name: 'Be' }], material: null, price: '550000' },
    { id: 'dress-1', name: 'Đầm Đen', category: 'FULL_BODY', garmentType: 'DRESS', color: 'Đen', colors: [], material: null, price: '750000' },
  ];
  const productRows = catalogRows.map((row) => ({ ...row, garmentUrl: `https://cdn/${row.id}.png`, images: [], status: 'ACTIVE' }));

  async function* streamOf(chunks: string[]) {
    for (const content of chunks) yield { choices: [{ delta: { content } }] };
    yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
  }

  async function collect(gen: AsyncGenerator<any>) {
    const events: any[] = [];
    for await (const event of gen) events.push(event);
    return events;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      chatSession: {
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'sess-1', title: 'Tư vấn' }),
        update: jest.fn(),
      },
      chatMessage: {
        create: jest.fn(({ data }: any) => Promise.resolve({ id: data.role === 'user' ? 'msg-user' : 'msg-ai', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
      },
      product: {
        findUnique: jest.fn(),
        findMany: jest.fn((args: any) =>
          Promise.resolve(args?.where?.id?.in ? productRows.filter((r) => args.where.id.in.includes(r.id)) : catalogRows),
        ),
      },
    };
    quota = { consumeQuota: jest.fn() };
    const config = { get: jest.fn((key: string) => (key === 'GROQ_API_KEY' ? 'groq-key' : undefined)) } as unknown as ConfigService;
    service = new ChatService(
      config,
      prisma as PrismaService,
      quota as QuotaService,
      new ProductSuggestionService(prisma as PrismaService, { get: () => undefined } as any),
    );
  });

  it('không stream block gợi ý, lưu productId và gửi gợi ý đã ghép sản phẩm trong done', async () => {
    createCompletion.mockResolvedValue(
      streamOf([
        'Bạn thử áo sơ mi trắng với chân váy be nhé.\n',
        '<sugg',
        'estions>{"outfits":[{"name":"Công sở","reason":"Thanh lịch","items":[{"code":"P1"},{"code":"P2"},{"code":"P9"}]}],',
        '"products":["P1","P3"]}</suggestions>',
      ]),
    );

    const events = await collect(service.streamChat('user-1', { message: 'Đi làm mặc gì?' } as any));

    const text = events.filter((e) => e.type === 'token').map((e) => e.data).join('');
    expect(text).toBe('Bạn thử áo sơ mi trắng với chân váy be nhé.\n');

    const saved = prisma.chatMessage.create.mock.calls[1][0].data;
    expect(saved.content).toBe('Bạn thử áo sơ mi trắng với chân váy be nhé.');
    // P1 đã nằm trong outfit nên không lặp lại ở danh sách món lẻ; P9 không có trong catalog.
    expect(saved.suggestions).toEqual({
      outfits: [{ name: 'Công sở', reason: 'Thanh lịch', items: [{ productId: 'shirt-1', note: null }, { productId: 'skirt-1', note: null }], extras: [] }],
      productIds: ['dress-1'],
    });

    // Khung chờ ngay khi chữ xong, thẻ sản phẩm tới trước `done` (trước khi lưu DB).
    expect(events.map((e) => e.type).filter((t) => t !== 'token')).toEqual(['suggestions_pending', 'suggestions', 'done']);
    const early = events.find((e) => e.type === 'suggestions');
    expect(early.data.outfits[0].items).toHaveLength(2);
    const pendingIndex = events.findIndex((e) => e.type === 'suggestions_pending');
    expect(events.slice(pendingIndex).some((e) => e.type === 'token')).toBe(false);

    const done = events.at(-1);
    expect(done.type).toBe('done');
    expect(done.data.sessionId).toBe('sess-1');
    expect(done.data.messageId).toBe('msg-ai');
    expect(done.data.suggestions.outfits[0].items.map((i: any) => i.product.name)).toEqual(['Áo Sơ Mi Trắng', 'Chân Váy Be']);
    expect(done.data.suggestions.outfits[0].totalPrice).toBe(1100000);
    expect(done.data.suggestions.products.map((p: any) => p.id)).toEqual(['dress-1']);
    expect(quota.consumeQuota).toHaveBeenCalledWith('user-1', 'CHATBOT');
  });

  it('đưa catalog vào system prompt và không gửi trùng tin nhắn vừa lưu', async () => {
    createCompletion.mockResolvedValue(streamOf(['Chào bạn!']));
    prisma.chatMessage.findMany.mockResolvedValue([
      { id: 'old-ai', role: 'assistant', content: 'Bạn thử bộ này', suggestions: { outfits: [{ name: 'Bộ cũ', items: [{ productId: 'shirt-1' }, { productId: 'skirt-1' }] }], productIds: [] } },
      { id: 'old-user', role: 'user', content: 'Gợi ý đồ đi làm', suggestions: null },
    ]);

    const events = await collect(service.streamChat('user-1', { message: 'Còn màu khác không?' } as any));

    expect(prisma.chatMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionId: 'sess-1', id: { not: 'msg-user' } } }),
    );
    const { messages } = createCompletion.mock.calls[0][0];
    expect(messages[0].content).toContain('P1 | Áo Sơ Mi Trắng');
    expect(messages.map((m: any) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(messages[2].content).toContain('[Sản phẩm đã gợi ý ở câu trả lời này: Bộ cũ: Áo Sơ Mi Trắng + Chân Váy Be]');
    expect(messages[3].content).toBe('Còn màu khác không?');

    expect(prisma.chatMessage.create.mock.calls[1][0].data.suggestions).toBeUndefined();
    expect(events.at(-1).data.suggestions).toBeNull();
  });

  it('block bị cắt vì hết token: vẫn tạo thẻ từ mã sản phẩm model nhắc trong chữ, chữ không còn mã', async () => {
    async function* truncated() {
      for (const content of ['Bạn thử áo sơ mi trắng (P1) với chân váy be (P2).\n', '<suggestions>{"outfits":[{"name":"Bộ']) {
        yield { choices: [{ delta: { content } }] };
      }
      yield { choices: [{ delta: {}, finish_reason: 'length' }] };
    }
    createCompletion.mockResolvedValue(truncated());

    const events = await collect(service.streamChat('user-1', { message: 'Đi làm mặc gì?' } as any));

    expect(events.filter((e) => e.type === 'token').map((e) => e.data).join('')).toBe('Bạn thử áo sơ mi trắng với chân váy be.\n');
    expect(prisma.chatMessage.create.mock.calls[1][0].data.suggestions).toEqual({ outfits: [], productIds: ['shirt-1', 'skirt-1'] });
    expect(events.at(-1).data.suggestions.products.map((p: any) => p.id)).toEqual(['shirt-1', 'skirt-1']);
    // gpt-oss: giảm suy luận để token dành cho câu trả lời.
    expect(createCompletion.mock.calls[0][0].reasoning_effort).toBe('low');
  });

  it('getSession ghép sản phẩm cho gợi ý của từng tin nhắn', async () => {
    prisma.chatSession.findFirst.mockResolvedValue({
      id: 'sess-1',
      messages: [
        { id: 'm1', role: 'user', content: 'Hi', suggestions: null },
        { id: 'm2', role: 'assistant', content: 'Đây', suggestions: { outfits: [], productIds: ['dress-1', 'gone'] } },
      ],
    });

    const session = await service.getSession('user-1', 'sess-1');

    expect(session.messages[0].suggestions).toBeNull();
    expect(session.messages[1].suggestions).toEqual({
      outfits: [],
      products: [expect.objectContaining({ id: 'dress-1', name: 'Đầm Đen', available: true, color: null })],
    });
  });
});
