# Plan: Phân lớp trang phục (`LayerRole`) + Chiến dịch sale (`Promotions`)

Ngày: 2026-10-24. Trạng thái: kế hoạch, chưa triển khai.

> Phase 2 (Promotions) đã được thay thế bởi `plans/sale-campaigns-plan.md` ở root repo.
> Không triển khai Phase 2 theo tài liệu này nữa.

Nguồn: `valiant-yawning-nygaard.md`. Kế hoạch này giữ nguyên mục tiêu 2 phase,
bổ sung kết quả kiểm chứng code thực tế và các quyết định cần chốt trước khi code.

## 1. Kết luận kiểm chứng so với bản nháp

| Điểm trong bản nháp | Thực tế trong repo | Điều chỉnh |
| --- | --- | --- |
| `MAX_GARMENTS` cần đủ 3 lớp | `try-on.service.ts:63` đang là `2` | **Phải nâng lên 3**, nếu không combo INNER + BOTTOM + OUTER vẫn bị chặn |
| `validateGarments()` chạy trước `resolveGarments()` | Đúng: `try-on.service.ts:428-430`; validate đọc `g.category` ở `:137` | Phải tách validate hình dạng (trước) và validate lớp (sau khi có dữ liệu DB) |
| `mapCategory()` map từ `GarmentCategory` | Đúng: `:111-121` | Map từ `LayerRole` |
| Cache combo dùng `category` | Đúng: `buildComboCacheKey()` `:233-247` | Đưa `layerRole` vào key |
| `toRole()` chỉ coi `JACKET` là outer | Đúng: `product-suggestion.service.ts:324-341` | Thay bằng helper dùng chung; **giữ nguyên giá trị `OutfitRole` trả ra API** |
| Catalog AI thiếu `layerRole` | `getCatalog()` select ở `:117-127` không có `layerRole`; `loadProducts()` `:253-256` lấy toàn bộ scalar nên sẽ tự có sau migration | Chỉ cần thêm vào `select` của catalog |
| `buildOrderPricing()` tính theo `product.price` | Đúng: `orders.service.ts:985-1020`; ghi `OrderItem` ở `:241-264` | Thay bằng giá hiệu lực, truyền cùng một map giá vào transaction |
| Quote token đã chặn lệch tổng | Đúng: `assertQuoteToken()` `:937-952` so `payload.pricing.total` | Giữ nguyên; chỉ cải thiện thông báo lỗi nếu cần |
| `toPublicOrder()` tính lại `itemsTotal` | Đúng: `:1279-1282` tính từ `item.price` | Sau khi ghi giá sale, `itemsTotal` tự phản ánh giá sale |
| `cart.service.ts` chỉ để hiển thị | Đúng: `toCartResponse()` `:292-322`, là hàm sync | Phải truyền map giá vào hàm này, không gọi async trong mapper |
| `findAll()` phân trang + sort theo `price` gốc | Đúng: `products.service.ts:120-125, 174-183` | `onSale` phải lọc trước phân trang; không sort theo giá sale nếu không dùng raw SQL |
| `originalPrice` chỉ để trang trí | Đúng: chỉ xuất hiện khi create và trong cart response | Validate `originalPrice >= price` ở service (update là DTO partial) |
| Giá VND là số nguyên | `orders.service.ts:1100-1102` dùng `BigInt(Math.round(amount))` | Mọi phép tính promotion phải `Math.round` về VND |
| `PrismaModule` dùng chung | `prisma.module.ts` có `@Global()` | Module mới không cần import `PrismaModule` |
| `TryOnResult.category` là `GarmentCategory` | Đúng: schema `:603` | Giữ nguyên; chỉ thêm `layerRole` vào cột JSON `garments` |
| CRUD coupons làm khuôn | `coupons.controller.ts` guard admin ở cấp controller; `coupons.service.ts` bắt P2003/23001 khi xoá | Dùng cùng khuôn cho promotions |

## 2. Quyết định thiết kế cần chốt

1. **`LayerRole` gồm 4 giá trị**: `OUTER`, `INNER`, `BOTTOM`, `FULL_BODY`.
   Nullable trên `Product` để dữ liệu cũ không vỡ; helper luôn fallback.
