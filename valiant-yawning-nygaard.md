# Plan: Phân lớp trang phục cho AI + Chiến dịch sale theo nhóm

## Context

Hai vấn đề độc lập, làm thành 2 phase riêng.

**Vấn đề 1 — AI ghép sai lớp trang phục.** `Product` hiện có `category` (`UPPER|LOWER|FULL_BODY` — vùng cơ thể) và `garmentType` (`SHIRT|VEST|JACKET|...` — loại cụ thể, nullable), nhưng **không có trường nào thể hiện lớp mặc** (khoác ngoài vs mặc trong). Hậu quả cụ thể:

- `try-on.service.ts:141-143` chặn 2 món cùng `category`. Vì JACKET và SHIRT đều là `UPPER`, combo **áo khoác + áo sơ mi (combo hợp lệ nhất trong thực tế) đang bị chặn hoàn toàn**, trong khi không có gì chặn 2 áo khoác nếu chúng được gắn `category` khác nhau.
- `try-on.service.ts:137` và `:180` lấy `category` từ **client input** (`g.category ?? UPPER`) chứ không đọc `product.category` từ DB, dù đã `findUnique` product ở `:188`. Client có thể gửi `category` sai lệch với dữ liệu thật → FASHN nhận `category` sai (`mapCategory` ở `:111`) → lỗi hình ảnh.
- `product-suggestion.service.ts:324-341` (`toRole()`) hardcode chỉ `JACKET` là `'outer'`; `VEST` rơi vào `'top'` dù áo vest/blazer vest cũng là lớp ngoài → stylist gợi ý sai.

**Vấn đề 2 — luồng sale không rõ.** Tồn tại 2 cơ chế giảm giá không liên quan nhau:
- `Product.originalPrice` (schema:487): chỉ xuất hiện 3 chỗ trong toàn `src` (`products.service.ts:45` khi create, `cart.service.ts:306` để hiển thị, DTO:72). **Không validate, không ảnh hưởng giá thật** — order luôn tính theo `product.price` (`orders.service.ts:989, 261-263`). Thuần trang trí.
- Module `coupons`: hệ thống giảm giá thật, validate đầy đủ ở `orders.service.ts:1049-1098` (`resolveDiscountAmount`), redemption ghi transactional ở `:299-307`. Nhưng là **mã khách phải tự nhập**, không phải sale tự động.

Không có model nào cho "giảm giá tự động theo nhóm sản phẩm trong khoảng thời gian". Đây là tính năng chưa xây.

**Kết quả mong muốn:** (1) AI phân biệt được lớp mặc và chặn/cho phép combo đúng; (2) admin tạo được chiến dịch sale áp lên nhiều sản phẩm/collection theo khoảng ngày, giá sale được backend tính và thu đúng.

---

## Phase 1 — `LayerRole` cho phân lớp trang phục

### 1.1 Schema

`prisma/schema.prisma`, thêm enum cạnh `GarmentType` (dòng 37-45):

```prisma
enum LayerRole {
  OUTER      // khoác ngoài: blazer, jacket, vest ngoài, cardigan
  INNER      // mặc trong: sơ mi, áo kiểu, áo thun
  BOTTOM     // quần, chân váy
  FULL_BODY  // đầm, jumpsuit
}
```

Thêm vào `Product` (sau `garmentType`, dòng 484):
```prisma
layerRole LayerRole? @map("layer_role")
```

Nullable để dữ liệu cũ không vỡ; service có fallback suy luận từ `garmentType`/`category`. Thêm migration dưới `prisma/migrations` + chạy `npm run prisma:generate`.

### 1.2 Helper suy luận dùng chung

Tạo `src/modules/products/utils/layer-role.util.ts` — hàm pure, không cần DI:

```ts
resolveLayerRole(product: { layerRole, garmentType, category }): LayerRole
```

Ưu tiên `layerRole` nếu có; nếu null thì suy luận: `JACKET|VEST → OUTER`, `SHIRT → INNER`, `PANTS|SKIRT → BOTTOM`, `DRESS|JUMPSUIT → FULL_BODY`, cuối cùng fallback theo `category` (`LOWER→BOTTOM`, `FULL_BODY→FULL_BODY`, `UPPER→INNER`). Đây là nơi duy nhất chứa logic này — thay cho `toRole()` hardcode hiện tại.

