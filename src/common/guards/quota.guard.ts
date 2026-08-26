import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { QuotaService } from '../services/quota.service';
import { AiActionName } from '../constants/ai-quota.constants';

export const AI_ACTION_KEY = 'ai_action_type';
export const AiAction = (action: AiActionName) => SetMetadata(AI_ACTION_KEY, action);

@Injectable()
export class QuotaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly quotaService: QuotaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action: AiActionName =
      this.reflector.getAllAndOverride<AiActionName>(AI_ACTION_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'TRY_ON';

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new HttpException(
        {
          success: false,
          code: 'UNAUTHORIZED',
          message: 'Bạn cần đăng nhập để sử dụng tính năng AI.',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Guard chỉ kiểm tra hạn mức. Việc trừ quota do service thực hiện sau khi
    // gọi provider thành công (xem QuotaService.consumeQuota), để request lỗi
    // hoặc cache hit không bị tính lượt.
    await this.quotaService.assertQuota(
      user.id,
      user.tier,
      action,
      user.tierExpiresAt,
    );
    return true;
  }
}