2. **Suy luận mặc định**: `JACKET|VEST → OUTER`, `SHIRT → INNER`,
   `PANTS|SKIRT → BOTTOM`, `DRESS|JUMPSUIT → FULL_BODY`; nếu thiếu `garmentType`
   thì theo `category` (`UPPER → INNER`, `LOWER → BOTTOM`,
   `FULL_BODY → FULL_BODY`). `layerRole` do admin nhập luôn thắng suy luận.
3. **Ảnh upload tự do**: `category = UPPER` mặc định là `INNER`. Bổ sung field
   optional `garments[N][layerRole]` để client nói rõ đây là áo khoác. Với
   `productId`, **bỏ qua `layerRole` client gửi**, luôn đọc từ DB.
4. **Combo hợp lệ**: tối đa 3 món; `OUTER + INNER + BOTTOM` được phép;
   `FULL_BODY` phải đứng một mình; không trùng lớp (`2 OUTER`, `2 INNER`,
   `2 BOTTOM` đều fail).
5. **Giữ nguyên `OutfitRole`** (`'outer' | 'top' | 'dress' | 'bottom'`) trong
   response stylist/chat để không phá FE. Chỉ map từ `LayerRole` sang
   `OutfitRole`; không đổi giá trị API.
6. **Không thêm `Product.salePrice`.** Giá sale là dẫn xuất từ `price` +
   promotion đang hiệu lực. `originalPrice` vẫn là giá marketing, chỉ thêm
   validate `originalPrice >= price`.
7. **Một dòng sản phẩm chỉ trúng một promotion**: chọn `priority` cao nhất,
   hoà thì chọn mức giảm lớn hơn, hoà nữa thì chọn campaign tạo sau. Không cộng
   dồn nhiều promotion.
8. **Thứ tự tính tiền**: giá sale từng dòng → `itemsTotal` → coupon áp trên
   `itemsTotal` đã sale. Coupon và sale cộng dồn được; `minOrderVnd` so với
   `itemsTotal` sau sale.
9. **Làm tròn VND**: `Math.round`, clamp `0 <= discountAmount <= basePrice`.
10. **Không cần cron**: promotion hiệu lực được đánh giá theo `at` truyền vào
    (mặc định `new Date()`). Không thêm job.
11. **Một mốc thời gian cho một lần tính giá**: `buildOrderPricing` nhận `at`,
    dùng cùng `at` cho promotion và coupon. Giá từng dòng đã tính được truyền
    vào transaction tạo order; **không gọi lại pricing service trong transaction**
    để tránh campaign bị sửa giữa chừng làm `OrderItem` lệch `Order.total`.
12. **`onSale` lọc trước phân trang** bằng danh sách product id đang trúng
    promotion. Sort `price_asc/price_desc` vẫn theo giá gốc; ghi rõ trong
    Swagger để FE không hiểu nhầm.

## 3. Phase 1 — `LayerRole`

### 3.1. Schema và migration

- [ ] Thêm enum cạnh `GarmentType` (`prisma/schema.prisma:37-45`):

  ```prisma
  enum LayerRole {
    OUTER
    INNER
    BOTTOM
    FULL_BODY
  }
  ```

- [ ] Thêm vào `Product` sau `garmentType` (`:484`):

  ```prisma
  layerRole LayerRole? @map("layer_role")
  ```

- [ ] Tạo migration `add_product_layer_role`. Nên backfill ngay trong migration
      để filter `layerRole` không bỏ sót dữ liệu cũ:

  ```sql
  UPDATE "products"
  SET "layer_role" = CASE
    WHEN "garment_type" IN ('JACKET', 'VEST') THEN 'OUTER'::"LayerRole"
    WHEN "garment_type" = 'SHIRT' THEN 'INNER'::"LayerRole"
    WHEN "garment_type" IN ('PANTS', 'SKIRT') THEN 'BOTTOM'::"LayerRole"
    WHEN "garment_type" IN ('DRESS', 'JUMPSUIT') THEN 'FULL_BODY'::"LayerRole"
    WHEN "category" = 'LOWER' THEN 'BOTTOM'::"LayerRole"
    WHEN "category" = 'FULL_BODY' THEN 'FULL_BODY'::"LayerRole"
    ELSE 'INNER'::"LayerRole"
  END;
  ```