Export qua `products.module.ts` nếu cần (hàm pure thì chỉ cần import trực tiếp, theo AGENTS.md "prefer pure mapper/helper functions").

### 1.3 DTO & products service

- `products/dto/create-product.dto.ts`: thêm `layerRole?: LayerRole` với `@IsEnum`/`@IsOptional`/`@ApiProperty`, theo đúng pattern `garmentType` ở dòng 48-56.
- `products/dto/query-product.dto.ts`: thêm filter `layerRole?` optional.
- `products.service.ts`: truyền `layerRole` ở create (cạnh dòng 41-42) và thêm vào `where` của `findAll`.

### 1.4 Sửa `try-on.service.ts` — phần quan trọng nhất

Đảo thứ tự: hiện `validateGarments()` chạy **trước** `resolveGarments()`, nên validate bằng dữ liệu client. Cần resolve product từ DB trước, rồi validate trên `layerRole` thật.

- `resolveGarments()`: khi có `productId`, lấy `layerRole` qua `resolveLayerRole(product)` thay vì tin `g.category`. Khi là ảnh upload tự do (không có productId) thì vẫn phải dựa vào input client — giữ nguyên, nhưng dùng `category` client gửi để suy ra layer.
- Chuyển logic validate combo sang chạy trên danh sách đã resolve. Luật mới:
  - `FULL_BODY` phải đứng một mình (giữ nguyên tinh thần dòng 145-152).
  - **Cho phép `OUTER` + `INNER`** (đây là fix chính — combo hiện đang bị chặn oan).
  - Chặn trùng lớp: 2 `OUTER`, 2 `INNER`, 2 `BOTTOM`.
  - Cho phép `OUTER`/`INNER` + `BOTTOM`.
- `mapCategory()` sang FASHN: map từ `LayerRole` (`BOTTOM→bottoms`, `FULL_BODY→one-pieces`, `OUTER|INNER→tops`) thay vì từ `GarmentCategory`.
- `categoryOrder()` (dòng 249): đổi thành thứ tự lớp để gửi ảnh cho FASHN đúng thứ tự mặc — `INNER(0) → BOTTOM(1) → OUTER(2) → FULL_BODY(3)`. Áo khoác phải đắp **sau** áo trong, nếu không ảnh ra sai lớp.
- `buildComboCacheKey()` (dòng 233): đưa `layerRole` vào key thay cho `category`, nếu không cache cũ sẽ trả kết quả của luật ghép cũ.
- `MAX_GARMENTS`: xác nhận giá trị hiện tại cho phép 3 món (INNER+BOTTOM+OUTER); nếu đang là 2 thì phải nâng, nếu không combo 3 lớp vẫn bị chặn.

Lưu ý `TryOnResult.category` (schema:603) vẫn là `GarmentCategory` — giữ nguyên để không phá dữ liệu cũ, chỉ ghi thêm layer vào cột `garments` Json đã có.

### 1.5 Sửa `product-suggestion.service.ts`

- Bỏ `toRole()` (dòng 324-341), thay bằng `resolveLayerRole()`. Giữ type `OutfitRole` hoặc đổi sang dùng `LayerRole` trực tiếp cho gọn — `ROLE_ORDER` (dòng 77) đổi thành `[OUTER, INNER, FULL_BODY, BOTTOM]`.
- Catalog gửi cho AI (`GARMENT_TYPE_LABELS` dòng 79-87, `CATEGORY_LABELS` dòng 89-93): thêm nhãn lớp mặc tiếng Việt (ví dụ "Khoác ngoài" / "Mặc trong") vào mô tả mỗi sản phẩm trong prompt, để AI tự biết món nào khoác ngoài được. Đây là thay đổi làm AI bớt gợi ý sai ngay từ đầu, không chỉ chặn ở tầng validate.
- `products.service.ts` phải `select` thêm `layerRole` ở query load catalog, nếu không helper nhận `undefined` và luôn fallback.

---

## Phase 2 — Chiến dịch sale theo nhóm (`promotions`)

### 2.1 Schema

Thêm vào `prisma/schema.prisma`:

```prisma
enum PromotionDiscountType {
  PERCENTAGE
  FIXED_AMOUNT
}

model Promotion {
  id             String                @id @default(uuid()) @db.Uuid
  name           String
  description    String?               @db.Text
  discountType   PromotionDiscountType @map("discount_type")
  discountValue  Decimal               @map("discount_value") @db.Decimal(10, 2)
  maxDiscountVnd BigInt?               @map("max_discount_vnd")
  priority       Int                   @default(0)
  isActive       Boolean               @default(true) @map("is_active")
  startsAt       DateTime?             @map("starts_at")
  endsAt         DateTime?             @map("ends_at")
  createdAt      DateTime              @default(now()) @map("created_at")
  updatedAt      DateTime              @updatedAt @map("updated_at")

  products    PromotionProduct[]
  collections PromotionCollection[]

  @@index([isActive, startsAt, endsAt])
  @@map("promotions")
}

model PromotionProduct {
  promotionId String    @map("promotion_id") @db.Uuid
  productId   String    @map("product_id") @db.Uuid
  promotion   Promotion @relation(fields: [promotionId], references: [id], onDelete: Cascade)
  product     Product   @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@id([promotionId, productId])
  @@index([productId])
  @@map("promotion_products")
}

model PromotionCollection {
  promotionId  String     @map("promotion_id") @db.Uuid
  collectionId String     @map("collection_id") @db.Uuid
  promotion    Promotion  @relation(fields: [promotionId], references: [id], onDelete: Cascade)
  collection   Collection @relation(fields: [collectionId], references: [id], onDelete: Cascade)

  @@id([promotionId, collectionId])
  @@map("promotion_collections")
}
```

Theo đúng pattern join-table của `ProductCollection` (schema:1206-1214) và pattern discount của `Coupon` (schema:805-824). Thêm back-relation `promotions` vào `Product` và `Collection`. Index `[isActive, startsAt, endsAt]` phục vụ đúng truy vấn "sale đang chạy".

**Không** thêm `salePrice` vào `Product` — giá sale là dẫn xuất (tính từ `price` + promotion đang hiệu lực), lưu trùng sẽ sinh hai nguồn sự thật. `originalPrice` giữ nguyên ý nghĩa marketing, và thêm validate `originalPrice >= price` trong create/update DTO cho sạch.

### 2.2 Module `src/modules/promotions/`

Module mới sở hữu **định nghĩa** chiến dịch (AGENTS.md chưa gán quyền này cho module nào; `orders` chỉ sở hữu việc *áp dụng*). Files: `promotions.module.ts`, `promotions.controller.ts` (admin CRUD, `JwtAuthGuard` + `RolesGuard` + `@Roles(Role.ADMIN)`), `promotions.service.ts`, `dto/create-promotion.dto.ts`, `dto/update-promotion.dto.ts`, `dto/query-promotion.dto.ts`. CRUD viết theo khuôn `coupons.service.ts` (kể cả cách bắt lỗi FK khi xoá → khuyên tắt `isActive`).

**`PricingService`** (`promotions/pricing.service.ts`) — đây là phần then chốt, export ra ngoài module:

```ts
resolveEffectivePrices(
  productIds: string[],
  at: Date,
  tx?: Prisma.TransactionClient,
): Promise<Map<string, { basePrice, effectivePrice, promotionId, discountPercent }>>
```

- Nhận `Prisma.TransactionClient` optional để gọi được **bên trong** transaction tạo order (AGENTS.md: "pass `Prisma.TransactionClient` into them instead of opening a new transaction").
- Query promotion active tại `at`, match theo `PromotionProduct` **hoặc** qua `PromotionCollection → ProductCollection`.
- Một sản phẩm trúng nhiều promotion → chọn theo `priority` cao nhất, tie-break bằng mức giảm lớn nhất. **Không cộng dồn** nhiều promotion.
- Clamp: `effectivePrice` không âm, không vượt `basePrice`.

### 2.3 Áp giá sale vào các điểm tính tiền

