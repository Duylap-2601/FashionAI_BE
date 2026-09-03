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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Role } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { QueryReviewDto } from './dto/query-review.dto';
import { CreateReviewReplyDto } from './dto/create-review-reply.dto';
import { UpdateReviewReplyDto } from './dto/update-review-reply.dto';
import { QueryReviewReplyDto } from './dto/query-review-reply.dto';
import { ReviewsService } from './reviews.service';
import { buildApiResponse } from '../../common/utils/api-response.util';

@ApiTags('Reviews')
@Controller('products')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post(':productId/reviews')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Tạo đánh giá sản phẩm (chỉ user đã mua và nhận hàng)' })
  async create(
    @Req() req: Request,
    @CurrentUser('id') userId: string,
    @Param('productId') productId: string,
    @Body() dto: CreateReviewDto,
  ) {
    const data = await this.reviewsService.create(userId, productId, dto);
    return buildApiResponse(req, 'REVIEW_CREATE_SUCCESS', 'Tạo đánh giá thành công', data);
  }

  @Public()
  @Get(':productId/reviews')
  @ApiOperation({ summary: 'Danh sách đánh giá sản phẩm (có lọc, phân trang)' })
  async findByProduct(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Query() query: QueryReviewDto,
    @CurrentUser('id') userId?: string,
  ) {
    const result = await this.reviewsService.findByProduct(productId, query, userId);
    return buildApiResponse(
      req,
      'REVIEWS_FETCH_SUCCESS',
      'Lấy danh sách đánh giá thành công',
      result.items,
      result.meta,
    );
  }

  @Public()
  @Get(':productId/reviews/stats')
  @ApiOperation({ summary: 'Thống kê đánh giá sản phẩm (avg rating, distribution)' })
  async getStats(@Req() req: Request, @Param('productId') productId: string) {
    const data = await this.reviewsService.getProductStats(productId);
    return buildApiResponse(req, 'REVIEW_STATS_SUCCESS', 'Lấy thống kê đánh giá thành công', data);
  }

  @Get('reviews/my')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Danh sách đánh giá của tôi' })
  async findMyReviews(
    @Req() req: Request,
    @CurrentUser('id') userId: string,
    @Query() query: QueryReviewDto,
  ) {
    const result = await this.reviewsService.findByUser(userId, query);
    return buildApiResponse(
      req,
      'MY_REVIEWS_FETCH_SUCCESS',
      'Lấy danh sách đánh giá của bạn thành công',
      result.items,
      result.meta,
    );
  }

  @Patch('reviews/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Cập nhật đánh giá (chỉ sửa comment/ảnh, không đổi rating)' })
  async update(
    @Req() req: Request,
    @CurrentUser('id') userId: string,
    @Param('id') reviewId: string,
    @Body() dto: UpdateReviewDto,
  ) {
    const data = await this.reviewsService.update(userId, reviewId, dto);
    return buildApiResponse(req, 'REVIEW_UPDATE_SUCCESS', 'Cập nhật đánh giá thành công', data);
  }

  @Delete('reviews/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Xóa đánh giá của mình' })
  async remove(
    @Req() req: Request,
    @CurrentUser('id') userId: string,
    @Param('id') reviewId: string,
  ) {
    await this.reviewsService.remove(userId, reviewId, false);
    return buildApiResponse(req, 'REVIEW_DELETE_SUCCESS', 'Xóa đánh giá thành công', null);
  }

  @Delete('admin/reviews/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Xóa đánh giá bất kỳ (Admin)' })
  async adminRemove(@Req() req: Request, @Param('id') reviewId: string) {
    await this.reviewsService.remove('', reviewId, true);
    return buildApiResponse(req, 'REVIEW_ADMIN_DELETE_SUCCESS', 'Xóa đánh giá thành công', null);
  }

  // --- Review Reply Endpoints ---

  @Post('reviews/:reviewId/replies')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Tạo phản hồi cho đánh giá (user/admin)' })
  async createReply(
    @Req() req: Request,
    @CurrentUser('id') userId: string,
    @Param('reviewId') reviewId: string,
    @Body() dto: CreateReviewReplyDto,
  ) {
    const data = await this.reviewsService.createReply(userId, reviewId, dto);
    return buildApiResponse(req, 'REVIEW_REPLY_CREATE_SUCCESS', 'Tạo phản hồi thành công', data);
  }

  @Public()
  @Get('reviews/:reviewId/replies')
  @ApiOperation({ summary: 'Danh sách phản hồi của đánh giá' })
  async getReplies(
    @Req() req: Request,
    @Param('reviewId') reviewId: string,
    @Query() query: QueryReviewReplyDto,
  ) {
    const result = await this.reviewsService.findReplies(reviewId, query);
    return buildApiResponse(
      req,
      'REVIEW_REPLIES_FETCH_SUCCESS',
      'Lấy danh sách phản hồi thành công',
      result.items,
      result.meta,
    );
  }

  @Patch('reviews/replies/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Cập nhật phản hồi (chủ sở hữu)' })
  async updateReply(
    @Req() req: Request,
    @CurrentUser('id') userId: string,
    @Param('id') replyId: string,
    @Body() dto: UpdateReviewReplyDto,
  ) {
    const data = await this.reviewsService.updateReply(userId, replyId, dto);
    return buildApiResponse(req, 'REVIEW_REPLY_UPDATE_SUCCESS', 'Cập nhật phản hồi thành công', data);
  }

  @Delete('reviews/replies/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Xóa phản hồi (chủ sở hữu hoặc admin)' })
  async removeReply(
    @Req() req: Request,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: Role,
    @Param('id') replyId: string,
  ) {
    await this.reviewsService.removeReply(userId, replyId, role === Role.ADMIN);
    return buildApiResponse(req, 'REVIEW_REPLY_DELETE_SUCCESS', 'Xóa phản hồi thành công', null);
  }
}