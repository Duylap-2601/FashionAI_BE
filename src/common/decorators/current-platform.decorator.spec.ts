import { normalizePlatform } from '../../modules/auth/types/platform.type';

describe('normalizePlatform utility', () => {
  it('should return "web" when input is undefined', () => {
    expect(normalizePlatform(undefined)).toBe('web');
  });

  it('should return "web" when input is null', () => {
    expect(normalizePlatform(null)).toBe('web');
  });

  it('should return "mobile" when input is "mobile"', () => {
    expect(normalizePlatform('mobile')).toBe('mobile');
  });

  it('should return "mobile" when input is "MOBILE" (case-insensitive)', () => {
    expect(normalizePlatform('MOBILE')).toBe('mobile');
  });

  it('should return "mobile" when input is "MoBiLe" (mixed case)', () => {
    expect(normalizePlatform('MoBiLe')).toBe('mobile');
  });

  it('should return "web" when input is "web"', () => {
    expect(normalizePlatform('web')).toBe('web');
  });

  it('should return "web" for invalid string values', () => {
    expect(normalizePlatform('invalid')).toBe('web');
    expect(normalizePlatform('ios')).toBe('web');
    expect(normalizePlatform('android')).toBe('web');
  });

  it('should return "web" when header is an array (query param duplication)', () => {
    expect(normalizePlatform(['mobile', 'web'] as any)).toBe('web');
    expect(normalizePlatform(['web'] as any)).toBe('web');
  });

  it('should return "web" for whitespace-only strings', () => {
    expect(normalizePlatform('   ')).toBe('web');
    expect(normalizePlatform('\t\n')).toBe('web');
  });

  it('should return "web" for other data types', () => {
    expect(normalizePlatform(123 as any)).toBe('web');
    expect(normalizePlatform(true as any)).toBe('web');
    expect(normalizePlatform({} as any)).toBe('web');
  });

  it('should handle "mobile" with leading/trailing whitespace', () => {
    expect(normalizePlatform('  mobile  ')).toBe('mobile');
    expect(normalizePlatform('\tmobile\n')).toBe('mobile');
  });
});
