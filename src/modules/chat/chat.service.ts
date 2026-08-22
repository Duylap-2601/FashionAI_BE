import {
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PrismaService } from '../../database/prisma.service';
import { QuotaService } from '../../common/services/quota.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import { CHAT_SYSTEM_PROMPT, CHAT_WELCOME_MESSAGE } from './prompts/system-prompt';

interface ChatCompletionChunk {
  choices: Array<{
    delta: { content?: string; role?: string };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

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

  async *streamChat(userId: string, dto: ChatRequestDto): AsyncGenerator<string, void, unknown> {
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
    await this.prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'user',
        content: dto.message.trim(),
      },
    });

    // Build conversation context
    const messages = await this.buildMessages(session.id, dto);

    // Stream from Groq
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
        if (content) {
          fullResponse += content;
          yield `data: ${JSON.stringify({ type: 'token', data: content })}\n\n`;
        }
        if (choice?.finish_reason) {
          if (chunk.usage) {
            tokensIn = chunk.usage.prompt_tokens;
            tokensOut = chunk.usage.completion_tokens;
          }
          break;
        }
      }
    } catch (error: any) {
      this.logger.error(`Groq streaming error: ${error.message}`);
      yield `data: ${JSON.stringify({ type: 'error', data: 'Lỗi khi gọi AI. Vui lòng thử lại.' })}\n\n`;
      return; // End generator, don't throw (headers already sent via SSE)
    }

    // Save assistant message
    await this.prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'assistant',
        content: fullResponse,
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

    // Send done event
    yield `data: ${JSON.stringify({ type: 'done', data: { sessionId: session.id } })}\n\n`;
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
    return session;
  }

  async deleteSession(userId: string, sessionId: string) {
    const session = await this.prisma.chatSession.findFirst({ where: { id: sessionId, userId } });
    if (!session) {
      throw new BadRequestException('Phiên chat không tồn tại');
    }
    await this.prisma.chatSession.delete({ where: { id: sessionId } });
    return { deleted: true };
  }

  private async buildMessages(sessionId: string, dto: ChatRequestDto) {
    // Get recent history (last 10 messages to stay within context window)
    const history = await this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const historyMessages = history
      .reverse()
      .map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content }));

    // Build system prompt with optional context
    let systemPrompt = CHAT_SYSTEM_PROMPT;
    if (dto.context) {
      systemPrompt += '\n\nCONTEXT BỔ SUNG:\n' + JSON.stringify(dto.context, null, 2);
    }
    if (dto.productId) {
      const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
      if (product) {
        systemPrompt += `\n\nSẢN PHẨM ĐANG XEM: ${product.name} (${product.category}) - ${product.price} VNĐ`;
      }
    }

    return [
      { role: 'system' as const, content: systemPrompt },
      ...historyMessages,
      { role: 'user' as const, content: dto.message.trim() },
    ];
  }

  private generateTitle(firstMessage: string): string {
    const cleaned = firstMessage.trim().slice(0, 50);
    return cleaned.length < firstMessage.length ? cleaned + '…' : cleaned;
  }
}