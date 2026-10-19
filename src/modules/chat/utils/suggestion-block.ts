export const SUGGESTION_OPEN_TAG = '<suggestions>';
export const SUGGESTION_CLOSE_TAG = '</suggestions>';

/**
 * Tách block `<suggestions>{json}</suggestions>` ở cuối câu trả lời khỏi luồng token: phần
 * chữ trước block được stream bình thường, block bị giữ lại để parse nên người dùng không
 * thấy JSON. Đuôi chunk có thể là nửa đầu của thẻ mở nên được giữ tới chunk sau mới quyết.
 */
export class SuggestionBlockSplitter {
  private pending = '';
  private block: string | null = null;

  /** Nhận một chunk từ model, trả phần chữ đã chắc chắn không thuộc block. */
  push(chunk: string): string {
    if (this.block !== null) {
      this.block += chunk;
      return '';
    }

    this.pending += chunk;
    const start = this.pending.indexOf(SUGGESTION_OPEN_TAG);
    if (start !== -1) {
      const text = this.pending.slice(0, start);
      this.block = this.pending.slice(start + SUGGESTION_OPEN_TAG.length);
      this.pending = '';
      return text;
    }

    const keep = partialOpenTagLength(this.pending);
    const text = this.pending.slice(0, this.pending.length - keep);
    this.pending = this.pending.slice(this.pending.length - keep);
    return text;
  }

  /** Gọi khi stream kết thúc: phần chữ còn giữ lại và nội dung block (null nếu không có). */
  finish(): { text: string; block: string | null } {
    const text = this.pending;
    this.pending = '';
    if (this.block === null) return { text, block: null };
    const end = this.block.indexOf(SUGGESTION_CLOSE_TAG);
    return { text, block: end === -1 ? this.block : this.block.slice(0, end) };
  }
}

/** Parse JSON trong block; model đôi khi bọc ```json nên lấy từ "{" đầu tới "}" cuối. */
export function parseSuggestionBlock(block: string | null): Record<string, unknown> | null {
  if (!block) return null;
  const first = block.indexOf('{');
  const last = block.lastIndexOf('}');
  if (first === -1 || last <= first) return null;
  try {
    const parsed: unknown = JSON.parse(block.slice(first, last + 1));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function partialOpenTagLength(text: string): number {
  for (let length = Math.min(text.length, SUGGESTION_OPEN_TAG.length - 1); length > 0; length--) {
    if (SUGGESTION_OPEN_TAG.startsWith(text.slice(-length))) return length;
  }
  return 0;
}