- **`orders.service.ts:985 buildOrderPricing`**: thay `Number(product.price)` (dòng 989) bằng `effectivePrice` từ `PricingService`. Trả thêm `itemsDiscountFromPromotions` để response tách rạch ròi giảm-giá-sale với giảm-giá-coupon.
- **Thứ tự áp dụng (phải chốt rõ):** sale áp ở mức từng dòng sản phẩm trước → ra `itemsTotal` → coupon (`resolveDiscountAmount`, dòng 1049) áp trên `itemsTotal` đã sale. Nghĩa là coupon và sale **cộng dồn được**. `minOrderVnd` của coupon so với `itemsTotal` sau sale.
- **`orders.service.ts:261-263`** (trong transaction tạo order): `price`/`unitPriceVnd`/`lineTotalVnd` ghi theo giá sale. Comment hiện tại ở dòng 259-260 ("chốt giá server tại thời điểm đặt hàng") vẫn đúng tinh thần. Gọi `PricingService` với `tx` và **cùng một mốc `at`** đã dùng ở `buildOrderPricing`, nếu không một sale hết hạn giữa quote và create sẽ làm giá ghi vào `OrderItem` lệch với `total` của đơn.
- **Snapshot:** thêm cột `promotionIdSnapshot` + `basePriceSnapshot` vào `OrderItem` để sau này biết đơn này được giảm nhờ campaign nào. Cùng migration với 2.1.
- **`cart.service.ts:305-306`**: trả thêm `effectivePrice`/`discountPercent` cho hiển thị. Giữ comment "display-only, order vẫn recompute".
- **`products.service.ts` `findOne`/`findAll`**: trả `effectivePrice` + `discountPercent` + `promotion` tóm tắt. Thêm filter `onSale=true`. Dùng batch `resolveEffectivePrices` cho cả trang để tránh N+1.
- **`quote` (dòng 82)**: tự khớp vì dùng chung `buildOrderPricing`. `quoteToken` đã ký theo `total` (dòng 87, 183-184) nên sale đổi giữa quote và create sẽ bị `assertQuoteToken` bắt — đúng hành vi mong muốn, nhưng cần trả lỗi dễ hiểu ("giá đã thay đổi, vui lòng tải lại").

### 2.4 Không cần cron

Promotion hiệu lực được tính theo thời điểm truy vấn (`startsAt <= now <= endsAt`), nên tự bật/tắt. Không cần job `outbox`/cron — tránh thêm hạ tầng không cần thiết.

---

## Files chính

**Phase 1:** `prisma/schema.prisma` (+migration), `src/modules/products/utils/layer-role.util.ts` (mới), `products/dto/{create,query}-product.dto.ts`, `products/products.service.ts`, `products/product-suggestion.service.ts`, `try-on/try-on.service.ts`, `try-on/try-on.controller.ts` (Swagger enum dòng 53/57).

**Phase 2:** `prisma/schema.prisma` (+migration), `src/modules/promotions/*` (mới), `orders/orders.service.ts`, `cart/cart.service.ts`, `products/products.service.ts`, `app.module.ts`.

**Cuối cùng:** cập nhật `AGENTS.md` — khai báo ownership của `promotions` (định nghĩa campaign) vs `orders` (áp dụng), và ghi chú `layerRole` là nguồn sự thật cho phân lớp AI.

## Verification

- `npm run lint:check` và `npm run build`.
- `npm run prisma:generate` sau mỗi thay đổi schema.
- **Unit tests** (`test/unit`):
  - `resolveLayerRole`: mọi `garmentType`, product `layerRole=null` (fallback), product có `layerRole` ghi đè suy luận.
  - Validate combo try-on: OUTER+INNER **pass** (regression chính), OUTER+OUTER fail, INNER+INNER fail, FULL_BODY+bất kỳ fail, OUTER+INNER+BOTTOM pass.
  - `resolveEffectivePrices`: product match trực tiếp, match qua collection, 2 promotion chồng nhau → chọn theo priority, promotion ngoài khoảng ngày → không áp, `isActive=false` → không áp, FIXED_AMOUNT lớn hơn giá → clamp không âm, `maxDiscountVnd` chặn trần.
- **E2E** (`test/e2e`, dùng helper sẵn ở `test/e2e/helpers`):
  - Order tạo trong lúc sale chạy: `OrderItem.price` = giá sale, `total` khớp.
  - Sale + coupon cộng dồn đúng thứ tự.
  - Client gửi `total` theo giá gốc → backend vẫn thu giá sale (AGENTS.md: không tin client).
  - Try-on với `productId` + `category` client gửi sai lệch → backend dùng `layerRole` từ DB, không dùng input client.
- Kiểm tra bằng tay: đọc comment ở `try-on.service.ts` để xác nhận `MAX_GARMENTS` đủ cho 3 lớp trước khi test combo 3 món.
