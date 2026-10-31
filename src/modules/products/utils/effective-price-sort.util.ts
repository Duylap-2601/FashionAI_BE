export type EffectivePriceSort = 'latest' | 'price_asc' | 'price_desc';

export type EffectivePriceItem = {
  id: string;
  effectivePrice: number;
};

type EffectivePriceOptions = {
  minPrice?: number;
  maxPrice?: number;
  sort?: EffectivePriceSort;
};

/**
 * Lọc và sắp xếp theo giá bán thực tế (đã resolve sale). Không mutate input.
 * Tie-break luôn theo id ASC để thứ tự ổn định giữa các lần đọc.
 */
export function filterAndSortByEffectivePrice<T extends EffectivePriceItem>(
  items: T[],
  options: EffectivePriceOptions = {},
): T[] {
  const { minPrice, maxPrice, sort = 'latest' } = options;

  const filtered = items.filter((item) => {
    if (minPrice !== undefined && item.effectivePrice < minPrice) return false;
    if (maxPrice !== undefined && item.effectivePrice > maxPrice) return false;
    return true;
  });

  if (sort !== 'price_asc' && sort !== 'price_desc') return filtered;

  const direction = sort === 'price_asc' ? 1 : -1;
  return filtered.sort((a, b) => {
    if (a.effectivePrice !== b.effectivePrice) {
      return (a.effectivePrice - b.effectivePrice) * direction;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
