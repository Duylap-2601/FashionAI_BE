import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../../src/modules/auth/auth.service';
import { PrismaService } from '../../src/database/prisma.service';
import { TokenService } from '../../src/modules/auth/token.service';
import { MailService } from '../../src/modules/mail/mail.service';
import { ConflictException, BadRequestException } from '@nestjs/common';

describe('AuthService', () => {
  let service: AuthService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    passwordResetToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
    emailVerificationToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
    refreshToken: {
      deleteMany: jest.fn(),
    },
  };

  const mockTokenService = {
    generateAccessToken: jest.fn().mockResolvedValue({ token: 'mock_access_token' }),
    generateRefreshToken: jest.fn().mockResolvedValue({ token: 'mock_refresh_token' }),
    consumeRefreshToken: jest.fn(),
    deleteRefreshToken: jest.fn(),
    revokeAllUserRefreshTokens: jest.fn().mockResolvedValue(1),
  };

  const mockMailService = {
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TokenService, useValue: mockTokenService },
        { provide: MailService, useValue: mockMailService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('should throw BadRequestException if passwords do not match', async () => {
      await expect(
        service.register({
          email: 'test@example.com',
          password: 'password123',
          confirmPassword: 'different_password',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException if email is already taken', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: '1', email: 'test@example.com' });
      await expect(
        service.register({
          email: 'test@example.com',
          password: 'password123',
          confirmPassword: 'password123',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
