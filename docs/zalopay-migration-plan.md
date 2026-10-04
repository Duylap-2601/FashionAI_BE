# Plan: Migrate MoMo → ZaloPay (sandbox) — Strategy + Adapter

Status: APPROVED (plan-reviewer, round 5) — chờ người duyệt D2, D3, D8 trước Phase 2
Scope: `FashionAI_BE` only. Branch base: `feat/momo-payment-migration`.
Tài liệu ZaloPay tham chiếu: `docs.zalopay.vn/docs/specs/{order-create,order-query,callback-api,order-refund,order-query-refund}`,
`docs.zalopay.vn/docs/developer-tools/knowledge-base/status-codes`.

## 1. Bối cảnh (code hiện tại)

- `PaymentsService` gọi trực tiếp `MomoPaymentProvider` trong 3 luồng:
  `createMomoCheckoutLink`, `handleMomoIPN`, `refundMomoPayment`
  (`src/modules/payments/payments.service.ts` ~L260–640). Controller là caller duy nhất.
- `'MOMO'` hard-code ở `dto/checkout.dto.ts` (enum + default `'MOMO'`),
  `orders/orders.service.ts:524`, `payments.controller.ts` (`momo/ipn`, `momo/return`).
- Schema đa cổng sẵn, **không cần migration**: `Payment` unique `(provider, providerPaymentId)`,
  `(provider, transactionId)`; `Refund` unique `(provider, providerRefundId)`, `idempotencyKey`;
  `WebhookEvent.eventKey` unique; index `[provider, status, createdAt]`.
- `processOrderSuccess` (L986): order PAID → return "already processed" (không đụng payment);
  order ≠ PENDING → ghi `WebhookFailure(INVALID_ORDER_STATUS)` + throw 400; claim qua
  `order.updateMany({status: PENDING})`; ghi `payment.transactionId = paymentData.transId ?? reference ?? Date.now()`.
- Global `ValidationPipe({ whitelist, forbidNonWhitelisted })` (`main.ts:46`).
- `MaintenanceService` (đã inject `PaymentsService`, gate `MAINTENANCE_CRON_ENABLED`);
  `RedisService.acquireLock/releaseLock` (`common/services/redis.service.ts:137`).
- **Baseline đỏ**: `test/e2e/payments-{checkout,webhook}.e2e-spec.ts` không compile
  (Prisma client stale: `Payment.expiresAt`), test module thiếu `MomoPaymentProvider`,
  checkout spec kỳ vọng default `SEPAY` trong khi DTO default `MOMO`. Không có test MoMo nào.
- SePay **ngoài phạm vi** (giữ nhánh riêng như hiện tại).

## 2. Khác biệt MoMo vs ZaloPay v2 ảnh hưởng thiết kế

| | MoMo | ZaloPay v2 | Hệ quả |
|---|---|---|---|
| Ký request | HMAC(secretKey, `k=v&...`) | HMAC(key1, `app_id\|app_trans_id\|app_user\|amount\|app_time\|embed_data\|item`) | ký trong adapter |
| Verify callback | secretKey | HMAC(**key2**, `data`); body `{data: string(JSON), mac, type}` | parser riêng, không dùng DTO class |
| Mã đơn | tự do, gọi create lại được | `app_trans_id` = `yyMMdd_xxx` (ngày GMT+7 hiện tại), ≤ 40, **trùng → -68** | không gọi create lại cho payment cũ |
| requestId | có | không | check chỉ khi có |
| Callback | cả thành công & thất bại | **chỉ khi thành công**; response `{return_code: 1 success \| 2 invalid}` | bắt buộc reconcile bằng query |
| Query | — (không reconcile) | `return_code` 1 paid; 2 + sub `-54` hết hạn; 2 khác (vd `-63` thiếu số dư, `-92/-101` lỗi tra cứu) & 3 = chưa kết thúc | chỉ `1` / `-54` là terminal |
| Refund | sync (`resultCode 0` = xong) | `/v2/refund` 1 & 3 = **mới nhận yêu cầu**; 2 = khởi tạo thất bại; kết quả cuối qua `/v2/query_refund` | refund có PENDING + finalize dùng chung |
| Content-Type | JSON | JSON hoặc form-urlencoded (chọn form theo sample) | chỉ khác ở adapter |

## 3. Kiến trúc

- **Strategy**: interface `PaymentGateway`; `PaymentsService` chọn implementation theo
  `dto.provider` hoặc `PAYMENT_DEFAULT_PROVIDER`.
- **Adapter**: mỗi cổng 1 class chuyển API riêng → interface chuẩn.
  `MomoGateway` bọc `MomoPaymentProvider` có sẵn; `ZaloPayGateway` tự gọi HTTP (gộp client
  vào adapter — 1 lớp, ~200 dòng; tách sau nếu lớn).
- **Registry**: provider Nest inject các gateway qua multi-token.

```
src/common/constants/payment.constants.ts   # ONLINE_REFUND_PROVIDERS (dùng bởi orders + payments)
src/modules/payments/
  gateways/
    payment-gateway.types.ts      # interface PaymentGateway + types chuẩn hoá, InvalidGatewaySignatureError
    payment-gateway.registry.ts   # resolve(code), getDefault(), has(code), reconcilable()
                                  # + PAYMENT_GATEWAYS token, GatewayCode
  momo/
    momo-payment.provider.ts      # giữ nguyên
    momo-signature.service.ts     # giữ nguyên
    momo.constants.ts             # giữ nguyên
    momo.gateway.ts               # MỚI: adapter
  zalopay/
    zalopay.constants.ts          # path, return/sub codes, ZALOPAY_PROVIDER, field order
    zalopay-mac.util.ts           # pure: hmac, signCreate/Query/Refund/QueryRefund, verifyCallback
    zalopay.gateway.ts            # adapter + HTTP (create/query/refund/queryRefund) + parseCallback
    zalopay-ack.util.ts           # pure: toZaloPayAck(err | null)
```

