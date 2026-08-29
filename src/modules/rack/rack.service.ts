import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class RackService {
  constructor(private readonly prisma: PrismaService) {}

  async pin(userId: string, productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException(`Không tìm thấy sản phẩm có ID: ${productId}`);
    }

    return this.prisma.rackItem.upsert({
      where: { userId_productId: { userId, productId } },
      create: { userId, productId },
      update: {},
      include: { product: { include: { images: true } } },
    });
  }

  async findAll(userId: string) {
    return this.prisma.rackItem.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { product: { include: { images: true } } },
    });
  }

  async unpin(userId: string, id: string) {
    const item = await this.prisma.rackItem.findFirst({ where: { id, userId } });
    if (!item) {
      throw new NotFoundException('Không tìm thấy sản phẩm trong giá treo đồ');
    }
    await this.prisma.rackItem.delete({ where: { id } });
    return { id };
  }

  async unpinAll(userId: string) {
    const result = await this.prisma.rackItem.deleteMany({ where: { userId } });
    return { deleted: result.count };
  }
}