- [ ] Chạy `npm run prisma:generate`.

### 3.2. Helper dùng chung

Tạo `src/modules/products/utils/layer-role.util.ts` (hàm pure, không DI):

- [ ] `resolveLayerRole(product: { layerRole, garmentType, category }): LayerRole`
      — ưu tiên `product.layerRole`, sau đó suy luận như mục 2.2.
- [ ] `layerRoleToGarmentCategory(role): GarmentCategory` — dùng khi cần map
      ngược cho response/cache (`OUTER|INNER → UPPER`, `BOTTOM → LOWER`,
      `FULL_BODY → FULL_BODY`).
- [ ] `layerRoleToFashnCategory(role): 'tops' | 'bottoms' | 'one-pieces'`.
- [ ] `layerRoleOrder(role): number` — `INNER(0) → BOTTOM(1) → OUTER(2) →
      FULL_BODY(3)`.
- [ ] `layerRoleToOutfitRole(role): OutfitRole` — `OUTER → outer`,
      `INNER → top`, `FULL_BODY → dress`, `BOTTOM → bottom`.

Không export helper qua module; import trực tiếp theo AGENTS.md.

### 3.3. Products DTO và service

- [ ] `dto/create-product.dto.ts`: thêm `layerRole?: LayerRole` với
      `@ApiProperty({ enum: LayerRole })`, `@IsEnum`, `@IsOptional`, đặt ngay
      sau `garmentType`.
- [ ] `dto/query-product.dto.ts`: thêm filter `layerRole?: LayerRole`.
- [ ] `products.service.ts`:
  - [ ] truyền `layerRole` vào `createData` cạnh `garmentType` (`:41-42`);
  - [ ] thêm `...(layerRole ? { layerRole } : {})` vào `where` của `findAll`;
  - [ ] `update` phải merge dữ liệu cũ để validate `originalPrice >= price`
        (xem dưới), vì `Partial<CreateProductDto>` không đủ ngữ cảnh cross-field;
  - [ ] validate `originalPrice >= price` trong `create` và `update`; ném
        `BadRequestException` với message tiếng Việt rõ ràng.

### 3.4. Try-on service (phần quan trọng nhất)

Tách luồng thành 4 bước thay vì validate → resolve như hiện tại:

1. **Validate hình dạng** (`validateGarmentShape`): ít nhất 1 món, tối đa
   `MAX_GARMENTS`, mỗi món có đúng một trong `image`/`productId`.
2. **Load context từng món** (`loadGarmentContexts`): với `productId`, query
   `Product` (đủ `category`, `garmentType`, `layerRole`, `images`,
   `garmentUrl`); với ảnh upload, lấy `layerRole` client gửi hoặc suy ra từ
   `category`.
3. **Validate lớp** (`assertValidLayerCombination`) trên danh sách đã resolve.
4. **Tải buffer ảnh** (`resolveGarments`) — tái sử dụng context ở bước 2, không
   query lại product.

Chi tiết thay đổi:

- [ ] `MAX_GARMENTS = 3` (`try-on.service.ts:63`).
- [ ] `TryOnGarmentInput` thêm `layerRole?: LayerRole`.
- [ ] `ResolvedGarment` thêm `layerRole: LayerRole`.
- [ ] `resolveGarments()` không còn `g.category ?? GarmentCategory.UPPER`;
      `category` lấy từ `product.category` hoặc từ input upload.
- [ ] `mapCategory()` nhận `LayerRole` và dùng
      `layerRoleToFashnCategory()`.
- [ ] `categoryOrder()` → `layerRoleOrder()`; sort ảnh theo
      `INNER → BOTTOM → OUTER → FULL_BODY` để FASHN đắp áo khoác sau cùng.
- [ ] `buildComboCacheKey()` dùng `g.layerRole` thay `g.category`; key đơn
      cũng nên dùng `layerRole` để metadata cache khớp.
