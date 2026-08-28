# Draft Plan: Cross-Platform Auth Flow (Mobile + Web)

> **Status**: DRAFT v4 - Đã đối chiếu với code thật
> **Created**: 2026-08-26
> **Author**: opencode
> **Last Updated**: 2026-08-28
> **Reviewers**: Architecture Agent, Security Agent, Final Review Agent
> **Progress**: Chưa phase nào hoàn thành. Chỉ `src/modules/auth/types/platform.type.ts` đã tồn tại (untracked).

---

## 1. Mục tiêu

Sửa lại luồng authentication để hỗ trợ cross-platform (Mobile + Web):
- **Mobile**: Refresh token trả trong response body (client tự lưu secure storage)
- **Web**: Refresh token gắn vào HttpOnly cookie (browser tự manage)
- Platform detect bằng custom header `X-Platform` + query param cho OAuth flows

---

## 2. Review Summary

### 2.1 Issues Đã Xử Lý Từ Review

| # | Severity | Issue | Resolution |
|---|----------|-------|------------|
| ARCH-C1 | Critical | Google OAuth mobile flow mất platform sau redirect | Nhúng `platform` vào signed OAuth state tại `SignedStateStore.store()` (xem §5.5) |
| ARCH-C2 | Critical | CORS `allowedHeaders` thiếu `X-Platform` | Thêm `'X-Platform'` vào CORS config |
| ARCH-W1 | Warning | PlatformUtil nên là decorator thay vì service | Dùng `@CurrentPlatform()` param decorator |
| ARCH-W2 | Warning | Sai module registration | Không cần - decorator không cần DI |
| SEC-C1 | Critical | Platform spoofing - web giả mobile để lấy refresh token | Accept risk + thêm security mitigations (rate limit, HSTS, audit log) |
| SEC-C2 | Critical | User PII trong redirect URL (base64 ≠ encryption) | Dùng authorization code exchange pattern |
| SEC-H1 | High | Deep link token exposure qua referrer/logs | Dùng authorization code thay vì raw tokens |
| SEC-H5 | High | Cookie path `/api` quá broad | Thêm section về cookie path optimization |

### 2.2 Issues Chấp Nhận Risk (Không Fix Trong PR Này)

| # | Severity | Issue | Lý Do |
|---|----------|-------|-------|
| SEC-H2 | High | Rate limit chưa cover `/auth/refresh`, `/auth/logout`, `/auth/exchange` | `rate-limit.guard.ts:63-68` chỉ cover login/register/forgot-password/reset-password/resend-verification. Ba endpoint kia chỉ có global 100 req/60s. Thêm vào `isAuthSensitive` là 3 dòng — cân nhắc làm luôn ở Phase 2 |
| SEC-H3 | High | Không có CSRF protection trên refresh/logout | SameSite=Lax đủ cho threat model hiện tại, theo dõi sau |
| SEC-H4 | High | Timing attack trên maintenance secret | Low risk, fix trong hardening PR riêng |
| SEC-M1 | Medium | Không có platform binding trong refresh token | v3 ghi là đã fix nhưng thực tế không có spec: `RefreshTokenPayload` (`jwt-payload.type.ts:18`) và `generateRefreshToken` (`token.service.ts:52`) không đổi. Defer sang PR riêng |
| SEC-M4 | Medium | Không có password complexity validation | Follow scope, track as follow-up |
| — | Medium | HSTS + audit logging (§4.4) chưa có spec ở §5 lẫn checklist | Defer sang hardening PR |

---

## 3. Current State Analysis

### 3.1 Auth Flow Hiện Tại

| Endpoint | Behavior hiện tại |
|---|---|
| `POST /auth/login` | Luôn set refresh token cookie, KHÔNG trả refresh token trong body |
| `POST /auth/register` | Tương tự login |
| `POST /auth/refresh` | Đọc từ cookie OR body, luôn set cookie mới |
| `GET /auth/google` | Redirect đến Google với state (HMAC-signed) |
| `GET /auth/google/callback` | Luôn set cookie, redirect URL với access token + user data |
| `POST /auth/logout` | Luôn clear cookie |
| `POST /auth/logout-all` | Luôn clear cookie + revoke all tokens |

### 3.2 Vấn Đề Cần Giải Quyết

1. Mobile app không dùng được cookie → không lấy được refresh token
2. Google OAuth redirect không có deep link cho mobile
3. Không có platform detection mechanism
4. User PII (email, role, tier) bị leak trong redirect URL qua base64 encoding

### 3.3 Files Liên Quan

```
src/modules/auth/
├── auth.controller.ts          # Main controller (344 lines)
├── auth.service.ts             # Business logic (322 lines)
├── token.service.ts            # JWT generation + refresh rotation
├── auth.module.ts              # Module wiring (đã import RedisModule sẵn)
├── dto/
│   ├── login.dto.ts            # Login request
│   ├── register.dto.ts         # Register request
│   ├── refresh-token.dto.ts    # Refresh token body
│   └── exchange.dto.ts         # ← MỚI: Auth code exchange (mobile)
├── strategies/
│   ├── jwt.strategy.ts         # JWT Passport strategy
│   ├── google.strategy.ts      # Google OAuth strategy ← SỬA: passReqToCallback + đọc platform từ state
│   └── signed-state.store.ts   # HMAC-signed OAuth state ← SỬA: nhúng platform vào state
├── services/
│   └── auth-code.service.ts    # ← MỚI: authorization code cho mobile
├── guards/
│   ├── jwt-auth.guard.ts       # JWT auth guard
│   └── local-auth.guard.ts     # Local auth guard
├── types/
│   ├── jwt-payload.type.ts     # JWT payload types
│   └── platform.type.ts        # ← ĐÃ TỒN TẠI (untracked), có normalizePlatform()
└── constants/
    └── index.ts                # TOKEN_TYPES

src/common/decorators/
├── current-user.decorator.ts   # @CurrentUser() pattern
├── public.decorator.ts         # @Public() pattern
├── roles.decorator.ts          # @Roles() pattern
└── current-platform.decorator.ts  # ← MỚI

src/common/services/redis.service.ts   # RedisService thật ở ĐÂY (không phải common/redis/)
src/common/redis/redis.module.ts       # RedisModule export RedisService
src/common/guards/rate-limit.guard.ts  # isAuthSensitive list, line 63-68

src/main.ts                     # CORS config (line 38)
```

