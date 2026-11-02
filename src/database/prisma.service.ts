import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// DB là Neon từ xa qua pgbouncer: mỗi câu query tốn một vòng mạng, nên transaction nhiều
// bước (tạo đơn, hoàn tiền...) dễ vượt mặc định 5s của Prisma khi mạng chậm và bị huỷ
// giữa chừng. Nới giới hạn để đơn không hỏng chỉ vì độ trễ; transaction vẫn nên làm ít việc.
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({ transactionOptions: TRANSACTION_OPTIONS });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
