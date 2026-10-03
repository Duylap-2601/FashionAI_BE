export function formatVnd(value: number): string {
  assertFiniteMoney(value);
  return `${Math.round(value).toLocaleString('vi-VN')}đ`;
}

export function formatDateVi(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error('Invalid date');
  }
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(value);
}

export function assertFiniteMoney(value: number): void {
  if (!Number.isSafeInteger(Math.round(value)) || value < 0) {
    throw new Error('Invalid money amount');
  }
}

export function textLines(lines: Array<string | false | null | undefined>): string {
  return lines.filter((line): line is string => Boolean(line)).join('\n');
}