### 3.1 Interface

```ts
export type GatewayCode = 'MOMO' | 'ZALOPAY';
export type GatewayResultStatus = 'SUCCESS' | 'FAILED' | 'PENDING';

export interface GatewayCreateInput {
  paymentId: string; orderCode: number; userId: string;
  providerOrderId: string; requestId: string;
  amountVnd: number; description: string;
  redirectUrl: string; expiresAt: Date;
}
export interface GatewayCreateResult {
  checkoutUrl: string; payUrl?: string; deeplink?: string;
  qrCodeUrl?: string;   // MoMo: URL ảnh
  qrCode?: string;      // ZaloPay: nội dung QR (FE tự render)
  raw: Record<string, unknown>;
}
export interface GatewayPaymentResult {
  providerOrderId: string; amountVnd: number;
  status: GatewayResultStatus;
  transactionId?: string;        // MoMo transId / ZaloPay String(zp_trans_id)
  requestId?: string;            // chỉ MoMo
  eventKey: string;              // dùng chung cho callback + query
  failureReason?: string;
  raw: Record<string, unknown>;
}
export interface GatewayRefundInput {
  refundId: string; requestId: string; transactionId: string;
  amountVnd: number; description: string;
}
export interface GatewayRefundResult {
  status: GatewayResultStatus; message?: string;
  providerRefundRef?: string;    // ZaloPay refund_id (phải lưu)
  raw: Record<string, unknown>;
}

export interface PaymentGateway {
  readonly code: GatewayCode;
  /** thời hạn payment phía mình; payment.expiresAt = now + ttl */
  readonly checkoutTtlMs: number;
  /** link đã lưu chỉ được dùng lại khi payment.createdAt > now - linkReuseMs (≤ thời hạn link phía cổng) */
  readonly linkReuseMs: number;
  buildProviderOrderId(orderCode: number, now?: Date): string;
  buildRefundId(orderCode: number, now?: Date): string;
  createPayment(input: GatewayCreateInput): Promise<GatewayCreateResult>;
  /** verify chữ ký + chuẩn hoá; throw BadRequestException (MoMo giữ message cũ) */
  parseCallback(body: unknown): GatewayPaymentResult;
  refund(input: GatewayRefundInput): Promise<GatewayRefundResult>;
  /**
   * có → payment PENDING của cổng này được cron reconcile.
   * pastExpiry=true: đã quá expiresAt + grace → kết quả "chưa thanh toán" của cổng coi là FAILED.
   */
  queryPayment?(providerOrderId: string, requestId: string, opts?: { pastExpiry: boolean }): Promise<GatewayPaymentResult>;
  /** có → refund PROCESSING của cổng này được cron reconcile */
  queryRefund?(refundId: string): Promise<GatewayRefundResult>;
}
```

MoMo **không** implement `queryPayment`/`queryRefund` (không reconcile MoMo, tránh map sai
code 1000/7000/7002). `checkoutTtlMs` của MoMo = `CHECKOUT_TTL_MS` hiện tại (không đổi hành vi);
`linkReuseMs` MoMo = 90 phút (D8 — xác nhận thời hạn `payUrl` MoMo). ZaloPay: `checkoutTtlMs = 15m`,
`linkReuseMs = 14m`.

### 3.2 Registry + wiring

```ts
@Injectable()
export class PaymentGatewayRegistry {
  private readonly map: Map<GatewayCode, PaymentGateway>;
  private readonly defaultCode: GatewayCode;
  constructor(@Inject(PAYMENT_GATEWAYS) gateways: PaymentGateway[], config: ConfigService) {
    this.map = new Map(gateways.map((g) => [g.code, g]));
    const code = config.get<string>('PAYMENT_DEFAULT_PROVIDER', 'MOMO');
    if (!this.map.has(code as GatewayCode)) throw new Error(`Invalid PAYMENT_DEFAULT_PROVIDER=${code}`); // fail fast at boot
    this.defaultCode = code as GatewayCode;
  }
  resolve(code: string): PaymentGateway { /* BadRequestException nếu không có */ }
  getDefault(): PaymentGateway { return this.map.get(this.defaultCode)!; }
  has(code: string): boolean { return this.map.has(code as GatewayCode); }
  withPaymentQuery(): PaymentGateway[] { return [...this.map.values()].filter((g) => g.queryPayment); }
  withRefundQuery(): PaymentGateway[] { return [...this.map.values()].filter((g) => g.queryRefund); }
}
// payments.module.ts
{ provide: PAYMENT_GATEWAYS, useFactory: (m: MomoGateway, z: ZaloPayGateway) => [m, z], inject: [MomoGateway, ZaloPayGateway] }
```

### 3.3 Luồng dùng chung trong `PaymentsService`

**Checkout `createGatewayCheckoutLink(order, gateway)`**
1. Tìm payment `PENDING` cùng `(orderId, provider)` có `expiresAt > now + 60s`,
   `createdAt > now - gateway.linkReuseMs` **và** có link đã lưu (`paymentData.checkoutUrl ?? paymentData.payUrl`
   — fallback `payUrl` cho row MoMo cũ) → trả lại artifact đã lưu, **không gọi `createPayment`**.
2. Ngược lại tạo payment mới (`providerPaymentId = gateway.buildProviderOrderId`,
   `idempotencyKey = uuid`, `expiresAt = now + gateway.checkoutTtlMs`), gọi `createPayment`.
3. Lỗi create (throw hoặc không có `checkoutUrl`) → mark FAILED **chỉ payment vừa tạo**
   (conditional `updateMany({id, status: PENDING})`).