---

## 4. Giải Pháp

### 4.1 Platform Detection

**Approach**: Dual mechanism
1. **API endpoints** (login, register, refresh, logout): Custom header `X-Platform: mobile | web`
2. **OAuth flows** (Google): Query param `?platform=mobile` ở request khởi tạo, được **nhúng vào signed OAuth state** để survive qua vòng redirect của Google

- Header name: `X-Platform`
- Values: `mobile` | `web`
- Default: `web` (nếu không gửi header hoặc invalid value) — fail-closed, xem `normalizePlatform()`

> **Tại sao OAuth không dùng được query param trực tiếp**: `?platform=mobile` chỉ tồn tại ở
> request khởi tạo `GET /auth/google`. Google redirect về `GOOGLE_CALLBACK_URL` chỉ mang
> `?code=...&state=...`, và `redirect_uri` phải khớp chính xác với Google Console nên không
> thể thêm param. `validate()` của strategy chạy trong request callback đó, nên
> `req.query.platform` ở đó luôn `undefined`. State là kênh duy nhất mang được platform.

### 4.2 Response Strategy

| Platform | Login/Register Response | Refresh Response | Cookie Behavior |
|---|---|---|---|
| **Mobile** | Body: `{ user, accessToken, refreshToken, refreshTokenExpiresAt }` | Body: `{ accessToken, refreshToken, ... }` | Không set cookie |
| **Web** | Body: `{ user, accessToken }` + Set-Cookie | Body: `{ accessToken }` + Set-Cookie | Set HttpOnly cookie |

### 4.3 Google OAuth Flow (Authorization Code Pattern)

| Platform | Initiation | Callback |
|---|---|---|
| **Web** | `GET /auth/google` → Google login | Set cookie + Redirect về `FRONTEND_URL/google/callback?accessToken=...&user=minified` |
| **Mobile** | `GET /auth/google?platform=mobile` → Google login | Tạo auth code → Redirect về `MOBILE_GOOGLE_CALLBACK_URL?code=...` → Mobile gọi `POST /auth/exchange` để lấy tokens |

**Authorization Code Flow cho Mobile:**
1. Mobile mở browser: `GET /api/auth/google?platform=mobile`
2. Google callback: `GET /api/auth/google/callback?state=...`
3. Server tạo short-lived auth code (5 phút), lưu trong Redis `{ code → { userId, tokens } }`
4. Redirect về deep link: `myapp://auth?code=abc123`
5. Mobile nhận code, gọi `POST /api/auth/exchange { code }` → Nhận `{ user, accessToken, refreshToken }`

### 4.4 Security Mitigations

| Mitigation | Mô tả | Trạng thái |
|---|---|---|
| **Rate limiting** | `RateLimitGuard` global 100 req/60s. Auth-sensitive 10 req/60s chỉ áp cho login/register/forgot-password/reset-password/resend-verification (`rate-limit.guard.ts:63-68`) | Có phần — refresh/logout/exchange chưa cover |
| **HSTS** | Thêm `Strict-Transport-Security` header trong production | Chưa spec — defer, xem §2.2 |
| **Audit logging** | Thêm structured log cho login/refresh/logout failures | Chưa spec — defer, xem §2.2 |
| **Cookie hardening** | Giữ HttpOnly + Secure + SameSite=Lax, path `/api` là hợp lý (covers all auth endpoints) | Đã có sẵn (`auth.controller.ts:306-316`) |

---

## 5. Chi Tiết Thay Đổi

### 5.1 File Mới: `src/common/decorators/current-platform.decorator.ts`

Thay vì `@Injectable()` service, dùng param decorator (following `@CurrentUser()` pattern).
Dùng lại `normalizePlatform()` đã có trong `platform.type.ts` thay vì viết lặp logic:

```typescript
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
```

**Usage**: `@CurrentPlatform() platform: Platform` — không cần inject service.

> Decorator luôn trả về một `Platform` hợp lệ, không bao giờ `undefined`. Ở signature
> controller nên khai báo `platform: Platform` (không có `?`) cho khỏi gây hiểu nhầm.

### 5.2 File Đã Tồn Tại: `src/modules/auth/types/platform.type.ts`

File này đã có trong working tree (untracked), **không cần tạo lại**. Nội dung hiện tại:

```typescript
export type Platform = 'mobile' | 'web';

export const PLATFORM_HEADER = 'x-platform' as const;
export const DEFAULT_PLATFORM: Platform = 'web';

// Fail-closed: mọi giá trị không phải đúng 'mobile' (thiếu, string[] do query param
// lặp, rác) đều thành 'web', tức refresh token đi vào HttpOnly cookie chứ không lộ
// ra response body.
export function normalizePlatform(raw: unknown): Platform {
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'mobile'
    ? 'mobile'
    : DEFAULT_PLATFORM;
}
```

