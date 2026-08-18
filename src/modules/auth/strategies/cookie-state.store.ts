import { Request, Response } from 'express';
import * as crypto from 'crypto';

type StoreCallback = (err: Error | null, state?: string) => void;
type VerifyCallback = (
  err: Error | null,
  ok?: boolean,
  state?: unknown,
) => void;

/**
 * State store cho OAuth2 dựa trên cookie thay vì session.
 *
 * `passport-google-oauth20` với `state: true` mặc định yêu cầu express-session.
 * Backend này là API stateless dùng JWT nên không có session store; ta lưu state
 * vào một cookie httpOnly ngắn hạn và so sánh khi Google redirect về. Cookie chỉ
 * tồn tại trong vòng OAuth nên không cần persistence.
 */
export class CookieStateStore {
  private readonly cookieName: string;
  private readonly ttlSeconds: number;
  private readonly secure: boolean;

  constructor(options: {
    cookieName?: string;
    ttlSeconds?: number;
    secure?: boolean;
  }) {
    this.cookieName = options.cookieName ?? 'g_oauth_state';
    this.ttlSeconds = options.ttlSeconds ?? 600;
    this.secure = options.secure ?? false;
  }

  store(req: Request, callback: StoreCallback): void;
  store(req: Request, meta: unknown, callback: StoreCallback): void;
  store(
    req: Request,
    metaOrCallback: unknown | StoreCallback,
    maybeCallback?: StoreCallback,
  ): void {
    const callback = (
      typeof metaOrCallback === 'function' ? metaOrCallback : maybeCallback
    ) as StoreCallback;

    try {
      const state = crypto.randomBytes(32).toString('base64url');
      const res = req.res as Response | undefined;

      if (!res) {
        return callback(
          new Error('Không thể ghi state cookie: response không khả dụng.'),
        );
      }

      res.cookie(this.cookieName, state, {
        httpOnly: true,
        secure: this.secure,
        // Google redirect về là điều hướng top-level cross-site, nên 'lax' là mức
        // chặt nhất mà cookie vẫn được gửi kèm.
        sameSite: 'lax',
        maxAge: this.ttlSeconds * 1000,
        path: '/',
      });

      callback(null, state);
    } catch (err) {
      callback(err instanceof Error ? err : new Error('Không thể tạo state'));
    }
  }

  verify(req: Request, providedState: string, callback: VerifyCallback): void;
  verify(
    req: Request,
    providedState: string,
    meta: unknown,
    callback: VerifyCallback,
  ): void;
  verify(
    req: Request,
    providedState: string,
    metaOrCallback: unknown | VerifyCallback,
    maybeCallback?: VerifyCallback,
  ): void {
    const callback = (
      typeof metaOrCallback === 'function' ? metaOrCallback : maybeCallback
    ) as VerifyCallback;

    const expected = req.cookies?.[this.cookieName];

    // Dọn cookie ngay: state chỉ dùng một lần, kể cả khi verify thất bại.
    req.res?.clearCookie(this.cookieName, { path: '/' });

    if (typeof expected !== 'string' || !expected) {
      return callback(null, false, {
        message: 'Thiếu OAuth state cookie. Vui lòng đăng nhập lại.',
      });
    }

    if (!this.timingSafeEqual(expected, providedState)) {
      return callback(null, false, {
        message: 'OAuth state không hợp lệ.',
      });
    }

    callback(null, true, providedState);
  }

  private timingSafeEqual(a: string, b: string): boolean {
    if (typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }
}
