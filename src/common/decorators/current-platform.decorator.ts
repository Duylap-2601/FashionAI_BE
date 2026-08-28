import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import {
  Platform,
  PLATFORM_HEADER,
  normalizePlatform,
} from '../../modules/auth/types/platform.type';

export const CurrentPlatform = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Platform =>
    normalizePlatform(ctx.switchToHttp().getRequest().headers[PLATFORM_HEADER]),
);
