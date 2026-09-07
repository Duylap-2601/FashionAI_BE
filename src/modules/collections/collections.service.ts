import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { QueryCollectionDto } from './dto/query-collection.dto';
import { AddProductDto } from './dto/add-product.dto';

@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  async create(
    dto: CreateCollectionDto,
    files?: Express.Multer.File[],
  ) {
    // Validate max 3 images
    if (files && files.length > 3) {
      throw new BadRequestException(
        'Tối đa 3 ảnh cover cho bộ sưu tập',
      );
    }

    // Generate or validate slug
    let slug = dto.slug;
    if (!slug) {
      slug = this.generateSlug(dto.name);
    }

    // Check slug uniqueness
    const existingBySlug = await this.prisma.collection.findUnique({
      where: { slug },
    });
    if (existingBySlug) {
      throw new ConflictException(
        `Slug "${slug}" đã tồn tại. Vui lòng sử dụng slug khác.`,
      );
    }

    // Check name uniqueness
    const existingByName = await this.prisma.collection.findUnique({
      where: { name: dto.name },
    });
    if (existingByName) {
      throw new ConflictException(
        `Tên bộ sưu tập "${dto.name}" đã tồn tại`,
      );
    }

    // Upload cover images
    const coverImages: string[] = [];
    if (files && files.length > 0) {
      for (const file of files) {
        const imageUrl = await this.storageService.uploadImage(
          file.buffer,
          'collection-covers',
          `collection_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        );
        coverImages.push(imageUrl);
      }
    }

    return this.prisma.collection.create({
      data: {
        name: dto.name,
        slug,
        description: dto.description,
        coverImages,
        isPublished: dto.isPublished ?? false,
        displayOrder: dto.displayOrder ?? 0,
      },
    });
  }

  async findAll(query: QueryCollectionDto) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.collection.findMany({
        skip,
        take: limit,
        orderBy: { displayOrder: 'asc' },
        include: {
          _count: {
            select: { products: true },
          },
        },
      }),
      this.prisma.collection.count(),
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
    const collection = await this.prisma.collection.findUnique({
      where: { id },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    if (!collection) {
      throw new NotFoundException(
        `Không tìm thấy bộ sưu tập có ID: ${id}`,
      );
    }

    return collection;
  }

  async findBySlug(slug: string) {
    const collection = await this.prisma.collection.findUnique({
      where: { slug },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    if (!collection) {
      throw new NotFoundException(
        `Không tìm thấy bộ sưu tập: ${slug}`,
      );
    }

    if (!collection.isPublished) {
      throw new NotFoundException(
        `Bộ sưu tập "${slug}" chưa được công bố`,
      );
    }

    return collection;
  }

  async findPublished(query: QueryCollectionDto) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.collection.findMany({
        where: { isPublished: true },
        skip,
        take: limit,
        orderBy: { displayOrder: 'asc' },
        include: {
          _count: {
            select: { products: true },
          },
        },
      }),
      this.prisma.collection.count({ where: { isPublished: true } }),
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

  async update(
    id: string,
    dto: UpdateCollectionDto,
    files?: Express.Multer.File[],
  ) {
    await this.findOne(id);

    // Validate max 3 images if provided
    if (files && files.length > 3) {
      throw new BadRequestException(
        'Tối đa 3 ảnh cover cho bộ sưu tập',
      );
    }

    const updateData: any = {};

    if (dto.name) {
      // Check name uniqueness (exclude current collection)
      const existingByName = await this.prisma.collection.findFirst({
        where: {
          name: dto.name,
          NOT: { id },
        },
      });
      if (existingByName) {
        throw new ConflictException(
          `Tên bộ sưu tập "${dto.name}" đã tồn tại`,
        );
      }
      updateData.name = dto.name;
    }

    if (dto.slug) {
      // Check slug uniqueness (exclude current collection)
      const existingBySlug = await this.prisma.collection.findFirst({
        where: {
          slug: dto.slug,
          NOT: { id },
        },
      });
      if (existingBySlug) {
        throw new ConflictException(
          `Slug "${dto.slug}" đã tồn tại`,
        );
      }
      updateData.slug = dto.slug;
    }

    if (dto.description !== undefined) {
      updateData.description = dto.description;
    }

    if (dto.isPublished !== undefined) {
      updateData.isPublished = dto.isPublished;
    }

    if (dto.displayOrder !== undefined) {
      updateData.displayOrder = dto.displayOrder;
    }

    // Handle cover image replacement
    if (files && files.length > 0) {
      const coverImages: string[] = [];
      for (const file of files) {
        const imageUrl = await this.storageService.uploadImage(
          file.buffer,
          'collection-covers',
          `collection_${id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        );
        coverImages.push(imageUrl);
      }
      updateData.coverImages = coverImages;
    }

    return this.prisma.collection.update({
      where: { id },
      data: updateData,
      include: {
        _count: {
          select: { products: true },
        },
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.collection.delete({
      where: { id },
    });
  }

  async addProduct(collectionId: string, dto: AddProductDto) {
    // Verify collection exists
    await this.findOne(collectionId);

    // Verify product exists
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });
    if (!product) {
      throw new NotFoundException(
        `Không tìm thấy sản phẩm có ID: ${dto.productId}`,
      );
    }

    // Check if product already in collection
    const existing = await this.prisma.productCollection.findUnique({
      where: {
        collectionId_productId: {
          collectionId,
          productId: dto.productId,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        'Sản phẩm đã có trong bộ sưu tập này',
      );
    }

    return this.prisma.productCollection.create({
      data: {
        collectionId,
        productId: dto.productId,
      },
    });
  }

  async removeProduct(collectionId: string, productId: string) {
    await this.findOne(collectionId);

    const existing = await this.prisma.productCollection.findUnique({
      where: {
        collectionId_productId: {
          collectionId,
          productId,
        },
      },
    });
    if (!existing) {
      throw new NotFoundException(
        'Sản phẩm không có trong bộ sưu tập này',
      );
    }

    return this.prisma.productCollection.delete({
      where: {
        collectionId_productId: {
          collectionId,
          productId,
        },
      },
    });
  }

  async getProducts(
    collectionId: string,
    query: any,
  ) {
    await this.findOne(collectionId);

    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          collections: {
            some: { collectionId },
          },
        },
        skip,
        take: limit,
        include: { images: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.product.count({
        where: {
          collections: {
            some: { collectionId },
          },
        },
      }),
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
}
