import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

type SignableValue = string | number | undefined | null;

@Injectable()
export class MomoSignatureService {
  sign(fields: Record<string, SignableValue>, orderedKeys: string[], secretKey: string) {
    const raw = orderedKeys
      .filter((key) => fields[key] !== undefined && fields[key] !== null)
      .map((key) => `${key}=${fields[key]}`)
      .join('&');

    return crypto.createHmac('sha256', secretKey).update(raw).digest('hex');
  }

  verify(fields: Record<string, SignableValue>, orderedKeys: string[], secretKey: string, signature: string) {
    const expected = this.sign(fields, orderedKeys, secretKey);
    const provided = String(signature).toLowerCase();
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const providedBuffer = Buffer.from(provided, 'utf8');
    return providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
  }
}