4. Lưu `paymentData = { providerResponse, checkoutUrl, payUrl, deeplink, qrCodeUrl, qrCode }`,
   update order (`paymentProvider`, `checkoutUrl`, `checkoutExpiresAt`) như hiện tại.
5. Response giữ shape cũ: `orderId, orderCode, paymentId, amount, targetTier, kind, provider,
   checkoutUrl, payUrl, deeplink, qrCodeUrl, extra{providerOrderId, requestId}` + thêm `qrCode`.

**Áp dụng kết quả thanh toán `applyGatewayPaymentResult(gateway, result, source: 'CALLBACK'|'QUERY')`**
(dùng chung cho callback và reconcile; throw HttpException giống code hiện tại)
1. Tìm payment theo `(provider, providerPaymentId)`; không có → `WebhookFailure(PAYMENT_NOT_FOUND)` + 404.
2. `result.requestId` có & ≠ `payment.idempotencyKey` → `WebhookFailure(REQUEST_ID_MISMATCH)` + 400.
3. amount lệch → `WebhookFailure(AMOUNT_MISMATCH)` + 400.
   Ở bước 2–3, nếu `result.status === 'SUCCESS'` (cổng đã thu tiền): trước khi throw,
   `markRefundRequired(payment, result, reason)` — **một interactive `$transaction`**:
   `payment.updateMany({ id, status: PENDING } → REFUND_REQUIRED, transactionId, paidAt, failureReason,
   paymentData: { ...paymentData, collectedAmountVnd: result.amountVnd, refundScope: 'PAYMENT_ONLY' } })`
   (`refundScope` là **marker vĩnh viễn**: payment này không bao giờ là payment trả tiền cho đơn, kể cả sau khi
   thành `REFUNDED`); khi count = 1, trong cùng transaction: `orderEvent PAYMENT_REFUND_REQUIRED`
   (không `.catch(P2002)` trong tx — gate count = 1 đã bảo đảm 1 lần) với
   `publicMessage: 'Đã nhận khoản thanh toán không thể ghi nhận cho đơn này, khoản tiền sẽ được hoàn lại.'`
   (dedupe key `payment:${provider}:${transactionId}:refund-required`). **Sau commit** (best-effort, dùng
   `this.prisma` như `recordWebhookFailure` hiện tại): ghi `WebhookFailure` trừ khi `processOrderSuccess` đã ghi
   (xem bước 5). Lần lặp sau payment không còn PENDING → không ghi thêm, cron không chọn lại.
4. **Claim WebhookEvent** theo `result.eventKey` (`eventType = PAYMENT_CALLBACK | PAYMENT_QUERY`).
   `processedAt` kiêm *lease timestamp* khi status = PROCESSING:
   - create mới (`status PROCESSING, attemptCount 1, processedAt now`) → tiếp tục.
   - P2002 → đọc event `{status, attemptCount, processedAt, receivedAt}`:
     `PROCESSED` → return `'DUPLICATE'`;
     `FAILED_RETRYABLE`, hoặc `PROCESSING` có `(processedAt ?? receivedAt) < now-5m` → reclaim với
     optimistic version: `updateMany({ where: { eventKey, status: <đọc>, attemptCount: <đọc> },
     data: { status: PROCESSING, attemptCount: <đọc>+1, processedAt: now } })`;
     count 0 → `'DUPLICATE'` (worker khác đã reclaim); `PROCESSING` còn lease → `'DUPLICATE'`.
5. `SUCCESS`: gọi `processOrderSuccess(orderCode, provider, { ...raw, transId: result.transactionId,
   providerOrderId, paymentId }, amount, payment.id)`; chỉ bắt `BadRequestException`
   (lỗi khác → rethrow, event FAILED_RETRYABLE). Sau đó, nếu payment **vẫn PENDING**:
   - order đã PAID bởi payment khác (return "already processed", không throw) →
     `markRefundRequired` + `WebhookFailure(DUPLICATE_PAYMENT)` (khi count = 1);
   - `processOrderSuccess` đã throw 400 (order CANCELLED/EXPIRED, amount ≠ order.amount — nó **đã tự ghi**
     `WebhookFailure(INVALID_ORDER_STATUS | AMOUNT_MISMATCH)`) → `markRefundRequired`, **không** ghi thêm
     WebhookFailure, nuốt lỗi → event PROCESSED.
   ⇒ payment đã được cổng xác nhận **không bao giờ** bị mark FAILED và không bị cron chọn lại.
6. `FAILED`: `payment.updateMany({ id, status: PENDING } → FAILED, failedAt, failureReason)`.
7. `PENDING` (chỉ từ query): return sớm **trước** bước 4 — không tạo WebhookEvent, không đổi state.
8. Event → `PROCESSED`; lỗi giữa chừng → `FAILED_RETRYABLE` + rethrow (như hiện tại).

**Callback `handleGatewayCallback(code, body): Promise<'OK' | 'DUPLICATE'>`** = `gateway.parseCallback(body)` →
`applyGatewayPaymentResult(..., 'CALLBACK')`. Giữ nguyên các HttpException/message hiện tại.
Body trả về do **controller** map: route `momo/ipn`: `OK → {resultCode: 0, message: 'Success'}`,
`DUPLICATE → {resultCode: 0, message: 'Duplicate IPN acknowledged'}` (như hiện tại);
route `zalopay/callback`: `toZaloPayAck` (step 10).