### 5.3 File Mới: `src/modules/auth/services/auth-code.service.ts`

Authorization code service cho mobile OAuth exchange:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { RedisService } from '../../../common/services/redis.service';

const AUTH_CODE_TTL = 300; // 5 minutes
const AUTH_CODE_PREFIX = 'auth_code:';

interface AuthCodePayload {
  user: Record<string, unknown>; // full user object, giữ contract giống login
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

@Injectable()
export class AuthCodeService {
  private readonly logger = new Logger(AuthCodeService.name);

  constructor(private readonly redis: RedisService) {}

  async createCode(payload: AuthCodePayload): Promise<string> {
    const health = await this.redis.health();
    if (health.mode !== 'redis') {
      // Fallback in-memory là per-process: nhiều instance thì exchange sẽ fail
      // ngẫu nhiên tùy request rơi vào instance nào. Log to để không debug mù.
      this.logger.warn(
        'AuthCodeService đang chạy trên in-memory fallback. OAuth mobile sẽ không đáng tin nếu deploy nhiều instance.',
      );
    }

    const code = randomBytes(32).toString('hex');
    await this.redis.set(
      `${AUTH_CODE_PREFIX}${code}`,
      JSON.stringify(payload),
      AUTH_CODE_TTL,
    );
    return code;
  }