- [ ] `garmentsMeta` thêm `layerRole`; `TryOnResultResponse.garments` cập nhật
      type tương ứng. `TryOnResult.category` vẫn là `GarmentCategory`.
- [ ] `finalCategory`: giữ logic lấy món cuối sau sort, nhưng map qua
      `layerRoleToGarmentCategory()` nếu món đó là ảnh upload.
- [ ] `validateGarments` cũ: bỏ phần kiểm tra trùng `category` và FULL_BODY;
      chuyển sang `assertValidLayerCombination`.
- [ ] Tách pure function `assertValidLayerCombination(layers: LayerRole[])`
      sang `src/modules/try-on/utils/garment-combo.util.ts` để unit test không
      cần dựng cả service.
- [ ] `try-on.controller.ts`: thêm `garments[N][layerRole]` vào Swagger body;
      parser `parseGarments()` đọc thêm field này; cập nhật mô tả API từ
      "tối đa 2 món" thành "tối đa 3 món".
- [ ] Giữ tương thích legacy `garmentCategory`; field `layerRole` là optional.

### 3.5. Product suggestion

- [ ] Bỏ `toRole()`, thay bằng `layerRoleToOutfitRole(resolveLayerRole(product))`.
- [ ] Thêm `layerRole: LayerRole` vào `SuggestedProduct` và
      `StylingCatalogEntry`.
- [ ] `getCatalog()` select thêm `layerRole: true`.
- [ ] `loadProducts()` map thêm `layerRole` (đã có sẵn scalar sau migration).
- [ ] Thêm `LAYER_ROLE_LABELS` và đưa nhãn vào `formatCatalogForPrompt()`, ví dụ
      `Khoác ngoài`, `Mặc trong`, `Quần/Chân váy`, `Toàn thân`.
- [ ] Giữ `ROLE_ORDER = ['outer', 'top', 'dress', 'bottom']` để không đổi shape
      response hiện tại.

### 3.6. Cập nhật `AGENTS.md`

- [ ] Ghi `layerRole` là nguồn sự thật cho phân lớp try-on/AI; helper
      `resolveLayerRole` là nơi duy nhất suy luận.

### 3.7. Kiểm thử Phase 1

Unit (`test/unit`):

- [ ] `layer-role.util.spec.ts`:
  - từng `garmentType` map đúng;
  - `layerRole` có sẵn thắng suy luận;
  - product thiếu `garmentType` fallback theo `category`;
  - `layerRoleToOutfitRole` giữ đúng 4 giá trị cũ.
- [ ] `garment-combo.util.spec.ts`:
  - `OUTER + INNER` pass (regression chính);
  - `OUTER + INNER + BOTTOM` pass;
  - `OUTER + OUTER`, `INNER + INNER`, `BOTTOM + BOTTOM` fail;
  - `FULL_BODY` + bất kỳ món nào fail;
  - quá `MAX_GARMENTS` fail.
- [ ] Cập nhật `product-suggestion.service.spec.ts` cho `VEST → outer`.

E2E:

- [ ] `try-on-cache.e2e-spec.ts`: thêm case combo 3 món pass; case client gửi
      `category` sai nhưng `productId` đúng lớp trong DB thì backend dùng DB.
- [ ] Kiểm tra cache key đổi khi `layerRole` đổi.

## 4. Phase 2 — Promotions

### 4.1. Schema và migration

- [ ] Thêm `PromotionDiscountType` và 3 model `Promotion`, `PromotionProduct`,
      `PromotionCollection` như bản nháp, bổ sung:
  - `@@index([collectionId])` cho `PromotionCollection` (PK bắt đầu bằng
    `promotionId`, nên tra ngược theo collection cần index riêng);
  - back-relation `promotions PromotionProduct[]` trên `Product`;
  - back-relation `promotions PromotionCollection[]` trên `Collection`.
- [ ] Thêm snapshot vào `OrderItem`:
  - `promotionIdSnapshot String? @map("promotion_id_snapshot") @db.Uuid`
    (không đặt FK để xoá campaign không mất lịch sử);
  - `basePriceSnapshot Decimal? @map("base_price_snapshot") @db.Decimal(10, 2)`.