**Refund**
- `refundGatewayPayment(paymentId, dto, adminId)`: giữ guard hiện tại
  (idempotencyKey replay, `registry.has(provider)`, có transactionId, amount ≤ remaining), mở rộng trạng thái:
  - `payment.status === PAID` → như hiện tại (yêu cầu `order.paymentStatus === PAID`).
  - `payment.status === REFUND_REQUIRED` (tiền thừa / đơn đã đóng) → bỏ check `order.paymentStatus`;
    `collected = paymentData.collectedAmountVnd ?? payment.amountVnd` (số tiền cổng **thực thu**) dùng cho cả
    `paidAmount` (tính remaining) và điều kiện `dto.amountVnd === collected` (hoàn toàn bộ).
  - **Scope không lưu trong refund metadata** (mutable). `refundScopeOf(payment)` =
    `payment.paymentData?.refundScope === 'PAYMENT_ONLY' ? 'PAYMENT_ONLY' : 'ORDER'` — đọc lại từ payment mỗi lần
    (lúc tạo refund và trong `finalizeRefund`).
  - **Mọi write vào `refund.metadata` phải merge** `{ ...refund.metadata, ... }` (PENDING + `providerRefundRef`,
    bump reconcile, `providerResponse` khi finalize) — sửa luôn pattern ghi đè hiện tại (`payments.service.ts:566, 582`)
    để không mất `requestedBy`, `originalTransId`, ZaloPay `refund_id`.
  - trạng thái khác → 400.
  Gọi `gateway.refund`: `SUCCESS` → `finalizeRefund(COMPLETED)`; `FAILED` → `finalizeRefund(FAILED)`;
  `PENDING` → refund `PROCESSING` + lưu `providerRefundRef` vào `metadata`, trả về PROCESSING;
  throw → giữ hành vi hiện tại (PROCESSING + 503).
- `finalizeRefund(refundId, outcome, providerResponse)` — **một transaction**:
  claim `refund.updateMany({ id, status: { in: [PENDING, PROCESSING] } })` (count 0 → return refund hiện tại);
  `orderEvent.create` **không** bọc `.catch(P2002)` trong transaction (claim đã bảo đảm 1 lần; PostgreSQL
  abort transaction khi statement lỗi).
  - Scope `ORDER` (payment PAID — payment trả tiền cho đơn). Mọi aggregate COMPLETED sum đều
    `where: { paymentId: <payment trả tiền>, status: COMPLETED }` (theo payment, như code hiện tại L585) —
    refund PAYMENT_ONLY của payment khác không bao giờ được cộng vào.
    COMPLETED: aggregate COMPLETED sum → order `amountRefundedVnd`, `refundStatus`,
    `paymentStatus REFUNDED | PARTIALLY_REFUNDED`, payment status + `refundedAt`, `orderEvent REFUND_COMPLETED`;
    FAILED: order `refundStatus FAILED`, `paymentStatus` = `PARTIALLY_REFUNDED` nếu COMPLETED sum > 0, ngược lại `PAID`
    (sửa lỗi hiện tại ép `PAID`).
  `finalizeRefund` load payment trong tx, scope = `refundScopeOf(payment)`.
  - Scope `PAYMENT_ONLY` (payment có marker `refundScope`): chỉ cập nhật refund + payment
    (COMPLETED → `REFUNDED, refundedAt`; FAILED → giữ `REFUND_REQUIRED`) + `orderEvent` (không đổi
    status/money của order). Lúc tạo refund cũng **không** đổi `order.refundStatus/paymentStatus`.
    Khách theo dõi qua `history[].publicMessage` (AGENTS.md order tracking):
    request → `'Đang hoàn lại khoản thanh toán không hợp lệ qua <cổng>.'`,
    COMPLETED → `'Khoản thanh toán không hợp lệ đã được hoàn lại.'`,
    FAILED → event nội bộ (không publicMessage), admin thử lại.
  Message public dùng tên cổng (không cứng "MoMo").
- `finalizeRefund`, scope `PAYMENT_ONLY` và refund `PENDING` thuộc **Phase 1**; Phase 0 giữ nguyên code refund
  inline (kể cả `.catch(P2002)` cũ).

### 3.4 Reconcile (chỉ cổng có `queryPayment`/`queryRefund` → ZaloPay)

- `MaintenanceService`: `@Cron(EVERY_MINUTE, { name: 'payment-gateway-reconcile' })` →
  `if (!this.enabled) return;` → `paymentsService.reconcileGatewayPayments()`.
- `reconcileGatewayPayments()`: in-process `running` flag + `redis.acquireLock('payment-gateway-reconcile', 120)`;
  release ở `finally`.
- Payment — chọn theo **đến hạn**, không theo cũ nhất. Điều kiện chung: `status PENDING`,
  `provider in withPaymentQuery()`, `createdAt < now-2m`, `createdAt > now-7d` (hard cap).
  Backoff theo tuổi, dùng `updatedAt` làm "lần query gần nhất" (OR 3 nhánh):
  - `expiresAt > now-30m` & `updatedAt < now-1m` (mỗi phút tới hết grace);
  - `expiresAt ∈ [now-24h, now-30m]` & `updatedAt < now-30m` (mỗi 30 phút);
  - `expiresAt < now-24h` & `updatedAt < now-6h` (mỗi 6 giờ).
  `orderBy updatedAt asc`, `take 50`, timeout query 10s. Sau **mỗi** lần query còn PENDING (kể cả lỗi query):
  `payment.updateMany({ id, status: PENDING }, data: { paymentData: { ...pd, lastQueriedAt, queryCount+1, lastQueryError? } })`
  → bump `updatedAt` ⇒ xoay vòng, payment kẹt không chiếm batch (~70 query/payment sau giờ đầu, trong 7 ngày).
  **Luôn query cổng, không bao giờ FAILED mà không hỏi cổng**:
  `queryPayment(..., { pastExpiry: expiresAt < now-30m })` → `applyGatewayPaymentResult(..., 'QUERY')`.
  ZaloPay mapping (step 9): `1 → SUCCESS`; `2 + -54 → FAILED`; `pastExpiry` & `2` + sub thuộc
  `ZALOPAY_QUERY_UNPAID_SUBCODES` (mô tả *đơn* chưa/không thanh toán: -54, -63, -101, -217, -332, -333,
  -1330..-1343 — xác nhận lại với status-codes khi code) → FAILED;
  `2` + sub lỗi request/hệ thống (-92, -401, -402, -429, -500, -999, sub lạ) → coi như **lỗi query** → PENDING + log;
  `3` / lỗi HTTP/timeout → PENDING, thử lại theo backoff.
  Payment > 7 ngày vẫn PENDING → ra khỏi cửa sổ, giữ PENDING để admin tra (không tự FAILED). Lỗi từng item log + tiếp tục.
