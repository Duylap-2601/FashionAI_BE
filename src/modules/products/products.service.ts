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

  async create(dto: CreateProductDto, images?: Express.Multer.File[]) {
    let garmentUrl = dto.garmentUrl;
    const uploadedImages: string[] = [];

    if (images && images.length > 0) {
      for (const image of images) {
        const imageUrl = await this.storageService.uploadImage(
          image.buffer,
          'product-images',
          `product_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        );
        uploadedImages.push(imageUrl);
      }
      garmentUrl = uploadedImages[0];
    }

    if (!garmentUrl) {
      throw new BadRequestException('Vui lòng upload ít nhất 1 ảnh sản phẩm hoặc truyền garmentUrl');
    }

    const createData: Prisma.ProductCreateInput = {
      name: dto.name,
      description: dto.description,
      category: dto.category,
      color: dto.color,
      price: dto.price,
      originalPrice: dto.originalPrice,
      stock: dto.stock ?? 0,
      brand: dto.brand ?? 'StAle. SIGNATURE',
      garmentUrl,
      status: dto.status ?? ProductStatus.ACTIVE,
      images: {
        create: uploadedImages.map((imageUrl, index) => ({
          imageUrl,
          isMain: index === 0,
        })),
      },
    };

    if (dto.colors !== undefined) {
      createData.colors = dto.colors;
    }

    if (dto.material !== undefined) {
      createData.material = dto.material;
    }

    return this.prisma.product.create({
      data: createData,
      include: { images: true },
    });
  }

  async findAll(query: QueryProductDto) {
    const {
      search,
      category,
      color,
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
      ...(material ? { material: { contains: material, mode: 'insensitive' } } : {}),
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
    // Loại bỏ fields từ FilesInterceptor trước khi pass vào Prisma
    const { images: _images, image: _image, isMainIndex: _isMainIndex, ...updateData } = dto;
    return this.prisma.product.update({
      where: { id },
      data: updateData,
      include: { images: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      return await this.prisma.product.delete({
        where: { id },
      });
    } catch (err) {
      // FK RESTRICT: sản phẩm đã có đơn hàng tham chiếu (order_items) thì không xóa được.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Không thể xóa sản phẩm vì đã có đơn hàng liên quan. Hãy chuyển trạng thái sản phẩm sang ARCHIVED thay vì xóa.',
        );
      }
      throw err;
    }
  }

  async removeImage(productId: string, imageId: string) {
    await this.findOne(productId);

    const image = await this.prisma.productImage.findFirst({
      where: { id: imageId, productId },
    });
    if (!image) {
      throw new NotFoundException('Không tìm thấy ảnh trong sản phẩm này');
    }

    const totalImages = await this.prisma.productImage.count({
      where: { productId },
    });
    if (totalImages <= 1) {
      throw new BadRequestException(
        'Sản phẩm phải có ít nhất 1 ảnh. Hãy upload ảnh khác trước khi xóa ảnh này.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.productImage.delete({ where: { id: imageId } });

      // Ảnh vừa xóa là ảnh chính -> promote ảnh còn lại mới nhất lên làm chính,
      // đồng thời đồng bộ garmentUrl (dùng cho Try-On/Stylist) vì field này không
      // tự derive từ bảng images.
      if (image.isMain) {
        const nextMain = await tx.productImage.findFirst({
          where: { productId },
          orderBy: { createdAt: 'desc' },
        });
        if (nextMain) {
          await tx.productImage.update({
            where: { id: nextMain.id },
            data: { isMain: true },
          });
          await tx.product.update({
            where: { id: productId },
            data: { garmentUrl: nextMain.imageUrl },
          });
        }
      }

      return tx.product.findUnique({
        where: { id: productId },
        include: { images: true },
      });
    });
  }

  async uploadProductImages(
    productId: string,
    files: Express.Multer.File[],
    mainIndex = 0,
  ) {
    await this.findOne(productId);

    if (files.length === 0) {
      throw new BadRequestException('Danh sách ảnh không được rỗng');
    }

    if (mainIndex < 0 || mainIndex >= files.length) {
      throw new BadRequestException(`Chỉ số ảnh chính không hợp lệ (0-${files.length - 1})`);
    }

    const imageUrls: string[] = [];
    for (const file of files) {
      const imageUrl = await this.storageService.uploadImage(
        file.buffer,
        'product-images',
        `product_${productId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      );
      imageUrls.push(imageUrl);
    }

    return this.prisma.$transaction(async (tx) => {
      if (imageUrls[mainIndex]) {
        await tx.productImage.updateMany({
          where: { productId },
          data: { isMain: false },
        });
      }

      const createdImages = [];
      for (let i = 0; i < imageUrls.length; i++) {
        const image = await tx.productImage.create({
          data: {
            productId,
            imageUrl: imageUrls[i],
            isMain: i === mainIndex,
          },
        });
        createdImages.push(image);
      }

      if (imageUrls[mainIndex]) {
        await tx.product.update({
          where: { id: productId },
          data: { garmentUrl: imageUrls[mainIndex] },
        });
      }

      return createdImages;
    });
  }
}
