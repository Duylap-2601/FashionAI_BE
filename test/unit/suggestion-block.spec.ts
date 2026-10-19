import {
  SuggestionBlockSplitter,
  parseSuggestionBlock,
} from '../../src/modules/chat/utils/suggestion-block';

describe('SuggestionBlockSplitter', () => {
  function run(chunks: string[]) {
    const splitter = new SuggestionBlockSplitter();
    const streamed = chunks.map((chunk) => splitter.push(chunk)).join('');
    const rest = splitter.finish();
    return { text: streamed + rest.text, block: rest.block };
  }

  it('stream nguyên văn khi không có block', () => {
    expect(run(['Xin ', 'chào <b>bạn</b>', ' nhé <'])).toEqual({
      text: 'Xin chào <b>bạn</b> nhé <',
      block: null,
    });
  });

  it('tách block kể cả khi thẻ mở bị cắt giữa nhiều chunk', () => {
    const result = run(['Bạn thử bộ này.\n<sugg', 'estions>{"outfits":', '[]}</suggestions>']);
    expect(result).toEqual({ text: 'Bạn thử bộ này.\n', block: '{"outfits":[]}' });
  });

  it('không stream phần chữ có thể là đầu thẻ mở cho tới khi chắc chắn', () => {
    const splitter = new SuggestionBlockSplitter();
    expect(splitter.push('Gợi ý <sug')).toBe('Gợi ý ');
    expect(splitter.push('ar')).toBe('<sugar');
  });

  it('giữ block khi model quên thẻ đóng', () => {
    expect(run(['Ok <suggestions>{"products":["P1"]}'])).toEqual({
      text: 'Ok ',
      block: '{"products":["P1"]}',
    });
  });
});

describe('SuggestionBlockSplitter — mã sản phẩm lọt vào phần chữ', () => {
  it('bỏ " (P14)" khỏi chữ kể cả khi bị cắt giữa hai chunk, và giữ lại mã', () => {
    const splitter = new SuggestionBlockSplitter();
    const streamed = ['Áo sơ mi trắng (P1', '4) vừa vai. Quần tây [P1] và (Phong cách) gọn.'].map((c) => splitter.push(c)).join('');
    const text = streamed + splitter.finish().text;
    expect(text).toBe('Áo sơ mi trắng vừa vai. Quần tây và (Phong cách) gọn.');
    expect(splitter.mentionedCodes).toEqual(['P14', 'P1']);
  });
});

describe('parseSuggestionBlock', () => {
  it('parse JSON kể cả khi bị bọc markdown', () => {
    expect(parseSuggestionBlock('```json\n{"products":["P2"]}\n```')).toEqual({ products: ['P2'] });
  });

  it('trả null khi không có block hoặc JSON hỏng', () => {
    expect(parseSuggestionBlock(null)).toBeNull();
    expect(parseSuggestionBlock('{"outfits": [}')).toBeNull();
    expect(parseSuggestionBlock('[1,2]')).toBeNull();
  });
});