- ZaloPay `checkoutTtlMs = 15 phút` (`expire_duration_seconds = 900`) ⇒ trường hợp thường payment kết thúc
  (SUCCESS hoặc FAILED) trong ≤ ~45 phút.
- Refund: `status PROCESSING`, `provider in withRefundQuery()`, `providerRefundId` có,
  `requestedAt > now-7d`, `updatedAt < now-1m` (sau 1h: `< now-30m`), `orderBy updatedAt asc`, take 50 →
  `queryRefund` → `SUCCESS`/`FAILED` → `finalizeRefund`; `PENDING`/lỗi → `refund.updateMany({ id, status: PROCESSING },
  metadata.lastQueriedAt)` để bump `updatedAt` (xoay vòng như payment).
- **Bỏ** query on-demand trong `getPaymentStatus` (cron đủ; test local dùng ngrok hoặc chờ ≤ 1 phút).

## 4. Các bước

### Phase 0 — Baseline xanh + refactor MoMo sau interface (không đổi hành vi, PR riêng)

0. Baseline: `npm run prisma:generate`; sửa test module của `payments-{checkout,webhook}.e2e-spec.ts`
   (provide gateway/registry, mock HTTP của `MomoPaymentProvider`); checkout spec truyền
   `provider: 'SEPAY'` tường minh cho case SePay + thêm case "không truyền provider → MOMO".
1. **Trước refactor**: viết characterization test MoMo `test/e2e/payments-momo.e2e-spec.ts`
   (mock `MomoPaymentProvider` HTTP, ký IPN bằng `MomoSignatureService` thật) — xem M-* ở §5. Chạy xanh trên code cũ.
2. Tạo `gateways/*`, `momo/momo.gateway.ts`, `common/constants/payment.constants.ts`.
   MoMo: `parseCallback` = `verifyIpn` + map (`resultCode 0 → SUCCESS`, khác → FAILED,
   eventKey format cũ `MOMO:${orderId}:${requestId}:${resultCode}:${transId}`); `refund` `resultCode 0 → SUCCESS`, khác → FAILED.
3. `PaymentsService`: thay 3 method MoMo bằng `createGatewayCheckoutLink`, `handleGatewayCallback`
   (trả `'OK' | 'DUPLICATE'`, controller map body), `refundGatewayPayment`, giữ logic cũ.
   Phase 0 **chưa** đổi: reuse §3.3-1, `markRefundRequired`, claim/reclaim §3.3-4, REFUND_REQUIRED §3.3-5,
   `finalizeRefund`/scope/refund PENDING, FAILED-path paymentStatus — tất cả để Phase 1.
4. Controller `momo/ipn` → `handleGatewayCallback('MOMO', payload)`; refund route → `refundGatewayPayment`.
5. `orders.service.ts:524` → `ONLINE_REFUND_PROVIDERS.includes(payment.provider)` (`['MOMO']` ở Phase 0).
6. Verify: `npm run lint:check`, `npm run build`, `npm run test:unit`, `npm run test:e2e` — M-* + baseline xanh, không sửa assertion M-*.

### Phase 1 — Hành vi dùng chung mới + ZaloPay adapter

7. Áp dụng §3.3 đầy đủ (reuse artifact, conditional writes, event reclaim, REFUND_REQUIRED +
   refund scope `PAYMENT_ONLY`, `finalizeRefund`, FAILED-path paymentStatus, refund PENDING).
   Hành vi MoMo đổi có chủ đích (ghi rõ trong PR, cập nhật M-*): M-4 (amount lệch + `resultCode 0`) → payment
   REFUND_REQUIRED; checkout MoMo lần 2 trong 90 phút dùng lại link (không gọi create lại).
8. `zalopay-mac.util.ts`, `zalopay-ack.util.ts`, `zalopay.constants.ts`.
9. `zalopay.gateway.ts`:
   - `buildProviderOrderId`: `${yyMMdd GMT+7}_${orderCode}${rand6hex}` (≤ 40).
   - `createPayment`: form-urlencoded `/v2/create`, `app_user = userId`, `app_time = Date.now()`,
     `embed_data = JSON.stringify({ redirecturl, paymentId })`, `item = '[]'`,
     `expire_duration_seconds = 900`, `callback_url = ZALOPAY_CALLBACK_URL`, `description` cắt 256.
     `return_code !== 1` → throw `BadRequestException(sub_return_message)`.
     Map `order_url → checkoutUrl & payUrl`, `qr_code → qrCode`.
   - `parseCallback(body: unknown)`: validate tay (`data`, `mac` là string; `JSON.parse` có guard),
     verify mac(key2) timing-safe, `app_id` khớp config → `{ providerOrderId: app_trans_id,
     amountVnd: amount, status: 'SUCCESS', transactionId: String(zp_trans_id),
     eventKey: 'ZALOPAY:' + app_trans_id + ':' + zp_trans_id }`. Sai → `BadRequestException`.
   - `queryPayment`: `1 → SUCCESS` (eventKey cùng format callback `ZALOPAY:${app_trans_id}:${zp_trans_id}`),
     `2 + sub -54` hoặc (`pastExpiry` & `2` & sub ∈ `ZALOPAY_QUERY_UNPAID_SUBCODES`) → FAILED
     (eventKey `ZALOPAY:${app_trans_id}:FAILED`); `2` + sub lỗi request/hệ thống
     (-92/-401/-402/-429/-500/-999/lạ) → throw `GatewayQueryError` (cron coi như lỗi query, PENDING);
     `3` / `2` khác khi chưa quá hạn → PENDING; lỗi HTTP/timeout → throw (cron coi như PENDING).
   - `refund`: `m_refund_id = ${yyMMdd}_${appId}_${orderCode}${rand}` (= `providerRefundId`);
     `1 | 3 → PENDING` (lưu `refund_id`), `2 → FAILED`.
   - `queryRefund`: `1 → SUCCESS`; `2` + sub thuộc {-2,-13,-14,-32,-101} → FAILED; còn lại (`3`, `-1`, `-16`, -429, -500…) → PENDING.
   - Timeout: create/refund 30s, query 10s.
