import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateProductDto } from './dto/create-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { Prisma, ProductStatus } from '@prisma/client';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async create(dto: CreateProductDto, image?: Express.Multer.File) {
    const garmentUrl = image
      ? await this.storageService.uploadImage(
          image.buffer,
          'product-images',
          `product_${Date.now()}`,
        )
      : dto.garmentUrl;

    if (!garmentUrl) {
      throw new BadRequestException('Vui lòng upload ảnh sản phẩm hoặc truyền garmentUrl');
    }

    return this.prisma.product.create({
      data: {
        name: dto.name,
        description: dto.description,
        category: dto.category,
        color: dto.color,
        size: dto.size,
        price: dto.price,
        garmentUrl,
        status: dto.status ?? ProductStatus.ACTIVE,
        images: {
          create: [{ imageUrl: garmentUrl, isMain: true }],
        },
      },
      include: { images: true },
    });
  }

  async findAll(query: QueryProductDto) {
    const {
      search,
      category,
      color,
      size,
      minPrice,
      maxPrice,
      status = ProductStatus.ACTIVE,
      page = 1,
      limit = 20,
    } = query;

    const where: Prisma.ProductWhereInput = {
      ...(status ? { status } : {}),
      ...(category ? { category } : {}),
      ...(color ? { color: { contains: color, mode: 'insensitive' } } : {}),
      ...(size ? { size: { equals: size, mode: 'insensitive' } } : {}),
      ...(minPrice !== undefined || maxPrice !== undefined
        ? {
            price: {
              ...(minPrice !== undefined ? { gte: minPrice } : {}),
              ...(maxPrice !== undefined ? { lte: maxPrice } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { images: true },
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { images: true },
    });

    if (!product) {
      throw new NotFoundException(`Không tìm thấy sản phẩm có ID: ${id}`);
    }

    return product;
  }

  async update(id: string, dto: Partial<CreateProductDto>) {
    await this.findOne(id);
    return this.prisma.product.update({
      where: { id },
      data: dto,
      include: { images: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.product.delete({
      where: { id },
    });
  }

  async uploadProductImage(
    productId: string,
    file: Express.Multer.File,
    isMain = false,
  ) {
    await this.findOne(productId);

    const imageUrl = await this.storageService.uploadImage(
      file.buffer,
      'product-images',
      `product_${productId}_${Date.now()}`,
    );

    return this.prisma.$transaction(async (tx) => {
      if (isMain) {
        await tx.productImage.updateMany({
          where: { productId },
          data: { isMain: false },
        });
      }

      const image = await tx.productImage.create({
        data: {
          productId,
          imageUrl,
          isMain,
        },
      });

      if (isMain) {
        await tx.product.update({
          where: { id: productId },
          data: { garmentUrl: imageUrl },
        });
      }

      return image;
    });
  }
}