  async consumeCode(code: string): Promise<AuthCodePayload | null> {
    const key = `${AUTH_CODE_PREFIX}${code}`;
    const data = await this.redis.get(key);
    if (!data) return null;
    await this.redis.del(key); // one-time use
    return JSON.parse(data) as AuthCodePayload;
  }
}
```

> **Import path**: `RedisService` nằm ở `src/common/services/redis.service.ts`
> (không phải `common/redis/`). `RedisModule` ở `src/common/redis/redis.module.ts`
> đã export nó, và `AuthModule` đã import `RedisModule` sẵn — chỉ cần thêm provider.

### 5.4 Sửa: `src/modules/auth/auth.controller.ts`

#### 5.4.1 Thêm import

```typescript
import { ApiQuery } from '@nestjs/swagger';
import { CurrentPlatform } from '../../common/decorators/current-platform.decorator';
import { Platform } from './types/platform.type';
import { AuthCodeService } from './services/auth-code.service';
import { readPlatformFromState } from './strategies/signed-state.store';
```

> Controller nằm ở `src/modules/auth/`, nên `common/` là `../../common/`, còn các file
> trong cùng module là `./` (không phải `../` như v3 ghi).

#### 5.4.2 Thêm constructor param

```typescript
constructor(
  private readonly authService: AuthService,
  private readonly config: ConfigService,
  private readonly tokenService: TokenService,
  private readonly authCodeService: AuthCodeService,  // ← THÊM
) {}
```

#### 5.4.3 Sửa `respondWithTokens` (line 262-274)

```typescript
private respondWithTokens(
  req: Request,
  res: Response,
  tokens: AuthTokens,
  code: string,
  platform: Platform,
) {
  if (platform === 'mobile') {
    // Mobile: trả refresh token trong body, KHÔNG set cookie
    return buildApiResponse(req, code, 'Authentication successful', {
      user: tokens.user,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshToken: tokens.refreshToken,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    });
  }

  // Web: set cookie, KHÔNG trả refresh token trong body
  this.setRefreshCookie(res, tokens.refreshToken);
  return buildApiResponse(req, code, 'Authentication successful', {
    user: tokens.user,
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
  });
}
```

#### 5.4.4 Sửa `login` endpoint (line 111-122)

```typescript
@Public()
@Post('login')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Đăng nhập' })
async login(
  @Req() req: Request,
  @Res({ passthrough: true }) res: Response,
  @Body() dto: LoginDto,
  @CurrentPlatform() platform: Platform,
) {
  const tokens = await this.authService.login(dto);
  return this.respondWithTokens(req, res, tokens, 'AUTH_LOGIN_SUCCESS', platform);
}
```

#### 5.4.5 Sửa `register` endpoint (line 99-109)

```typescript
@Public()
@Post('register')
@ApiOperation({ summary: 'Đăng ký tài khoản' })
async register(
  @Req() req: Request,
  @Res({ passthrough: true }) res: Response,
  @Body() dto: RegisterDto,
  @CurrentPlatform() platform: Platform,
) {
  const tokens = await this.authService.register(dto);
  return this.respondWithTokens(req, res, tokens, 'AUTH_REGISTER_SUCCESS', platform);
}
```

#### 5.4.6 Sửa `refresh` endpoint (line 124-145)

```typescript
@Public()
@Post('refresh')
@HttpCode(HttpStatus.OK)
@ApiCookieAuth('refresh_token')
@ApiBody({ type: RefreshTokenDto, required: false })
@ApiOperation({
  summary: 'Rotate refresh token và cấp access token mới',
  description: 'Web: đọc từ Cookie. Mobile: truyền refreshToken trong Body + header X-Platform.',
})
async refresh(
  @Req() req: Request,
  @Res({ passthrough: true }) res: Response,
  @CurrentPlatform() platform: Platform,
  @Body() dto?: RefreshTokenDto,
) {
  const refreshToken = dto?.refreshToken ?? this.readRefreshCookie(req);

  if (!refreshToken) {
    throw new UnauthorizedException('Không tìm thấy Refresh Token. Vui lòng đăng nhập lại.');
  }

  const tokens = await this.authService.refresh({ refreshToken });

  if (platform === 'mobile') {
    return buildApiResponse(req, 'AUTH_TOKEN_REFRESHED', 'Token refreshed', {
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshToken: tokens.refreshToken,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    });
  }

  // Web: set cookie
  this.setRefreshCookie(res, tokens.refreshToken);
  return buildApiResponse(req, 'AUTH_TOKEN_REFRESHED', 'Token refreshed', {
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
  });
}
```

#### 5.4.7 Sửa `googleAuth` endpoint (line 60-66) - Khai báo platform query param

```typescript
@Public()
@Get('google')
@UseGuards(AuthGuard('google'))
@ApiOperation({
  summary: 'Redirect to Google OAuth login',
  description: 'Mobile gọi với ?platform=mobile. Param được nhúng vào signed OAuth state.',
})
@ApiQuery({ name: 'platform', enum: ['mobile', 'web'], required: false })
async googleAuth() {
  return;
}
```

> **Lưu ý**: handler này **không bao giờ chạy** — `AuthGuard('google')` redirect sang
> Google trước đó. Không cần `@Query('platform')` ở đây; việc đọc param xảy ra trong
> `SignedStateStore.store(req, ...)` (§5.5), nơi passport truyền vào `req` của request
> khởi tạo. `@ApiQuery` chỉ để Swagger hiển thị đúng.

#### 5.4.8 Sửa `googleCallback` (line 68-97)

```typescript
@Public()
@Get('google/callback')
@UseGuards(AuthGuard('google'))
@ApiOperation({ summary: 'Google OAuth callback' })
async googleCallback(
  @Req() req: Request & { user?: GoogleOAuthUser & { platform?: Platform } },
  @Res({ passthrough: true }) res: Response,
  @Query('error') error?: string,
) {
  if (error || !req.user) {
    // req.user không có khi guard fail → không đọc được platform từ validate().
    // Parse trực tiếp từ signed state trong query (cùng hàm dùng ở strategy).
    const platform = readPlatformFromState(req.query?.state);
    if (platform === 'mobile') {
      const errorUrl = this.buildMobileCallbackUrl();
      errorUrl.searchParams.set('error', error || 'google_auth_failed');
      return res.redirect(errorUrl.toString());
    }
    const redirectUrl = this.buildGoogleFrontendRedirect();
    redirectUrl.searchParams.set('error', error || 'google_auth_failed');
    return res.redirect(redirectUrl.toString());
  }

  // Passport puts validate() return into req.user, including platform field
  const platform = req.user.platform ?? 'web';
  const tokens = await this.authService.handleGoogleLogin(req.user);

  if (platform === 'mobile') {
    // Mobile: tạo authorization code, redirect deep link với code
    const code = await this.authCodeService.createCode({
      user: tokens.user,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    });
    const redirectUrl = this.buildMobileCallbackUrl();
    redirectUrl.searchParams.set('code', code);
    return res.redirect(redirectUrl.toString());
  }

  // Web: set cookie + redirect với tokens (giữ nguyên behavior)
  this.setRefreshCookie(res, tokens.refreshToken);
  const redirectUrl = this.buildGoogleFrontendRedirect();
  redirectUrl.searchParams.set('accessToken', tokens.accessToken);
  redirectUrl.searchParams.set(
    'user',
    Buffer.from(JSON.stringify({
      id: tokens.user.id,
      email: tokens.user.email,
      name: tokens.user.name,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    })).toString('base64url'),
  );
  return res.redirect(redirectUrl.toString());
}

private buildMobileCallbackUrl() {
  return new URL(
    this.config.get<string>('MOBILE_GOOGLE_CALLBACK_URL') || 'myapp://auth',
  );
}
```

> `readPlatformFromState()` là helper export từ `signed-state.store.ts` (§5.5). **Không**
> dùng `state.includes('mobile')`: state là 3 phần nối bằng `.` và phần nonce/HMAC là
> base64url, một chuỗi random hoàn toàn có thể chứa substring `mobile` một cách tình cờ.

#### 5.4.9 Thêm `exchange` endpoint MỚI

**File mới: `src/modules/auth/dto/exchange.dto.ts`**
```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ExchangeDto {
  @ApiProperty({ description: 'Authorization code từ Google OAuth redirect' })
  @IsString()
  code!: string;
}
```

**Endpoint:**
```typescript
@Public()
@Post('exchange')
@HttpCode(HttpStatus.OK)
@ApiOperation({
  summary: 'Đổi authorization code lấy tokens (cho mobile)',
  description: 'Mobile app nhận code từ Google OAuth redirect, gọi endpoint này để lấy tokens. Code dùng một lần, TTL 5 phút.',
})
async exchange(
  @Req() req: Request,
  @Body() dto: ExchangeDto,
) {
  const payload = await this.authCodeService.consumeCode(dto.code);
  if (!payload) {
    throw new UnauthorizedException('Invalid or expired authorization code');
  }

  return buildApiResponse(req, 'AUTH_EXCHANGE_SUCCESS', 'Tokens exchanged', {
    user: payload.user,
    accessToken: payload.accessToken,
    accessTokenExpiresAt: payload.accessTokenExpiresAt,
    refreshToken: payload.refreshToken,
    refreshTokenExpiresAt: payload.refreshTokenExpiresAt,
  });
}
```

> **Contract**: trả về **full user object**, giống `login`/`register` với `X-Platform: mobile`.
> v3 chỉ trả `{ id }`, buộc mobile phải gọi thêm một request nữa mới có `tier`/`role`.

#### 5.4.10 Sửa `logout` (line 147-165)

```typescript
@Public()
@Post('logout')
@HttpCode(HttpStatus.OK)
@ApiCookieAuth('refresh_token')
@ApiBody({ type: RefreshTokenDto, required: false })
@ApiOperation({ summary: 'Đăng xuất phiên hiện tại' })
async logout(
  @Req() req: Request,
  @Res({ passthrough: true }) res: Response,
  @CurrentPlatform() platform: Platform,
  @Body() dto?: RefreshTokenDto,
) {
  const refreshToken = dto?.refreshToken ?? this.readRefreshCookie(req);

  if (refreshToken) {
    await this.authService.logout({ refreshToken });
  }
  await this.blacklistBearerToken(req);

  if (platform !== 'mobile') {
    this.clearRefreshCookie(res);
  }

  return buildApiResponse(req, 'AUTH_LOGOUT_SUCCESS', 'Đăng xuất thành công', null);
}
```

#### 5.4.11 Sửa `logoutAll` (line 167-186)

```typescript
@Post('logout-all')
@HttpCode(HttpStatus.OK)
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
@ApiOperation({ summary: 'Đăng xuất khỏi tất cả phiên' })
async logoutAll(
  @Req() req: Request,
  @Res({ passthrough: true }) res: Response,
  @CurrentUser() user: AuthenticatedUser,
  @CurrentPlatform() platform: Platform,
) {
  const result = await this.authService.logoutAll(user.id);
  await this.authService.blacklistAccessToken(user.jti, user.exp);

  if (platform !== 'mobile') {
    this.clearRefreshCookie(res);
  }

  return buildApiResponse(
    req,
    'AUTH_LOGOUT_ALL_SUCCESS',
    'All sessions revoked',
    { revoked: result.revoked },
  );
}
```

### 5.5 Sửa: `src/modules/auth/strategies/signed-state.store.ts`

Đây là thay đổi cốt lõi của Phase 3, và là phần **v3 thiếu hoàn toàn**.

Passport gọi `store(req, meta, callback)` với `req` của request khởi tạo
(`passport-oauth2/lib/strategy.js:295`), nên đây là điểm duy nhất còn thấy được
`?platform=mobile`. Nhúng nó vào payload **trước khi** HMAC để không ai sửa được.

State format đổi từ `nonce.issuedAt.hmac` thành `nonce.issuedAt.platform.hmac`.

```typescript
import { normalizePlatform, Platform } from '../types/platform.type';

const SEPARATOR = '.';

// Export riêng để controller đọc được platform ở nhánh guard fail (khi req.user
// không tồn tại nên validate() chưa từng chạy). Không verify HMAC ở đây: giá trị
// chỉ dùng để chọn URL redirect lỗi, không cấp quyền gì.
export function readPlatformFromState(rawState: unknown): Platform {
  if (typeof rawState !== 'string') return 'web';
  const parts = rawState.split(SEPARATOR);
  if (parts.length !== 4) return 'web';
  return normalizePlatform(parts[2]);
}
```

Trong class `SignedStateStore`:

```typescript
store(req: Request, meta: unknown, callback: StoreCallback): void {
  try {
    const nonce = crypto.randomBytes(16).toString('base64url');
    const issuedAt = Math.floor(Date.now() / 1000).toString(36);
    const platform = normalizePlatform(req.query?.platform);
    const payload = `${nonce}${SEPARATOR}${issuedAt}${SEPARATOR}${platform}`;

    callback(null, `${payload}${SEPARATOR}${this.sign(payload)}`);
  } catch (err) {
    callback(
      err instanceof Error ? err : new Error('Không thể tạo OAuth state'),
    );
  }
}
```

Và `verify()` phải parse 4 phần thay vì 3:

```typescript
verify(
  req: Request,
  providedState: string,
  meta: unknown,
  callback: VerifyCallback,
): void {
  if (typeof providedState !== 'string' || !providedState) {
    return callback(null, false, {
      message: 'Thiếu OAuth state. Vui lòng đăng nhập lại.',
    });
  }

  const parts = providedState.split(SEPARATOR);
  if (parts.length !== 4) {
    return callback(null, false, { message: 'OAuth state không hợp lệ.' });
  }

  const [nonce, issuedAt, platform, signature] = parts;
  const payload = `${nonce}${SEPARATOR}${issuedAt}${SEPARATOR}${platform}`;

  if (!this.timingSafeEqual(this.sign(payload), signature)) {
    return callback(null, false, { message: 'OAuth state không hợp lệ.' });
  }

  // ... phần check issuedAt / TTL giữ nguyên
  callback(null, true, providedState);
}
```

> **Quan trọng**: `callback(null, true, providedState)` ở nhánh thành công **không**
> truyền state vào verify callback của strategy. `passport-oauth2/lib/strategy.js:160-164`
> chỉ dùng tham số thứ 3 ở nhánh `self.fail(state, 403)`. Nên `validate()` phải tự parse
> `req.query.state`, không thể trông vào giá trị store trả về.

> **Backward compat**: state cũ (3 phần) sẽ fail verify sau khi deploy. Vòng OAuth chỉ
> sống `GOOGLE_OAUTH_STATE_TTL` (300s theo `.env.example`), nên tác động là một số user
> đang login dở phải bấm lại. Không cần shim.

### 5.6 Sửa: `src/modules/auth/strategies/google.strategy.ts`

Hai thay đổi:

**1. Bật `passReqToCallback` trong `super({...})`** — đây là option của *strategy*,
không phải của `PassportModule.register()` (v3 ghi sai chỗ này):

```typescript
super({
  clientID: clientID || 'mock_client_id',
  clientSecret: clientSecret || 'mock_client_secret',
  callbackURL: /* ... giữ nguyên */,
  scope: ['email', 'profile'],
  passReqToCallback: true,   // ← THÊM
  store: new SignedStateStore({ /* ... giữ nguyên */ }),
} as never);
```

**2. Đổi signature `validate()`** — thêm `req` vào đầu và đọc platform từ state:

```typescript
async validate(
  req: Request,
  accessToken: string,
  refreshToken: string,
  profile: any,
  done: VerifyCallback,
): Promise<any> {
  const { id, name, emails, photos } = profile;
  const email = emails?.[0]?.value;

  if (!email) {
    return done(new Error('Tài khoản Google không cung cấp email.'), undefined);
  }

  done(null, {
    providerId: id,
    email,
    name: `${name?.givenName || ''} ${name?.familyName || ''}`.trim(),
    avatarUrl: photos?.[0]?.value ?? null,
    accessToken,
    platform: readPlatformFromState(req.query?.state),  // ← THÊM
  });
}
```

> **Tại sao arity 5**: `PassportStrategy(Strategy, 'google')` không truyền
> `callbackArity`, nên NestJS mixin để `callback.length = 0`. Trong
> `passport-oauth2/lib/strategy.js:193-198`, nhánh `passReqToCallback` kiểm tra
> `arity == 6` rồi mới fallback sang 5 — với arity 0 nó rơi vào nhánh 5, tức gọi
> `_verify(req, accessToken, refreshToken, profile, verified)`. Khớp đúng signature trên.
> Bỏ `passReqToCallback` mà giữ signature này sẽ làm `req` nhận giá trị `accessToken`.

### 5.7 Sửa: `src/modules/auth/auth.module.ts`

```typescript
import { AuthCodeService } from './services/auth-code.service';

@Module({
  imports: [PassportModule, JwtModule.register({}), RedisModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    JwtStrategy,
    GoogleStrategy,
    AuthCodeService,  // ← THÊM (RedisModule đã import sẵn)
  ],
  exports: [AuthService, TokenService],
})
```

### 5.8 Sửa: `src/main.ts` (CORS)

```typescript
// Current (line 38):
allowedHeaders: ['Content-Type', 'Authorization'],

// New:
allowedHeaders: ['Content-Type', 'Authorization', 'X-Platform'],
```

> Chỉ cần cho web browser (preflight). App mobile native không làm CORS preflight,
> nên thay đổi này không ảnh hưởng luồng mobile — nhưng vẫn cần nếu web client
> gửi `X-Platform: web` tường minh.

### 5.9 Sửa: `.env.example`

```env
# === Cross-Platform Auth ===
# Mobile deep link callback URL for Google OAuth
# Ưu tiên App Links / Universal Links (https://) hơn custom scheme — xem §11
MOBILE_GOOGLE_CALLBACK_URL=myapp://auth
```

---

## 6. API Contract Mới

### 6.1 Login - Mobile

```http
POST /api/auth/login
Content-Type: application/json
X-Platform: mobile

{ "email": "user@example.com", "password": "xxx" }
```

**Response 200:**
```json
{
  "statusCode": 200,
  "code": "AUTH_LOGIN_SUCCESS",
  "message": "Authentication successful",
  "data": {
    "user": { "id": "...", "email": "...", "name": "...", "tier": "FREE", "role": "USER", ... },
    "accessToken": "eyJ...",
    "accessTokenExpiresAt": "2026-08-26T01:00:00.000Z",
    "refreshToken": "eyJ...",
    "refreshTokenExpiresAt": "2026-09-25T00:55:00.000Z"
  }
}
```

### 6.2 Login - Web

```http
POST /api/auth/login
Content-Type: application/json

{ "email": "user@example.com", "password": "xxx" }
```

**Response 200:**
```json
{
  "statusCode": 200,
  "code": "AUTH_LOGIN_SUCCESS",
  "message": "Authentication successful",
  "data": {
    "user": { "id": "...", "email": "...", "name": "...", "tier": "FREE", "role": "USER", ... },
    "accessToken": "eyJ...",
    "accessTokenExpiresAt": "2026-08-26T01:00:00.000Z"
  }
}
```
```
Set-Cookie: refresh_token=eyJ...; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=2592000
```

### 6.3 Refresh - Mobile

```http
POST /api/auth/refresh
Content-Type: application/json
X-Platform: mobile

{ "refreshToken": "eyJ..." }
```

**Response 200:**
```json
{
  "statusCode": 200,
  "code": "AUTH_TOKEN_REFRESHED",
  "message": "Token refreshed",
  "data": {
    "accessToken": "eyJ...(new)",
    "accessTokenExpiresAt": "2026-08-26T01:15:00.000Z",
    "refreshToken": "eyJ...(new)",
    "refreshTokenExpiresAt": "2026-09-25T00:55:00.000Z"
  }
}
```

### 6.4 Refresh - Web

```http
POST /api/auth/refresh
Cookie: refresh_token=eyJ...
```

**Response 200:**
```json
{
  "statusCode": 200,
  "code": "AUTH_TOKEN_REFRESHED",
  "message": "Token refreshed",
  "data": {
    "accessToken": "eyJ...(new)",
    "accessTokenExpiresAt": "2026-08-26T01:15:00.000Z"
  }
}
```
```
Set-Cookie: refresh_token=eyJ...(new); HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=2592000
```

### 6.5 Google OAuth - Mobile Initiation

```http
GET /api/auth/google?platform=mobile
```

### 6.6 Google OAuth - Mobile Callback

```
Redirect: myapp://auth?code=abc123def456...
```

### 6.7 Exchange Code for Tokens (Mobile)

```http
POST /api/auth/exchange
Content-Type: application/json

{ "code": "abc123def456..." }
```

**Response 200:**
```json
{
  "statusCode": 200,
  "code": "AUTH_EXCHANGE_SUCCESS",
  "message": "Tokens exchanged",
  "data": {
    "user": { "id": "...", "email": "...", "name": "...", "tier": "FREE", "role": "USER" },
    "accessToken": "eyJ...",
    "accessTokenExpiresAt": "...",
    "refreshToken": "eyJ...",
    "refreshTokenExpiresAt": "..."
  }
}
```

---

## 7. Cấu Hình Env Mới

| Variable | Mô tả | Default |
|---|---|---|
| `MOBILE_GOOGLE_CALLBACK_URL` | Deep link URL cho mobile Google OAuth | `myapp://auth` |

---

## 8. Endpoints Không Cần Thay Đổi

| Endpoint | Lý Do |
|---|---|
| `POST /auth/change-password` | Đã blacklist + revoke all tokens, không set cookie |
| `POST /auth/forgot-password` | Không phát hành tokens, không set cookie |
| `POST /auth/reset-password` | Không phát hành tokens, revoke all tokens |
| `POST /auth/verify-email` | Không phát hành tokens |
| `POST /auth/resend-verification` | Không phát hành tokens |
| `POST /auth/clean-tokens` | Maintenance endpoint, không affect user flow |

---

## 9. Mobile Client Responsibilities

| Responsibility | Mô tả |
|---|---|
| **Token storage** | Lưu refresh token trong secure storage (iOS: Keychain, Android: EncryptedSharedPreferences) |
| **Header sending** | Luôn gửi `X-Platform: mobile` header trong mọi request |
| **Token cleanup on logout** | Xóa tokens khỏi local storage sau khi gọi logout API |
| **Auth code exchange** | Sau khi Google OAuth redirect với `?code=...`, gọi `POST /auth/exchange` để lấy tokens |
| **Token refresh** | Gọi `POST /auth/refresh` với refresh token trong body khi access token hết hạn |
| **Browser cho OAuth** | Dùng `ASWebAuthenticationSession` (iOS) / Chrome Custom Tabs (Android), không WebView nhúng |

> **Failure mode dễ gặp nhất**: quên gửi `X-Platform: mobile` ở `login`/`register` →
> API trả 200 nhưng **không có** `refreshToken` trong body, app chạy bình thường cho tới
> khi access token hết hạn rồi logout không rõ lý do. Nên có integration test assert
> `data.refreshToken` tồn tại khi gửi header mobile.

---

## 10. Timeline / Checklist

### Phase 1: Core Platform Detection
- [x] Tạo `src/modules/auth/types/platform.type.ts` (đã có, untracked — cần commit)
- [ ] Tạo `src/common/decorators/current-platform.decorator.ts` (dùng `normalizePlatform()`)
- [ ] Sửa `src/main.ts` CORS - thêm `X-Platform`
- [ ] Sửa `respondWithTokens` trong `auth.controller.ts`
- [ ] Sửa `login` endpoint
- [ ] Sửa `register` endpoint

### Phase 2: Refresh & Logout
- [ ] Sửa `refresh` endpoint
- [ ] Sửa `logout` endpoint
- [ ] Sửa `logoutAll` endpoint
- [ ] (Tùy chọn, 3 dòng) Thêm `/auth/refresh` + `/auth/logout` vào `isAuthSensitive` trong `rate-limit.guard.ts`

### Phase 3: Google OAuth Mobile
> Thứ tự bắt buộc: state store **trước**, strategy sau, controller sau cùng.

- [ ] Sửa `signed-state.store.ts` - nhúng `platform` vào state (4 phần), export `readPlatformFromState()`
- [ ] Sửa `verify()` trong state store - parse 4 phần
- [ ] Sửa `google.strategy.ts` - `passReqToCallback: true` trong `super()`
- [ ] Sửa `google.strategy.ts` - signature `validate(req, accessToken, refreshToken, profile, done)` + đọc platform từ `req.query.state`
- [ ] Tạo `src/modules/auth/services/auth-code.service.ts` (import từ `common/services/redis.service`)
- [ ] Tạo `src/modules/auth/dto/exchange.dto.ts`
- [ ] Sửa `googleAuth` endpoint - thêm `@ApiQuery({ name: 'platform' })`
- [ ] Sửa `googleCallback` endpoint - authorization code pattern + error path dùng `readPlatformFromState()`
- [ ] Thêm `buildMobileCallbackUrl()` helper
- [ ] Thêm `exchange` endpoint (trả full user object)
- [ ] Đăng ký `AuthCodeService` trong `auth.module.ts`
- [ ] Thêm `MOBILE_GOOGLE_CALLBACK_URL` vào `.env.example`
- [ ] (Tùy chọn) Thêm `/auth/exchange` vào `isAuthSensitive`

### Phase 4: Documentation & Testing
- [ ] Cập nhật Swagger `@ApiOperation` descriptions
- [ ] Viết unit test cho `@CurrentPlatform()` decorator (bao gồm case `string[]` và giá trị rác)
- [ ] Viết unit test cho `AuthCodeService` (one-time use: consume lần 2 phải trả `null`)
- [ ] Viết unit test cho `SignedStateStore` round-trip: `store()` với `?platform=mobile` → `verify()` pass → `readPlatformFromState()` trả `'mobile'`
- [ ] Viết unit test cho state cũ 3 phần → `verify()` fail
- [ ] Integration test: login `X-Platform: mobile` phải có `data.refreshToken`, web phải **không** có
- [ ] Test manual: login mobile vs web
- [ ] Test manual: refresh mobile vs web
- [ ] Test manual: Google OAuth mobile vs web (kiểm tra deep link thật nhận được `?code=`)
- [ ] Test manual: logout mobile vs web
- [ ] Chạy `npm run lint`
- [ ] Chạy `npm run build`

---

## 11. Review Notes

### Architecture Review (v1 → v2 Changes)
- ✅ Fixed: Google OAuth mobile flow bằng authorization code pattern
- ✅ Fixed: CORS thêm `X-Platform` header
- ✅ Changed: `PlatformUtil` service → `@CurrentPlatform()` decorator
- ✅ Fixed: Module registration không cần nữa

### Security Review (v1 → v2 Changes)
- ✅ Fixed: User PII leak - minimal user data trong web redirect, authorization code cho mobile
- ✅ Fixed: Deep link token exposure - dùng auth code thay vì raw tokens
- ✅ Added: Security mitigations section
- ✅ Added: Endpoints không cần thay đổi section
- ⚠️ Accepted: Platform spoofing risk (mitigated by rate limiting + HSTS)
- ⚠️ Accepted: CSRF on refresh/logout (SameSite=Lax sufficient)
- ⚠️ Deferred: Timing attack on maintenance secret
- ⚠️ Deferred: Password complexity validation

### Final Review (v2 → v3 Changes)
- ✅ Fixed: `req.authState` → `req.user.platform` (Passport puts validate() return into req.user)
- ✅ Fixed: Cookie path consistency - giữ `/api` như current behavior
- ✅ Fixed: Google strategy clarification - explain passReqToCallback và validate() return
- ✅ Fixed: Thêm `ExchangeDto` cho exchange endpoint
- ✅ Fixed: Thêm exchange DTO vào checklist

### Code Verification Review (v3 → v4 Changes)

Đối chiếu plan với code thật + `node_modules/passport-oauth2/lib/strategy.js`.

- 🔴 **Fixed (blocker)**: v3 §5.5 đọc `req.query.platform` trong `validate()` — luôn
  `undefined` vì `validate()` chạy ở request callback, không phải request khởi tạo.
  Mobile sẽ luôn nhận `'web'` và **không có lỗi nào phát ra**. Thay bằng nhúng platform
  vào signed state ở `SignedStateStore.store()` (§5.5 mới).
- 🔴 **Fixed**: `passReqToCallback` là option của *strategy*, không phải
  `PassportModule.register()`. Kèm theo phải đổi signature `validate()` sang arity 5.
- 🔴 **Fixed**: error path `state.includes('mobile')` không bao giờ đúng với format state
  cũ, và là heuristic sai ngay cả với format mới → dùng `readPlatformFromState()`.
- 🟡 **Fixed**: `RedisService` ở `common/services/redis.service.ts`, không phải
  `common/redis/redis.service.ts`. `AuthModule` đã import `RedisModule` sẵn.
- 🟡 **Fixed**: §5.2 đã lệch với file thật (file có thêm `normalizePlatform()`); §5.1
  viết lặp logic inline → dùng lại hàm đã có.
- 🟡 **Fixed**: `exchange` trả full user object thay vì chỉ `{ id }`, khớp contract `login`.
- 🟡 **Reverted**: SEC-M1 (platform claim trong refresh token) từ "đã fix" về deferred —
  v3 đánh dấu resolved nhưng không có spec ở §5 lẫn checklist.
- 🟡 **Corrected**: SEC-H2 — rate limit auth-specific chỉ cover 5 endpoint, không cover
  refresh/logout/exchange.
- 🟢 **Added**: cảnh báo Redis in-memory fallback, deep link scheme hijacking, silent
  failure khi thiếu header, thứ tự bắt buộc trong Phase 3.

### Known Limitations
1. `X-Platform` header có thể bị spoof → mitigate bằng rate limiting + monitoring
2. Web redirect vẫn leak access token trong URL (giữ nguyên từ current behavior) — xem §12
3. Authorization code Redis storage cần được clean up (TTL tự handle)
4. Mobile OAuth cần Google OAuth client ID riêng cho iOS/Android apps
5. **Custom scheme `myapp://` không an toàn trên Android**: scheme không được claim độc
   quyền, app khác cài sau có thể đăng ký cùng scheme và nhận được `?code=`. One-time-use
   + TTL 5 phút thu hẹp cửa sổ chứ không đóng lỗ. Nên dùng App Links (Android) /
   Universal Links (iOS) với domain đã verify.
6. **Auth code phụ thuộc Redis thật**: `RedisService` có fallback in-memory per-process
   (`redis.service.ts:12`). Không có Redis + deploy nhiều instance → `exchange` fail
   ngẫu nhiên tùy request rơi vào instance nào.
7. Đổi format state làm invalid các vòng OAuth đang dở tại thời điểm deploy (≤300s).

---

## 12. Đề Xuất Mở Rộng (Ngoài Scope PR Này)

**Dùng authorization code cho cả web, không chỉ mobile.**

Hiện tại web callback nhét `accessToken` + user base64 vào query string. Nó đi vào
browser history và access log của FE host, và `base64url` không phải encryption.

Nếu web cũng nhận `?code=` rồi `POST /auth/exchange` với `X-Platform: web` → server trả
`accessToken` trong body + `Set-Cookie` refresh token. Kết quả:

- Không còn token hay PII nào trong URL → giải quyết luôn Known Limitation #2
- Hai nền tảng dùng chung một luồng OAuth, thay vì hai nhánh `if platform` phải maintain
  song song ở `googleCallback`
- `exchange` cần thêm `@CurrentPlatform()` để quyết định cookie vs body cho refresh token

Chi phí: FE web phải sửa trang `/google/callback` từ đọc query param sang gọi một API.
Đáng làm nhưng nên là PR riêng để không mở rộng blast radius của PR này.
