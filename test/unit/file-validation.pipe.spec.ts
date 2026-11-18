import { BadRequestException } from '@nestjs/common';
import { FileValidationPipe } from '../../src/common/pipes/file-validation.pipe';

describe('FileValidationPipe', () => {
  const pipe = new FileValidationPipe({ maxSize: 10 * 1024 * 1024 });
  const MB = 1024 * 1024;

  const fileOf = (size: number, mimetype = 'image/jpeg') =>
    ({ buffer: Buffer.alloc(0), mimetype, size } as Express.Multer.File);

  it('TC-139: biên 10 MB — vượt 1 byte bị 400, đúng 10 MB được qua', () => {
    expect(() => pipe.transform(fileOf(10 * MB + 1))).toThrow(BadRequestException);
    expect(() => pipe.transform(fileOf(10 * MB + 1))).toThrow(/10\.0MB/);

    expect(pipe.transform(fileOf(10 * MB))).toMatchObject({ size: 10 * MB });
  });

  it('TC-138: MIME ngoài whitelist bị 400', () => {
    expect(() => pipe.transform(fileOf(1024, 'text/plain'))).toThrow(/không hỗ trợ/);
    expect(pipe.transform(fileOf(1024, 'image/webp'))).toMatchObject({ mimetype: 'image/webp' });
  });
});
