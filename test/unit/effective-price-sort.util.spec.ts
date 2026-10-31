import { filterAndSortByEffectivePrice } from '../../src/modules/products/utils/effective-price-sort.util';

const items = [
  { id: 'a', effectivePrice: 700_000 },
  { id: 'b', effectivePrice: 750_000 },
  { id: 'c', effectivePrice: 600_000 },
];

describe('filterAndSortByEffectivePrice', () => {
  it('sắp xếp tăng dần theo giá bán thực tế', () => {
    expect(filterAndSortByEffectivePrice(items, { sort: 'price_asc' }).map((item) => item.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('sắp xếp giảm dần theo giá bán thực tế', () => {
    expect(filterAndSortByEffectivePrice(items, { sort: 'price_desc' }).map((item) => item.id)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('lọc min/max theo giá bán thực tế', () => {
    expect(
      filterAndSortByEffectivePrice(items, { minPrice: 700_000, sort: 'price_asc' }).map((item) => item.id),
    ).toEqual(['a', 'b']);
    expect(
      filterAndSortByEffectivePrice(items, { maxPrice: 700_000, sort: 'price_asc' }).map((item) => item.id),
    ).toEqual(['c', 'a']);
  });

  it('tie-break theo id ASC ổn định ở cả hai chiều', () => {
    const tied = [
      { id: 'b', effectivePrice: 100_000 },
      { id: 'a', effectivePrice: 100_000 },
      { id: 'c', effectivePrice: 100_000 },
    ];

    expect(filterAndSortByEffectivePrice(tied, { sort: 'price_asc' }).map((item) => item.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(filterAndSortByEffectivePrice(tied, { sort: 'price_desc' }).map((item) => item.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('không mutate input', () => {
    const input = [...items];
    filterAndSortByEffectivePrice(input, { sort: 'price_asc' });
    expect(input).toEqual(items);
  });
});