- [ ] Migration `add_promotions` gồm bảng mới + 2 cột `order_items`.
- [ ] Chạy `npm run prisma:generate`.

### 4.2. Module `src/modules/promotions/`

Cấu trúc:

```text
promotions.module.ts
promotions.controller.ts
promotions.service.ts
promotion-pricing.service.ts
dto/create-promotion.dto.ts
dto/update-promotion.dto.ts
dto/query-promotion.dto.ts
```

Controller (admin-only, giống `coupons.controller.ts`):

| Method | Route | Việc |
| --- | --- | --- |
| POST | `/promotions` | Tạo campaign |
| GET | `/promotions` | Danh sách + filter |
| GET | `/promotions/:id` | Chi tiết kèm sản phẩm/collection |
| PATCH | `/promotions/:id` | Cập nhật |
| DELETE | `/promotions/:id` | Xoá |

DTO:

- `name` bắt buộc; `description` optional.
- `discountType` enum; `discountValue` > 0; nếu `PERCENTAGE` thì phải `<= 100`
  (validate ở service vì `@Max(100)` sẽ áp cả `FIXED_AMOUNT`).
- `maxDiscountVnd` optional, số nguyên dương.
- `priority` số nguyên, mặc định 0.
- `isActive` mặc định true.
- `startsAt`/`endsAt` ISO date optional; service kiểm tra `startsAt < endsAt`.
- `productIds?: string[]`, `collectionIds?: string[]` — `@IsUUID('4', { each: true })`,
  `@ArrayUnique`.
- `QueryPromotionDto`: `page`, `limit`, `isActive?`, `search?`, `activeAt?`.

Service:

- [ ] `create`: kiểm tra tồn tại product/collection id, ném `BadRequestException`
      liệt kê id thiếu; tạo campaign + join rows trong `$transaction`.
- [ ] `update`: kiểm tra tồn tại; nếu có `productIds`/`collectionIds` thì thay
      toàn bộ join rows (`deleteMany` + `createMany`) trong transaction.
- [ ] `remove`: xoá campaign; join rows cascade. Không có FK từ order nên xoá
      cứng được; snapshot trên `OrderItem` vẫn giữ UUID.
- [ ] `findOne` include `products.product` và `collections.collection` để admin
      thấy phạm vi campaign.
- [ ] Map `maxDiscountVnd` BigInt → Number trong response.

### 4.3. `PromotionPricingService`

Export khỏi module để `orders`, `cart`, `products` inject.

```ts
export interface EffectivePrice {
  productId: string;
  basePrice: number;
  effectivePrice: number;
  discountAmount: number;
  discountPercent: number;
  promotionId: string | null;
  promotionName: string | null;
}

resolveEffectivePrices(
  productIds: string[],
  at?: Date,
  db?: Prisma.TransactionClient,
): Promise<Map<string, EffectivePrice>>;
```

Thuật toán:

- [ ] Dedupe `productIds`; rỗng thì trả `new Map()`.
- [ ] Load `Product` chỉ `{ id, price }` từ `db`.
- [ ] Load promotion active tại `at`:

  ```ts
  where: {
    isActive: true,
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: at } }] },
      { OR: [{ endsAt: null }, { endsAt: { gte: at } }] },
    ],
    OR: [
      { products: { some: { productId: { in: ids } } } },
      {
        collections: {
          some: {
            collection: { products: { some: { productId: { in: ids } } } },
          },
        },
      },
    ],
  }
  ```

  Include `products` và `collections.collection.products` đã lọc theo `ids`
  để tránh kéo toàn bộ catalog.
- [ ] Với mỗi promotion, gom tập `productId` trúng (trực tiếp + qua collection).
- [ ] Với mỗi product, chọn promotion tốt nhất: `priority` desc → discountAmount
      desc → `createdAt` desc → `id` asc (deterministic).