10. Controller `POST payments/zalopay/callback` (`@Public()`, `@HttpCode(200)`,
    `@Body() body: Record<string, unknown>` để bypass ValidationPipe):
    `try { await handleGatewayCallback('ZALOPAY', body); return toZaloPayAck(null) } catch (e) { return toZaloPayAck(e) }`.
    `toZaloPayAck`: null/duplicate → `{return_code: 1, return_message: 'success'}`;
    `HttpException` 4xx → `{return_code: 2, return_message: <message>}`;
    lỗi khác (DB/transient) → **rethrow** (HTTP 500, ZaloPay sẽ gọi lại; cron là lưới an toàn).
    Không thêm route `zalopay/return` (redirecturl trỏ về FE).
11. `MaintenanceService` cron + `PaymentsService.reconcileGatewayPayments()` (§3.4).
12. `CheckoutDto.provider`: `@IsIn(['MOMO','ZALOPAY','SEPAY'])`, bỏ default; service:
    `SEPAY` → nhánh cũ, có giá trị → `registry.resolve`, không có → `registry.getDefault()`.
13. `ONLINE_REFUND_PROVIDERS = ['MOMO', 'ZALOPAY']`; sửa guard `orders.service.ts:524` chỉ chặn khi
    **payment đã trả tiền cho đơn** là online:
    `payments.some(p => ONLINE_REFUND_PROVIDERS.includes(p.provider) && p.paymentData?.refundScope !== 'PAYMENT_ONLY'
      && [PAID, PARTIALLY_REFUNDED, REFUNDED].includes(p.status))`
    (`Payment.status` không bao giờ là `REFUND_PENDING` — giá trị đó chỉ ở `order.paymentStatus`;
    bảo đảm `findOrderByIdentifier` select `payments.status` + `payments.paymentData`); lookup `existingRefund` của luồng manual
    (`orders.service.ts` ~L540) thêm `provider: 'MANUAL'` để không đụng refund PAYMENT_ONLY của cổng.
14. `.env.example`: `ZALOPAY_APP_ID`, `ZALOPAY_KEY1`, `ZALOPAY_KEY2`,
    `ZALOPAY_ENDPOINT=https://sb-openapi.zalopay.vn`, `ZALOPAY_CALLBACK_URL=.../api/payments/zalopay/callback`,
    `ZALOPAY_REDIRECT_URL`, `PAYMENT_DEFAULT_PROVIDER=MOMO`. Sandbox app công khai (xác nhận key từ docs).
15. `AGENTS.md`: mục `payments` — cổng online mới implement `PaymentGateway`; reconcile cron.

### Phase 2 — Chuyển default (config only, cần người duyệt)

16. `PAYMENT_DEFAULT_PROVIDER=ZALOPAY` trên môi trường test. MoMo adapter giữ cho IPN + refund payment cũ.
    FE: dùng `checkoutUrl`; QR ZaloPay ở `qrCode` (nội dung, không phải URL).
17. Gỡ MoMo: task riêng khi không còn payment MoMo PENDING/refundable.

## 5. Acceptance cases

