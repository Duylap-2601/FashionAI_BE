import {
  ConflictException,
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { User, AuthProvider } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { MailService } from '../mail/mail.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/password.dto';
import { TokenService } from './token.service';

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  tier: true,
  role: true,
  isVerified: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly mailService: MailService,
  ) {}

  async register(dto: RegisterDto) {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Mật khẩu xác nhận không khớp');
    }

    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email đã được sử dụng');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        name: dto.name?.trim(),
        measurements: { create: {} },
      },
      select: USER_SELECT,
    });

    // Send email verification
    this.sendEmailVerification(user.id).catch(() => null);

    return this.issueAuthResponse(user);
  }

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    const isValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    return this.issueAuthResponse(this.toPublicUser(user));
  }

  async refresh(dto: RefreshTokenDto) {
    if (!dto.refreshToken) {
      throw new UnauthorizedException('Refresh token không được để trống');
    }
    const payload = await this.tokenService.consumeRefreshToken(dto.refreshToken);
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException('Không tìm thấy người dùng');
    }

    return this.issueAuthResponse(this.toPublicUser(user));
  }

  async logout(dto: RefreshTokenDto) {
    if (dto.refreshToken) {
      await this.tokenService.deleteRefreshToken(dto.refreshToken);
    }
    return { message: 'Đăng xuất thành công' };
  }

  async logoutAll(userId: string) {
    const revoked = await this.tokenService.revokeAllUserRefreshTokens(userId);
    return { message: 'Đã đăng xuất khỏi tất cả phiên', revoked };
  }

  async blacklistAccessToken(jti?: string, exp?: number) {
    if (!jti) return;
    await this.tokenService.blacklistAccessToken(jti, exp);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash) {
      throw new BadRequestException('Tài khoản không hỗ trợ đổi mật khẩu qua hình thức này');
    }

    const isValid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!isValid) {
      throw new BadRequestException('Mật khẩu hiện tại không đúng');
    }

    const newHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });

    await this.tokenService.revokeAllUserRefreshTokens(userId);
    return { message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.' };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Do not reveal email existence
      return { message: 'Nếu email tồn tại trong hệ thống, hướng dẫn đặt lại mật khẩu đã được gửi.' };
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    await this.mailService.sendPasswordResetEmail(user.email, rawToken);

    return { message: 'Nếu email tồn tại trong hệ thống, hướng dẫn đặt lại mật khẩu đã được gửi.' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = crypto.createHash('sha256').update(dto.token).digest('hex');
    const resetRecord = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!resetRecord || resetRecord.expiresAt < new Date()) {
      throw new BadRequestException('Token đặt lại mật khẩu không hợp lệ hoặc đã hết hạn');
    }

    const newHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({
      where: { id: resetRecord.userId },
      data: { passwordHash: newHash },
    });

    await this.prisma.passwordResetToken.deleteMany({
      where: { userId: resetRecord.userId },
    });
    await this.tokenService.revokeAllUserRefreshTokens(resetRecord.userId);

    return { message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại bằng mật khẩu mới.' };
  }

  async sendEmailVerification(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.isVerified) {
      return { message: 'Tài khoản đã được xác thực hoặc không tồn tại.' };
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await this.prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    await this.mailService.sendVerificationEmail(user.email, rawToken);
    return { message: 'Email xác thực đã được gửi.' };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const tokenHash = crypto.createHash('sha256').update(dto.token).digest('hex');
    const verifyRecord = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    });

    if (!verifyRecord || verifyRecord.expiresAt < new Date()) {
      throw new BadRequestException('Token xác thực không hợp lệ hoặc đã hết hạn');
    }

    await this.prisma.user.update({
      where: { id: verifyRecord.userId },
      data: { isVerified: true },
    });

    await this.prisma.emailVerificationToken.deleteMany({
      where: { userId: verifyRecord.userId },
    });

    return { message: 'Xác thực email thành công.' };
  }

  async handleGoogleLogin(googleUser: {
    email: string;
    name?: string;
    avatarUrl?: string;
    providerId: string;
  }) {
    const email = googleUser.email.toLowerCase().trim();
    let user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email,
          name: googleUser.name,
          avatarUrl: googleUser.avatarUrl,
          provider: AuthProvider.GOOGLE,
          providerId: googleUser.providerId,
          isVerified: true,
          measurements: { create: {} },
        },
      });
    } else if (user.provider !== AuthProvider.GOOGLE) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          provider: AuthProvider.GOOGLE,
          providerId: googleUser.providerId,
          isVerified: true,
          avatarUrl: user.avatarUrl ?? googleUser.avatarUrl,
        },
      });
    }

    return this.issueAuthResponse(this.toPublicUser(user));
  }

  async cleanExpiredTokens() {
    const now = new Date();
    const [refresh, reset, verify] = await Promise.all([
      this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.emailVerificationToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    ]);

    return {
      deletedRefreshTokens: refresh.count,
      deletedResetTokens: reset.count,
      deletedVerifyTokens: verify.count,
    };
  }

  private async issueAuthResponse(user: PublicUser) {
    const [accessToken, refreshToken] = await Promise.all([
      this.tokenService.generateAccessToken(user),
      this.tokenService.generateRefreshToken(user.id),
    ]);

    return {
      user,
      accessToken: accessToken.token,
      accessTokenExpiresAt: accessToken.expiresAt.toISOString(),
      refreshToken: refreshToken.token,
      refreshTokenExpiresAt: refreshToken.expiresAt.toISOString(),
    };
  }

  private toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      tier: user.tier,
      role: user.role,
      isVerified: user.isVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}

type PublicUser = Pick<
  User,
  | 'id'
  | 'email'
  | 'name'
  | 'avatarUrl'
  | 'tier'
  | 'role'
  | 'isVerified'
  | 'createdAt'
  | 'updatedAt'
>;
