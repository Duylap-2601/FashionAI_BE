import {
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ChatMessage, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { QuotaService } from '../../common/services/quota.service';
import {
  OutfitSuggestion,
  ProductSuggestionService,
  StoredOutfit,
  StylingCatalog,
  SuggestedProduct,
  collectProductIds,
} from '../products/product-suggestion.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import { CHAT_SYSTEM_PROMPT, buildCatalogPrompt } from './prompts/system-prompt';
import { SuggestionBlockSplitter, parseSuggestionBlock } from './utils/suggestion-block';

/** Gợi ý gắn với một câu trả lời, đã ghép sản phẩm thật để client hiển thị card. */
export interface ChatSuggestions {
  outfits: OutfitSuggestion[];
  products: SuggestedProduct[];
}

/** Dạng lưu ở cột chat_messages.suggestions: chỉ productId, lúc đọc mới ghép sản phẩm. */
interface StoredChatSuggestions {
  outfits: StoredOutfit[];
  productIds: string[];
}

/**
 * Sự kiện stream thuần dữ liệu, không gắn với transport. Controller SSE format
 * thành `data: ...\n\n`, ChatGateway emit thành socket event tương ứng. Nhờ vậy
 * cùng một luồng stream phục vụ được cả SSE (legacy) lẫn WebSocket.
 */
export type ChatStreamEvent =
  | { type: 'token'; data: string }
  | { type: 'done'; data: { sessionId: string; messageId: string; suggestions: ChatSuggestions | null } }
  | { type: 'error'; data: string };

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens: number;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly quotaService: QuotaService,
    private readonly productSuggestions: ProductSuggestionService,
  ) {
    const apiKey = this.config.get<string>('GROQ_API_KEY');
    if (!apiKey) {
      this.logger.warn('GROQ_API_KEY not configured. Chatbot will be unavailable.');
    }

    this.client = new OpenAI({
      apiKey: apiKey ?? 'dummy',
      baseURL: 'https://api.groq.com/openai/v1',
    });

    this.model = this.config.get<string>('GROQ_MODEL') ?? 'openai/gpt-oss-120b';
    this.temperature = parseFloat(this.config.get<string>('GROQ_TEMPERATURE') ?? '0.7');
    this.maxTokens = parseInt(this.config.get<string>('GROQ_MAX_TOKENS') ?? '2048', 10);

    this.logger.log(`Groq chat client initialized | model=${this.model}`);
  }

  async *streamChat(
    userId: string,
    dto: ChatRequestDto,
  ): AsyncGenerator<ChatStreamEvent, void, unknown> {
    // Check API key
    if (!this.config.get<string>('GROQ_API_KEY')) {
      throw new HttpException(
        {
          statusCode: 503,
          message: 'Tính năng Chatbot chưa được cấu hình API key (GROQ_API_KEY).',
          error: 'GROQ_NOT_CONFIGURED',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // Validate message
    if (!dto.message?.trim()) {
      throw new BadRequestException('Tin nhắn không được để trống');
    }

    // Get or create session
    let session = dto.sessionId
      ? await this.prisma.chatSession.findFirst({ where: { id: dto.sessionId, userId } })
      : null;

    if (dto.sessionId && !session) {
      throw new BadRequestException('Phiên chat không tồn tại hoặc không thuộc về bạn');
    }

    if (!session) {
      session = await this.prisma.chatSession.create({
        data: { userId, title: this.generateTitle(dto.message) },
      });
    }

    // Save user message
    const userMessage = await this.prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'user',
        content: dto.message.trim(),
      },
    });

    // Build conversation context
    const catalog = await this.productSuggestions.getCatalog();
    const messages = await this.buildMessages(session.id, userMessage.id, dto, catalog);

    // Stream from Groq. Block gợi ý ở cuối câu trả lời bị tách ra, không stream cho client.
    const splitter = new SuggestionBlockSplitter();
    let suggestionBlock: string | null = null;
    let fullResponse = '';
    let tokensIn = 0;
    let tokensOut = 0;

    try {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        stream: true,
      });

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        const content = choice?.delta?.content ?? '';
        const text = content ? splitter.push(content) : '';
        if (text) {
          fullResponse += text;
          yield { type: 'token', data: text };
        }
        if (choice?.finish_reason) {
          if (chunk.usage) {
            tokensIn = chunk.usage.prompt_tokens;
            tokensOut = chunk.usage.completion_tokens;
          }
          break;
        }
      }

      const rest = splitter.finish();
      suggestionBlock = rest.block;
      if (rest.text) {
        fullResponse += rest.text;
        yield { type: 'token', data: rest.text };
      }
    } catch (error: any) {
      this.logger.error(`Groq streaming error: ${error.message}`);
      yield { type: 'error', data: 'Lỗi khi gọi AI. Vui lòng thử lại.' };
      return; // Kết thúc generator, không throw (SSE header có thể đã gửi)
    }

    const storedSuggestions = this.resolveSuggestions(parseSuggestionBlock(suggestionBlock), catalog);
    if (suggestionBlock !== null && !storedSuggestions) {
      this.logger.warn(`Groq trả block gợi ý không dùng được | session=${session.id}`);
    }

    // Save assistant message
    const assistantMessage = await this.prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'assistant',
        content: fullResponse.trimEnd(),
        suggestions: storedSuggestions
          ? (storedSuggestions as unknown as Prisma.InputJsonObject)
          : undefined,
        tokensIn: tokensIn || undefined,
        tokensOut: tokensOut || undefined,
        model: this.model,
      },
    });

    // Update session title if first exchange
    if (!session.title) {
      await this.prisma.chatSession.update({
        where: { id: session.id },
        data: { title: this.generateTitle(dto.message) },
      });
    }

    // Consume quota
    await this.quotaService.consumeQuota(userId, 'CHATBOT');

    // Gợi ý chỉ là phần thêm: lỗi khi ghép sản phẩm không được làm hỏng câu trả lời đã lưu.
    let suggestions: ChatSuggestions | null = null;
    if (storedSuggestions) {
      try {
        suggestions = await this.hydrateSuggestions([storedSuggestions]).then((list) => list[0]);
      } catch (error: unknown) {
        this.logger.warn(`Không ghép được sản phẩm gợi ý: ${error instanceof Error ? error.message : error}`);
      }
    }

    // Send done event
    yield {
      type: 'done',
      data: { sessionId: session.id, messageId: assistantMessage.id, suggestions },
    };
  }

  async getSessions(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.chatSession.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          messages: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: { content: true, role: true },
          },
        },
      }),
      this.prisma.chatSession.count({ where: { userId } }),
    ]);

    return {
      items: items.map((s) => ({
        id: s.id,
        title: s.title,
        updatedAt: s.updatedAt,
        lastMessage: s.messages[0]?.content ?? '',
        lastRole: s.messages[0]?.role ?? 'user',
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getSession(userId: string, sessionId: string) {
    const session = await this.prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!session) {
      throw new BadRequestException('Phiên chat không tồn tại');
    }

    const suggestions = await this.hydrateSuggestions(
      session.messages.map((message) => this.parseStoredSuggestions(message.suggestions)),
    );
    return {
      ...session,
      messages: session.messages.map((message, index) => ({
        ...message,
        suggestions: suggestions[index],
      })),
    };
  }

  async deleteSession(userId: string, sessionId: string) {
    const session = await this.prisma.chatSession.findFirst({ where: { id: sessionId, userId } });
    if (!session) {
      throw new BadRequestException('Phiên chat không tồn tại');
    }
    await this.prisma.chatSession.delete({ where: { id: sessionId } });
    return { deleted: true };
  }

  private async buildMessages(
    sessionId: string,
    currentMessageId: string,
    dto: ChatRequestDto,
    catalog: StylingCatalog,
  ) {
    // Get recent history (last 10 messages to stay within context window). Bỏ tin nhắn vừa
    // lưu vì nó được thêm ở cuối danh sách bên dưới, tránh gửi trùng cho model.
    const history = await this.prisma.chatMessage.findMany({
      where: { sessionId, id: { not: currentMessageId } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const historyMessages = history.reverse().map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.role === 'assistant' ? this.withSuggestionNote(m, catalog) : m.content,
    }));

    // Build system prompt with optional context
    let systemPrompt = CHAT_SYSTEM_PROMPT;
    if (dto.context) {
      systemPrompt += '\n\nCONTEXT BỔ SUNG:\n' + JSON.stringify(dto.context, null, 2);
    }

    let viewingProduct: string | null = null;
    if (dto.productId) {
      const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
      if (product) {
        const code = this.productSuggestions.findCodeByProductId(catalog, product.id);
        viewingProduct = `${code ? `${code} - ` : ''}${product.name} (${product.category}) - ${Number(product.price).toLocaleString('vi-VN')}đ`;
      }
    }
    systemPrompt +=
      '\n' +
      buildCatalogPrompt(
        this.productSuggestions.formatCatalogForPrompt(catalog),
        catalog.audienceNote,
        viewingProduct,
      );

    return [
      { role: 'system' as const, content: systemPrompt },
      ...historyMessages,
      { role: 'user' as const, content: dto.message.trim() },
    ];
  }

  private resolveSuggestions(
    payload: Record<string, unknown> | null,
    catalog: StylingCatalog,
  ): StoredChatSuggestions | null {
    if (!payload) return null;
    const outfits = this.productSuggestions.resolveOutfits(payload.outfits, catalog);
    const inOutfits = new Set(collectProductIds(outfits));
    const productIds = this.productSuggestions
      .resolveProductCodes(payload.products, catalog)
      .filter((id) => !inOutfits.has(id));
    return outfits.length || productIds.length ? { outfits, productIds } : null;
  }

  private parseStoredSuggestions(raw: Prisma.JsonValue | null): StoredChatSuggestions | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const outfits = this.productSuggestions.parseStoredOutfits(raw.outfits);
    const productIds = Array.isArray(raw.productIds)
      ? raw.productIds.filter((id): id is string => typeof id === 'string')
      : [];
    return outfits.length || productIds.length ? { outfits, productIds } : null;
  }

  /** Ghép sản phẩm cho nhiều tin nhắn bằng một query; phần tử null giữ nguyên vị trí. */
  private async hydrateSuggestions(
    storedList: (StoredChatSuggestions | null)[],
  ): Promise<(ChatSuggestions | null)[]> {
    const ids = storedList.flatMap((stored) =>
      stored ? [...collectProductIds(stored.outfits), ...stored.productIds] : [],
    );
    const products = await this.productSuggestions.loadProducts(ids);

    return storedList.map((stored) => {
      if (!stored) return null;
      const outfits = this.productSuggestions.buildOutfits(stored.outfits, products);
      const singles = stored.productIds
        .map((id) => products.get(id))
        .filter((product): product is SuggestedProduct => product !== undefined);
      return outfits.length || singles.length ? { outfits, products: singles } : null;
    });
  }

  /** Nhắc model những sản phẩm nó đã gợi ý ở lượt trước (block gợi ý không nằm trong content). */
  private withSuggestionNote(message: ChatMessage, catalog: StylingCatalog): string {
    const stored = this.parseStoredSuggestions(message.suggestions);
    if (!stored) return message.content;

    const names = new Map(catalog.entries.map((entry) => [entry.id, entry.name]));
    const lines = [
      ...stored.outfits.map((outfit) => this.productSuggestions.describeOutfit(outfit, catalog)),
      ...stored.productIds.map((id) => names.get(id)).filter((name): name is string => Boolean(name)),
    ];
    return `${message.content}\n\n[Sản phẩm đã gợi ý ở câu trả lời này: ${lines.join('; ')}]`;
  }

  private generateTitle(firstMessage: string): string {
    const cleaned = firstMessage.trim().slice(0, 50);
    return cleaned.length < firstMessage.length ? cleaned + '…' : cleaned;
  }
}