| ID | Case | File → test |
|---|---|---|
| B-1 | Baseline payments-checkout/webhook compile & xanh | `test/e2e/payments-checkout.e2e-spec.ts`, `payments-webhook.e2e-spec.ts` (hiện có) |
| B-2 | Checkout không truyền provider → MOMO (Phase 0) / `PAYMENT_DEFAULT_PROVIDER` (Phase 1) | `payments-checkout.e2e-spec.ts` → `[B-2] uses default provider` |
| M-1 | MoMo IPN success → order PAID, payment PAID, `transactionId = String(transId)` | `test/e2e/payments-momo.e2e-spec.ts` → `[M-1]` |
| M-2 | MoMo IPN trùng → `{resultCode:0,'Duplicate IPN acknowledged'}`, không xử lý lại | `payments-momo` → `[M-2]` |
| M-3 | requestId lệch → 400 + `WebhookFailure(REQUEST_ID_MISMATCH)` | `payments-momo` → `[M-3]` |
| M-4 | amount lệch → 400 + `WebhookFailure(AMOUNT_MISMATCH)` | `payments-momo` → `[M-4]` |
| M-5 | payment không tồn tại → 404 + `WebhookFailure(PAYMENT_NOT_FOUND)` | `payments-momo` → `[M-5]` |
| M-6 | chữ ký sai → 400, không đổi state | `payments-momo` → `[M-6]` |
| M-7 | `resultCode≠0` → payment PENDING → FAILED | `payments-momo` → `[M-7]` |
| M-8 | Refund full/partial thành công → REFUNDED/PARTIALLY_REFUNDED + event | `payments-momo` → `[M-8]` |
| M-9 | Refund `resultCode≠0` → refund FAILED | `payments-momo` → `[M-9]` |
| M-10 | Refund provider throw → refund PROCESSING + 503 | `payments-momo` → `[M-10]` |
| M-11 | Refund idempotencyKey replay → trả refund cũ, không gọi provider | `payments-momo` → `[M-11]` |
| M-12 | Refund amount > remaining / payment chưa PAID / provider SEPAY → 400 | `payments-momo` → `[M-12]` |
| G-1 | Registry: resolve, `has`, default, `PAYMENT_DEFAULT_PROVIDER` sai → throw khi khởi tạo | `test/unit/payment-gateway.registry.spec.ts` |
| G-2 | Checkout lần 2 khi payment còn hạn → trả artifact cũ, **không** gọi `createPayment` lần 2 | `test/e2e/payments-zalopay.e2e-spec.ts` → `[G-2]` |
| G-3 | Create lỗi → chỉ payment vừa tạo FAILED, payment cũ không đổi | `payments-zalopay` → `[G-3]` |
| G-4 | Event `FAILED_RETRYABLE` → callback lặp lại được xử lý lại (attemptCount 2) | `payments-zalopay` → `[G-4]` |
| G-5 | SUCCESS cho order đã PAID bởi payment khác → payment REFUND_REQUIRED + 1 `WebhookFailure(DUPLICATE_PAYMENT)`, không bị cron chọn lại | `test/unit/payments-reconcile.spec.ts` → `[G-5]` |
| G-6 | SUCCESS cho order EXPIRED/CANCELLED → REFUND_REQUIRED, đúng 1 `WebhookFailure(INVALID_ORDER_STATUS)` (do `processOrderSuccess` ghi), không bao giờ FAILED | `payments-reconcile` → `[G-6]` |
| G-7 | Refund FAILED sau partial refund → order `PARTIALLY_REFUNDED` (không ép PAID); sum chỉ tính refund của payment trả tiền (có refund PAYMENT_ONLY COMPLETED của payment khác vẫn không ảnh hưởng) | `test/unit/payments-refund.spec.ts` → `[G-7]` |
| G-8 | `finalizeRefund` gọi 2 lần → chỉ 1 lần cập nhật order/event | `payments-refund` → `[G-8]` |
| G-9 | Admin không xác nhận refund thủ công khi payment trả tiền là MOMO/ZALOPAY (PAID/PARTIALLY_REFUNDED/REFUNDED, không có marker `refundScope`); order trả bằng SePay có kèm payment ZALOPAY FAILED hoặc REFUND_REQUIRED → refund thủ công **được** — kể cả **sau khi** payment ZaloPay trùng đã thành REFUNDED — và không đụng refund PAYMENT_ONLY của ZaloPay | `test/unit/orders-refund-guard.spec.ts` → `[G-9]` |
| G-10 | Refund payment REFUND_REQUIRED (trùng, order PAID bởi payment khác) → payment REFUNDED; order vẫn PAID, `amountRefundedVnd`/`refundStatus`/payment trả tiền không đổi; amount ≠ full → 400; history có publicMessage 'Đang hoàn lại…' rồi 'Khoản thanh toán không hợp lệ đã được hoàn lại.'; luồng PROCESSING → reconcile bump → COMPLETED vẫn không đụng order và `refund.metadata` còn `refund_id`, `requestedBy` | `payments-refund` → `[G-10]` |
| G-11 | Refund payment REFUND_REQUIRED trên order CANCELLED → payment REFUNDED, order status không đổi; history có event `PAYMENT_REFUND_REQUIRED` + publicMessage hoàn tiền | `payments-refund` → `[G-11]` |
| G-12 | SUCCESS nhưng amount lệch (callback và query) → payment REFUND_REQUIRED, `paymentData.collectedAmountVnd = result.amountVnd`, đúng 1 `WebhookFailure` dù lặp lại; callback ack 2; refund sau đó phải bằng `collectedAmountVnd` (≠ → 400) | `payments-reconcile` → `[G-12]` |
| G-13 | Reclaim event PROCESSING quá lease: 2 worker cùng reclaim (version `attemptCount`) → chỉ 1 thành công (mock `updateMany` count 1 rồi 0) | `payments-reconcile` → `[G-13]` |
| G-14 | `processOrderSuccess` ném lỗi không phải 400 (DB) → event FAILED_RETRYABLE, payment vẫn PENDING (không REFUND_REQUIRED) | `payments-reconcile` → `[G-14]` |
| Z-1 | MAC create/query/refund/query_refund/callback khớp vector tính tay theo docs | `test/unit/zalopay-mac.util.spec.ts` |
| Z-2 | `app_trans_id` đúng `yyMMdd` GMT+7 tại 16:59:59Z và 17:00:00Z, ≤ 40 ký tự | `test/unit/zalopay.gateway.spec.ts` → `[Z-2]` |
| Z-3 | Checkout `ZALOPAY` → payment PENDING, `providerPaymentId = app_trans_id`, `expiresAt ≈ +15m`, `checkoutUrl = payUrl = order_url`, `qrCode` | `payments-zalopay` → `[Z-3]` |
| Z-4 | Create `return_code≠1` → 400 kèm `sub_return_message` | `zalopay.gateway.spec` → `[Z-4]` |
| Z-5 | Callback hợp lệ → order PAID, `payment.transactionId === String(zp_trans_id)`, ack `{return_code:1}` | `payments-zalopay` → `[Z-5]` |
| Z-6 | Callback trùng → ack `{return_code:1}`, không double-process | `payments-zalopay` → `[Z-6]` |
| Z-7 | Callback mac sai → ack `{return_code:2}`, không đổi state, không tạo WebhookEvent | `payments-zalopay` → `[Z-7]` |
| Z-8 | Callback amount lệch → ack 2 + `WebhookFailure(AMOUNT_MISMATCH)` | `payments-zalopay` → `[Z-8]` |
| Z-9 | Callback `app_id` sai → ack 2 | `zalopay.gateway.spec` → `[Z-9]` |
| Z-10 | Callback có field lạ / `data` không phải JSON → ack 2 (không phải envelope 400) | `payments-zalopay` → `[Z-10]` |
| Z-11 | Callback payment không tồn tại → ack 2 + `WebhookFailure(PAYMENT_NOT_FOUND)` | `payments-zalopay` → `[Z-11]` |
| Z-12 | Query: `1` → PAID (chạy 2 lần vẫn 1 lần xử lý); `2/-63` → không đổi; `2/-54` → FAILED; `3` → không đổi | `payments-reconcile` → `[Z-12]` |
| Z-13 | Quá `expiresAt + 30m`: vẫn query → `1` PAID; `2/-54`, `2/-63` FAILED; `2/-500`, `2/-429`, `2/-92` → vẫn PENDING (lỗi query, bump `updatedAt`); `3`/timeout → PENDING; > 7 ngày không được chọn | `payments-reconcile` → `[Z-13]` |
| Z-14 | Callback và reconcile cùng lúc cho 1 giao dịch → 1 lần PAID, 1 WebhookEvent (mô phỏng bằng P2002 trên `webhookEvent.create` + `order.updateMany` count 0) | `payments-reconcile` → `[Z-14]` |
| Z-15 | Refund `1`/`3` → refund PROCESSING, order REFUND_PENDING, lưu `refund_id`; `2` → FAILED | `payments-refund` → `[Z-15]` |
| Z-16 | query_refund `1` → COMPLETED; `2/-13` → FAILED; `2/-500`, `-1`, `-16` → vẫn PROCESSING | `payments-refund` → `[Z-16]` |
| Z-17 | Cron: `MAINTENANCE_CRON_ENABLED=false` → không chạy; lock đang giữ → bỏ qua; MoMo PENDING không bị query | `payments-reconcile` → `[Z-17]` |
| Z-18 | Checkout `ZALOPAY` cho order PAID/CANCELLED → 400 (guard hiện có) | `payments-zalopay` → `[Z-18]` |
| Z-19 | Starvation: 60 payment PENDING kẹt (quá hạn, `updatedAt` vừa query) + 1 payment mới → lượt chạy kế tiếp query payment mới; payment kẹt chỉ query lại theo backoff (30m / 6h) | `payments-reconcile` → `[Z-19]` |
| Z-20 | Refund PROCESSING kẹt được xoay vòng (`updatedAt` bump sau mỗi query) | `payments-refund` → `[Z-20]` |
| M-13 | (Phase 1) Checkout MoMo lần 2: row cũ chỉ có `paymentData.payUrl` & < 90 phút → dùng lại; > 90 phút → payment mới | `payments-momo` → `[M-13]` |

