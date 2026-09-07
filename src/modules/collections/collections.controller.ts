import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Role } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FileValidationPipe } from '../../common/pipes/file-validation.pipe';
import { CollectionsService } from './collections.service';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { QueryCollectionDto } from './dto/query-collection.dto';
import { AddProductDto } from './dto/add-product.dto';
import { buildApiResponse } from '../../common/utils/api-response.util';

@ApiTags('Collections')
@Controller('collections')
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Tạo mới bộ sưu tập kèm upload cover images (Admin Only)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', example: 'Áo Dài 2026' },
        slug: { type: 'string', example: 'ao-dai-2026', description: 'URL-friendly slug (auto-generated if not provided)' },
        description: { type: 'string', example: 'Thanh lịch, tinh tế cho mùa hè' },
        isPublished: { type: 'boolean', example: false },
        displayOrder: { type: 'integer', example: 1 },
        coverImages: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'Tối đa 3 ảnh cover cho hero banner',
        },
      },
    },
  })
  @UseInterceptors(AnyFilesInterceptor())
  async create(
    @Req() req: Request,
    @Body() dto: CreateCollectionDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    const images = (files ?? []).filter(
      (f) => f.fieldname === 'coverImages',
    );

    if (images.length > 0) {
      const filePipe = new FileValidationPipe({ maxSize: 10 * 1024 * 1024 });
      for (const image of images) {
        filePipe.transform(image);
      }
    }

    const data = await this.collectionsService.create(dto, images);
    return buildApiResponse(
      req,
      'COLLECTION_CREATE_SUCCESS',
      'Tạo mới bộ sưu tập thành công',
      data,
    );
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Danh sách tất cả bộ sưu tập (Admin Only)' })
  async findAll(
    @Req() req: Request,
    @Query() query: QueryCollectionDto,
  ) {
    const result = await this.collectionsService.findAll(query);
    return buildApiResponse(
      req,
      'COLLECTIONS_FETCH_SUCCESS',
      'Lấy danh sách bộ sưu tập thành công',
      result.items,
      result.meta,
    );
  }

  @Public()
  @Get('published')
  @ApiOperation({ summary: 'Danh sách bộ sưu tập đã công bố (Public, sorted by displayOrder)' })
  async findPublished(
    @Req() req: Request,
    @Query() query: QueryCollectionDto,
  ) {
    const result = await this.collectionsService.findPublished(query);
    return buildApiResponse(
      req,
      'PUBLISHED_COLLECTIONS_FETCH_SUCCESS',
      'Lấy danh sách bộ sưu tập công bố thành công',
      result.items,
      result.meta,
    );
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Chi tiết bộ sưu tập theo slug (Public, isPublished=true required)' })
  async findBySlug(
    @Req() req: Request,
    @Param('slug') slug: string,
  ) {
    const data = await this.collectionsService.findBySlug(slug);
    return buildApiResponse(
      req,
      'COLLECTION_FETCH_SUCCESS',
      'Lấy thông tin bộ sưu tập thành công',
      data,
    );
  }

  @Get('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Chi tiết bộ sưu tập theo ID (Admin Only)' })
  async findOne(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const data = await this.collectionsService.findOne(id);
    return buildApiResponse(
      req,
      'COLLECTION_FETCH_SUCCESS',
      'Lấy thông tin bộ sưu tập thành công',
      data,
    );
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Cập nhật bộ sưu tập (Admin Only)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        slug: { type: 'string' },
        description: { type: 'string' },
        isPublished: { type: 'boolean' },
        displayOrder: { type: 'integer' },
        coverImages: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'Tối đa 3 ảnh cover (sẽ thay thế ảnh cũ)',
        },
      },
    },
  })
  @UseInterceptors(AnyFilesInterceptor())
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateCollectionDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    const images = (files ?? []).filter(
      (f) => f.fieldname === 'coverImages',
    );

    if (images.length > 0) {
      const filePipe = new FileValidationPipe({ maxSize: 10 * 1024 * 1024 });
      for (const image of images) {
        filePipe.transform(image);
      }
    }

    const data = await this.collectionsService.update(id, dto, images);
    return buildApiResponse(
      req,
      'COLLECTION_UPDATE_SUCCESS',
      'Cập nhật bộ sưu tập thành công',
      data,
    );
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Xóa bộ sưu tập (Admin Only)' })
  async remove(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const data = await this.collectionsService.remove(id);
    return buildApiResponse(
      req,
      'COLLECTION_DELETE_SUCCESS',
      'Xóa bộ sưu tập thành công',
      data,
    );
  }

  @Post(':collectionId/products')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Thêm sản phẩm vào bộ sưu tập (Admin Only)' })
  async addProduct(
    @Req() req: Request,
    @Param('collectionId') collectionId: string,
    @Body() dto: AddProductDto,
  ) {
    const data = await this.collectionsService.addProduct(collectionId, dto);
    return buildApiResponse(
      req,
      'PRODUCT_ADD_TO_COLLECTION_SUCCESS',
      'Thêm sản phẩm vào bộ sưu tập thành công',
      data,
    );
  }

  @Delete(':collectionId/products/:productId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Xóa sản phẩm khỏi bộ sưu tập (Admin Only)' })
  async removeProduct(
    @Req() req: Request,
    @Param('collectionId') collectionId: string,
    @Param('productId') productId: string,
  ) {
    const data = await this.collectionsService.removeProduct(
      collectionId,
      productId,
    );
    return buildApiResponse(
      req,
      'PRODUCT_REMOVE_FROM_COLLECTION_SUCCESS',
      'Xóa sản phẩm khỏi bộ sưu tập thành công',
      data,
    );
  }

  @Public()
  @Get(':collectionId/products')
  @ApiOperation({ summary: 'Danh sách sản phẩm trong bộ sưu tập (Public)' })
  async getProducts(
    @Req() req: Request,
    @Param('collectionId') collectionId: string,
    @Query() query: QueryCollectionDto,
  ) {
    const result = await this.collectionsService.getProducts(
      collectionId,
      query,
    );
    return buildApiResponse(
      req,
      'COLLECTION_PRODUCTS_FETCH_SUCCESS',
      'Lấy danh sách sản phẩm trong bộ sưu tập thành công',
      result.items,
      result.meta,
    );
  }
}
