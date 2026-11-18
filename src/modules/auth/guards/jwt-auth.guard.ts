import { ExecutionContext, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { TokenExpiredError } from 'jsonwebtoken';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  // passport-jwt chỉ trả lỗi generic qua handleRequest — bắt riêng
  // TokenExpiredError để FE phân biệt được "nên tự refresh" (access token hết
  // hạn) với "nên logout ngay" (token sai/thiếu), thay vì luôn nhận
  // code: UNAUTHORIZED chung.
  handleRequest<TUser = any>(err: unknown, user: TUser, info: unknown): TUser {
    if (info instanceof TokenExpiredError) {
      throw new UnauthorizedException({
        code: 'ACCESS_TOKEN_EXPIRED',
        message: 'Access token đã hết hạn',
        error: 'ACCESS_TOKEN_EXPIRED',
      });
    }
    if (err || !user) {
      // Giữ nguyên lỗi cụ thể do JwtStrategy.validate ném (token thu hồi, user bị khoá...).
      if (err instanceof HttpException) throw err;
      // Mã ổn định `UNAUTHORIZED` cho client phân biệt "thiếu/sai token" (xem BR-118).
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Bạn cần đăng nhập để tiếp tục.',
      });
    }
    return user;
  }
}