Test harness: mọi assertion `WebhookFailure(...)` phải truyền
`createPrismaMock({ webhookFailure: { create: jest.fn() } })` (`test/e2e/helpers/test-app.ts` hiện không có model này;
`recordWebhookFailure` dùng `prisma.webhookFailure?.create` nên thiếu mock sẽ pass rỗng) và assert lời gọi.
Các case race (Z-14, G-13) được mô phỏng bằng mock (P2002 / `count: 0`), không phải concurrency thật.

## 6. Quyết định cần ghi nhận / người duyệt

- D1: Giữ MoMo như một strategy sống song song tới khi gỡ (task riêng).
- D2: Chuyển default sang ZaloPay chỉ bằng env `PAYMENT_DEFAULT_PROVIDER` (Phase 2) — **cần product duyệt**.
- D3: ZaloPay checkout TTL 15 phút (khác MoMo 24h) — **cần duyệt**; FE phải xử lý link hết hạn bằng checkout lại.
- D4: Reconcile chạy mỗi phút, chỉ ZaloPay, grace 30 phút sau `expiresAt`, backoff theo D9.
- D5: Partial refund qua ZaloPay được phép (API hỗ trợ amount < gốc).
- D6: Payment bị cổng xác nhận nhưng không thể ghi cho đơn (đơn đã đóng, trả trùng, lệch amount/requestId)
  → `REFUND_REQUIRED` + WebhookFailure; admin hoàn **toàn bộ** qua `POST payments/admin/:paymentId/refunds`
  (scope `PAYMENT_ONLY`, không đổi tiền/trạng thái order). Không tự hoàn.
- D7: Callback lỗi tạm thời → HTTP 500 (không ack) thay vì return_code ngoài spec.
- D8: MoMo `linkReuseMs = 90 phút` — **cần xác nhận** thời hạn `payUrl` MoMo; row MoMo cũ fallback `paymentData.payUrl`.
- D9: Reconcile không bao giờ FAILED khi chưa hỏi cổng hoặc khi cổng trả lỗi hệ thống; backoff 1m → 30m → 6h; payment PENDING > 7 ngày để admin tra thủ công.
- D10: Payment REFUND_REQUIRED hiển thị cho khách qua `history[].publicMessage` (không đổi `order.status/refundStatus`).

## 7. Rủi ro

- Callback không tới local → ngrok/Render; cron reconcile ≤ 1 phút.
- `zp_trans_id` số lớn → luôn `String()`.
- Race callback vs reconcile → WebhookEvent `eventKey` dùng chung + claim `order.updateMany(status=PENDING)`.
- Sandbox key công khai — không dùng production.