- [ ] Tính:

  ```ts
  let amount =
    promo.discountType === 'PERCENTAGE'
      ? Math.round((basePrice * Number(promo.discountValue)) / 100)
      : Number(promo.discountValue);
  if (promo.maxDiscountVnd != null) {
    amount = Math.min(amount, Number(promo.maxDiscountVnd));
  }
  amount = Math.max(0, Math.min(amount, basePrice));
  ```

- [ ] Product không trúng promotion vẫn có entry với `effectivePrice = basePrice`,
      `promotionId = null`.
- [ ] Thêm `findDiscountedProductIds(at, db)` cho filter `onSale`: trả id của
      các product đang trúng ít nhất một promotion active.

### 4.4. Áp giá vào orders

- [ ] `OrdersModule` import `PromotionsModule`.
- [ ] `OrdersService` inject `PromotionPricingService`.
- [ ] `buildOrderPricing(dto, products, userId, at)`:
  - [ ] gọi `resolveEffectivePrices(productIds, at)` một lần;
  - [ ] `itemsTotal` cộng `effectivePrice * quantity`;
  - [ ] tính `itemsDiscount = Σ (basePrice - effectivePrice) * quantity`;
  - [ ] `resolveDiscountAmount(..., at)` dùng cùng `at` thay `new Date()`;
  - [ ] trả thêm `itemPricing: Map<string, EffectivePrice>` và
        `itemsDiscount`.
- [ ] `quote()`: tạo `const at = new Date()` trước khi gọi; trả thêm
      `itemsDiscount` trong response (không cần đưa vào quote token vì token đã
      ký `total`).
- [ ] `create()`:
  - [ ] tạo `const at = new Date()` và dùng cho `buildOrderPricing`;
  - [ ] trong `tx.order.create`, lấy giá từ `pricing.itemPricing` (không đọc
        `product.price`) để ghi:
    - `price = effectivePrice`
    - `unitPriceVnd = toVnd(effectivePrice)`
    - `lineTotalVnd = toVnd(effectivePrice * quantity)`
    - `basePriceSnapshot = basePrice`
    - `promotionIdSnapshot = promotionId`
  - [ ] `itemsSubtotalVnd` vẫn là tổng sau sale; `discountVnd` chỉ là coupon.
- [ ] `toPublicOrder()`:
  - [ ] item thêm `basePrice`, `promotionId` (từ snapshot);
  - [ ] order thêm `itemsDiscount` tính từ snapshot để FE tách
        "giảm giá sale" và "giảm giá coupon".
- [ ] Nếu `total` thay đổi giữa quote và create, giữ `QUOTE_CHANGED`; cập nhật
      message thành "Giá sản phẩm hoặc khuyến mãi đã thay đổi..." nếu muốn.

### 4.5. Cart

- [ ] `CartModule` import `PromotionsModule`; inject `PromotionPricingService`.
- [ ] `getCart()`: sau `findMany`, gọi `resolveEffectivePrices` cho các
      `productId` trong giỏ, truyền map vào `toCartResponse(items, prices)`.
- [ ] `toCartResponse()` thêm vào mỗi dòng:
      `effectivePrice`, `discountPercent`, `promotion: { id, name } | null`.
- [ ] Giữ comment "display-only; order vẫn recompute".

### 4.6. Products

- [ ] `ProductsModule` import `PromotionsModule`; inject
      `PromotionPricingService`.
- [ ] `findAll()`:
  - [ ] nếu `query.onSale === true`, lấy `findDiscountedProductIds(at)` và thêm
        `{ id: { in: saleIds } }` vào `andFilters` **trước** `findMany`;
  - [ ] sau khi lấy page, batch `resolveEffectivePrices` cho đúng các id trong
        page (tránh N+1);
  - [ ] map item trả thêm `effectivePrice`, `discountPercent`,
        `promotion: { id, name } | null`.
- [ ] `findOne()`: trả thêm 3 field tương tự.
- [ ] `QueryProductDto`: thêm `onSale?: boolean` với `@Transform`/`@IsBoolean`.
- [ ] Không đổi `orderBy` hiện tại; ghi chú sort theo giá gốc.

### 4.7. App module + `AGENTS.md`

