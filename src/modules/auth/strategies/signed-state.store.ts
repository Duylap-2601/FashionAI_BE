import * as crypto from 'crypto';
import { Request } from 'express';

type StoreCallback = (err: Error | null, state?: string) => void;
type VerifyCallback = (
  err: Error | null,
  ok?: boolean,
  state?: unknown,
) => void;

const SEPARATOR = '.';

/**
 * State store cho OAuth2 hoàn toàn stateless: state tự mang chữ ký HMAC.
 *
 * Cách làm trước đây là lưu state vào cookie httpOnly rồi so lại lúc Google
 * redirect về. Nó phụ thuộc vào việc cookie sống sót qua vòng OAuth, điều không
 * đảm bảo: nếu FE mở luồng login bằng fetch/popup/iframe thay vì điều hướng
 * top-level thì Set-Cookie đó là cookie third-party và bị trình duyệt chặn, state
 * không bao giờ được lưu và callback luôn trả 401.
 *
 * Ở đây state = nonce + thời điểm phát hành + HMAC của hai phần đó. Server chỉ
 * cần secret để xác minh nên không phải nhớ gì giữa hai request, và kẻ tấn công
 * không ký được state hợp lệ nên vẫn chặn được CSRF trên vòng OAuth.
 */
export class SignedStateStore {
  private readonly key: Buffer;
  private readonly ttlSeconds: number;

  constructor(options: { secret: string; ttlSeconds?: number }) {
    // Tách khoá riêng cho mục đích này thay vì dùng trực tiếp secret ký JWT: cùng
    // một khoá dùng cho hai mục đích khác nhau là thói quen dễ thành lỗ hổng khi
    // một trong hai định dạng thay đổi.
    this.key = crypto
      .createHmac('sha256', options.secret)
      .update('oauth-state-v1')
      .digest();
    this.ttlSeconds = options.ttlSeconds ?? 600;
  }

  store(req: Request, meta: unknown, callback: StoreCallback): void {
    try {
      const nonce = crypto.randomBytes(16).toString('base64url');
      const issuedAt = Math.floor(Date.now() / 1000).toString(36);
      const payload = `${nonce}${SEPARATOR}${issuedAt}`;

      callback(null, `${payload}${SEPARATOR}${this.sign(payload)}`);
    } catch (err) {
      callback(
        err instanceof Error ? err : new Error('Không thể tạo OAuth state'),
      );
    }
  }

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
    if (parts.length !== 3) {
      return callback(null, false, { message: 'OAuth state không hợp lệ.' });
    }

    const [nonce, issuedAt, signature] = parts;
    const payload = `${nonce}${SEPARATOR}${issuedAt}`;

    if (!this.timingSafeEqual(this.sign(payload), signature)) {
      return callback(null, false, { message: 'OAuth state không hợp lệ.' });
    }

    const issuedAtSeconds = parseInt(issuedAt, 36);
    if (!Number.isFinite(issuedAtSeconds)) {
      return callback(null, false, { message: 'OAuth state không hợp lệ.' });
    }

    const ageSeconds = Math.floor(Date.now() / 1000) - issuedAtSeconds;
    if (ageSeconds < 0 || ageSeconds > this.ttlSeconds) {
      return callback(null, false, {
        message: 'OAuth state đã hết hạn. Vui lòng đăng nhập lại.',
      });
    }

    callback(null, true, providedState);
  }

  private sign(payload: string): string {
    return crypto
      .createHmac('sha256', this.key)
      .update(payload)
      .digest('base64url');
  }

  private timingSafeEqual(expected: string, provided: string): boolean {
    const bufExpected = Buffer.from(expected);
    const bufProvided = Buffer.from(provided);
    if (bufExpected.length !== bufProvided.length) return false;
    return crypto.timingSafeEqual(bufExpected, bufProvided);
  }
}
