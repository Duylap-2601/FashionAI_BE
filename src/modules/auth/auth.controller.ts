import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request, Response, CookieOptions } from 'express';
import ms, { StringValue } from 'ms';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';

type AuthTokens = Awaited<ReturnType<AuthService['login']>>;
type GoogleOAuthUser = {
  email: string;
  name?: string;
  avatarUrl?: string;
  providerId: string;
};

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
    private readonly tokenService: TokenService,
  ) {}

  @Public()
  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Redirect to Google OAuth login' })
  async googleAuth() {
    return;
  }

  @Public()
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth callback' })
  async googleCallback(
    @Req() req: Request & { user?: GoogleOAuthUser },
    @Res({ passthrough: true }) res: Response,
    @Query('error') error?: string,
  ) {
    const redirectUrl = this.buildGoogleFrontendRedirect();

    if (error || !req.user) {
      redirectUrl.searchParams.set('error', error || 'google_auth_failed');
      return res.redirect(redirectUrl.toString());
    }

    const tokens = await this.authService.handleGoogleLogin(req.user);
    this.setRefreshCookie(res, tokens.refreshToken);

    redirectUrl.searchParams.set('accessToken', tokens.accessToken);
    redirectUrl.searchParams.set(
      'user',
      Buffer.from(JSON.stringify({
        ...tokens.user,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      })).toString('base64url'),
    );

    return res.redirect(redirectUrl.toString());
  }

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Đăng ký tài khoản' })
  async register(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: RegisterDto,
  ) {
    const tokens = await this.authService.register(dto);
    return this.respondWithTokens(req, res, tokens, 'AUTH_REGISTER_SUCCESS');
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập' })
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: LoginDto,
  ) {
    const tokens = await this.authService.login(dto);
    return this.respondWithTokens(req, res, tokens, 'AUTH_LOGIN_SUCCESS');
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('refresh_token')
  @ApiBody({ type: RefreshTokenDto, required: false })
  @ApiOperation({
    summary: 'Rotate refresh token và cấp access token mới',
    description: 'Tự động đọc Refresh Token từ Cookie (trình duyệt Web). Mobile App có thể truyền refreshToken trong Body JSON nếu không dùng Cookie.',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto?: RefreshTokenDto,
  ) {
    const refreshToken = dto?.refreshToken ?? this.readRefreshCookie(req);
    if (!refreshToken) {
      throw new UnauthorizedException('Không tìm thấy Refresh Token trong Cookie hoặc Request Body. Vui lòng đăng nhập lại.');
    }

    const tokens = await this.authService.refresh({ refreshToken });
    return this.respondWithTokens(req, res, tokens, 'AUTH_TOKEN_REFRESHED');
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('refresh_token')
  @ApiBody({ type: RefreshTokenDto, required: false })
  @ApiOperation({ summary: 'Đăng xuất phiên hiện tại' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto?: RefreshTokenDto,
  ) {
    const refreshToken = dto?.refreshToken ?? this.readRefreshCookie(req);
    if (refreshToken) {
      await this.authService.logout({ refreshToken });
    }
    await this.blacklistBearerToken(req);
    this.clearRefreshCookie(res);
    return this.buildResponse(req, 'AUTH_LOGOUT_SUCCESS', 'Đăng xuất thành công', null);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Đăng xuất khỏi tất cả phiên' })
  async logoutAll(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.authService.logoutAll(user.id);
    await this.authService.blacklistAccessToken(user.jti, user.exp);
    this.clearRefreshCookie(res);
    return this.buildResponse(
      req,
      'AUTH_LOGOUT_ALL_SUCCESS',
      'All sessions revoked',
      { revoked: result.revoked },
    );
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Đổi mật khẩu tài khoản' })
  async changePassword(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    const result = await this.authService.changePassword(user.id, dto);
    await this.authService.blacklistAccessToken(user.jti, user.exp);
    return this.buildResponse(req, 'AUTH_CHANGE_PASSWORD_SUCCESS', result.message, null);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Yêu cầu gửi email đặt lại mật khẩu' })
  async forgotPassword(
    @Req() req: Request,
    @Body() dto: ForgotPasswordDto,
  ) {
    const result = await this.authService.forgotPassword(dto);
    return this.buildResponse(req, 'AUTH_FORGOT_PASSWORD_SENT', result.message, null);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đặt lại mật khẩu mới bằng token' })
  async resetPassword(
    @Req() req: Request,
    @Body() dto: ResetPasswordDto,
  ) {
    const result = await this.authService.resetPassword(dto);
    return this.buildResponse(req, 'AUTH_RESET_PASSWORD_SUCCESS', result.message, null);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xác thực tài khoản email bằng token' })
  async verifyEmail(
    @Req() req: Request,
    @Body() dto: VerifyEmailDto,
  ) {
    const result = await this.authService.verifyEmail(dto);
    return this.buildResponse(req, 'AUTH_VERIFY_EMAIL_SUCCESS', result.message, null);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Gửi lại email xác thực' })
  async resendVerification(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.authService.sendEmailVerification(user.id);
    return this.buildResponse(req, 'AUTH_RESEND_VERIFICATION_SENT', result.message, null);
  }

  @Public()
  @Post('clean-tokens')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dọn dẹp các token hết hạn' })
  async cleanTokens(@Req() req: Request) {
    this.assertMaintenanceAccess(req);
    const result = await this.authService.cleanExpiredTokens();
    return this.buildResponse(req, 'AUTH_CLEAN_TOKENS_SUCCESS', 'Cleaned expired tokens', result);
  }

  private respondWithTokens(
    req: Request,
    res: Response,
    tokens: AuthTokens,
    code: string,
  ) {
    this.setRefreshCookie(res, tokens.refreshToken);
    return this.buildResponse(req, code, 'Authentication successful', {
      user: tokens.user,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    });
  }

  private async blacklistBearerToken(req: Request) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return;

    try {
      const payload = await this.tokenService.verifyAccessToken(authHeader.slice('Bearer '.length));
      await this.authService.blacklistAccessToken(payload.jti, payload.exp);
    } catch {
      return;
    }
  }

  private buildResponse<TData>(
    req: Request,
    code: string,
    message: string,
    data: TData,
  ) {
    return {
      success: true,
      code,
      message,
      timestamp: new Date().toISOString(),
      path: req.originalUrl ?? req.url,
      data,
    };
  }

  private readRefreshCookie(req: Request) {
    const value = req.cookies?.[this.getRefreshCookieName()];
    return typeof value === 'string' ? value : undefined;
  }

  private setRefreshCookie(res: Response, token: string) {
    res.cookie(this.getRefreshCookieName(), token, {
      ...this.buildCookieOptions(),
      maxAge: ms(
        (this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '30d') as StringValue,
      ),
    });
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(this.getRefreshCookieName(), this.buildCookieOptions());
  }

  private buildCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure:
        this.config.get<string>('REFRESH_COOKIE_SECURE') === 'true' ||
        this.config.get<string>('NODE_ENV') === 'production',
      sameSite: (this.config.get<string>('REFRESH_COOKIE_SAMESITE') ??
        'lax') as CookieOptions['sameSite'],
      path: this.config.get<string>('REFRESH_COOKIE_PATH') ?? '/api',
    };
  }

  private getRefreshCookieName() {
    return this.config.get<string>('REFRESH_COOKIE_NAME') ?? 'refresh_token';
  }

  private buildGoogleFrontendRedirect() {
    const callback =
      this.config.get<string>('GOOGLE_FRONTEND_CALLBACK_URL') ||
      `${this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000'}/google/callback`;

    return new URL(callback);
  }

  private assertMaintenanceAccess(req: Request) {
    if (this.config.get<string>('NODE_ENV') !== 'production') return;

    const expectedSecret = this.config.get<string>('MAINTENANCE_SECRET');
    const providedSecret = req.headers['x-maintenance-secret'];

    if (
      !expectedSecret ||
      typeof providedSecret !== 'string' ||
      providedSecret !== expectedSecret
    ) {
      throw new ForbiddenException('Maintenance endpoint is not available.');
    }
  }
}