- [ ] `app.module.ts` import `PromotionsModule`.
- [ ] `AGENTS.md`: khai báo `promotions` sở hữu định nghĩa campaign,
      `orders` sở hữu việc áp dụng; giá sale là dẫn xuất, không lưu trên
      `Product`.

### 4.8. Kiểm thử Phase 2

Unit (`test/unit/promotion-pricing.service.spec.ts`), dùng Prisma mock:

- [ ] product trúng promotion trực tiếp;
- [ ] product trúng qua collection;
- [ ] 2 promotion chồng nhau → chọn `priority` cao hơn;
- [ ] cùng priority → chọn mức giảm lớn hơn;
- [ ] ngoài khoảng `startsAt/endsAt` → không áp;
- [ ] `isActive = false` → không áp;
- [ ] `FIXED_AMOUNT` lớn hơn giá → clamp về 0, không âm;
- [ ] `maxDiscountVnd` chặn trần;
- [ ] product không trúng → entry giá gốc, `promotionId = null`;
- [ ] danh sách rỗng → map rỗng, không query.

E2E:

- [ ] `orders-create.e2e-spec.ts`: thêm mock `PromotionPricingService` hoặc
      `promotion` delegate vào `createPrismaMock`; test:
  - order trong thời gian sale → `OrderItem.price` = giá sale, `total` khớp;
  - sale + coupon cộng dồn đúng thứ tự;
  - client gửi `totalAmount` theo giá gốc → backend vẫn thu giá sale hoặc báo
    lệch tổng;
  - quote rồi create khi sale kết thúc → `QUOTE_CHANGED`.
- [ ] `cart.e2e-spec.ts`: response có `effectivePrice`, `discountPercent`.
- [ ] Products e2e (nếu có) hoặc unit: `onSale=true` chỉ trả sản phẩm đang sale.

## 5. Thứ tự thực hiện đề xuất

1. Phase 1 schema + helper + unit test helper.
2. Refactor try-on + controller + test combo (fix giá trị cao nhất).
3. Products DTO/service + product-suggestion + test.
4. Phase 2 schema + module CRUD + `PromotionPricingService` + unit test.
5. Nối orders → cart → products + e2e.
6. Cập nhật `AGENTS.md`, chạy full verification.

## 6. Rủi ro và điểm cần theo dõi

- **Giá sản phẩm đổi giữa quote và create**: hành vi hiện tại đã có (products
  load trước transaction). Không mở rộng scope; quote token chỉ bảo vệ tổng.
- **Campaign bị sửa giữa quote và create**: dùng map giá đã tính, không query
  lại trong transaction; chấp nhận giá tại thời điểm quote.
- **`onSale` + phân trang**: phải lọc trước `findMany`, nếu lọc sau sẽ sai
  `meta.total`.
- **Sort theo giá sale**: không làm nếu không có nhu cầu; sort hiện tại theo
  `Product.price`.
- **Promotion không có giới hạn lượt dùng**: khác coupon; nếu cần giới hạn thì
  phải thêm cột và đếm redemption, nằm ngoài scope này.
- **Backfill `layerRole`**: cần review dữ liệu `VEST` (waistcoat vs blazer) sau
  migration; admin có thể sửa tay.
- **FE cũ gửi tối đa 2 món**: vẫn chạy bình thường; chỉ mở rộng thêm 3.
- **Response stylist/chat vẫn dùng giá gốc**: ngoài scope; nếu muốn hiển thị
  giá sale ở đó thì gọi `PromotionPricingService` tại `loadProducts`/hydrate.

## 7. Definition of done

- [ ] `npm run prisma:generate` chạy sạch sau cả 2 migration.
- [ ] `npm run lint:check` pass.
- [ ] `npm run build` pass.
- [ ] `npm run test:unit` pass, có test mới cho helper/combo/pricing.
- [ ] `npm run test:e2e` pass, có case sale + coupon và combo 3 lớp.
- [ ] Không còn `toRole()` hardcode `JACKET`.
- [ ] `try-on.service.ts` không còn đọc `g.category` cho productId.
- [ ] `OrderItem` có snapshot campaign và giá gốc.
- [ ] `AGENTS.md` mô tả ownership `promotions` và `layerRole`.
