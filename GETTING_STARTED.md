# Hướng Dẫn Khởi Chạy FashionAI Backend

Tài liệu này dùng để chạy backend trên máy local cho development và test nhanh.

## 1. Yêu Cầu

- Node.js 18+
- npm 9+
- PostgreSQL 14+
- Redis 6+ nếu muốn dùng Redis thật cho quota/rate-limit
- Tài khoản/API key tùy tính năng:
  - fal.ai cho Virtual Try-On thật
  - Google Gemini cho AI Stylist
  - Cloudinary cho lưu ảnh
  - SePay sandbox cho thanh toán

Backend vẫn có thể chạy local với `AI_TRYON_PROVIDER=mock` khi chưa có fal.ai key.

## 2. Cài Dependencies

```bash
npm install
```

## 3. Tạo File Môi Trường

```bash
cp .env.example .env
```

Các biến tối thiểu để chạy local:

```env
NODE_ENV=development
PORT=3001
API_PREFIX=api

DATABASE_URL="postgresql://postgres:password@localhost:5432/fashionai?sslmode=disable"
DIRECT_URL="postgresql://postgres:password@localhost:5432/fashionai?sslmode=disable"

JWT_ACCESS_SECRET="change_me_access_secret"
JWT_REFRESH_SECRET="change_me_refresh_secret"

AI_TRYON_PROVIDER=mock
GEMINI_API_KEY=""
```

Nếu dùng Docker Compose trong repo, kiểm tra lại user/password/database trong `docker-compose.yml` và đồng bộ với `.env`.

## 4. Chuẩn Bị Database

```bash
npm run prisma:generate
npm run prisma:migrate
```

Seed dữ liệu mẫu nếu cần:

```bash
npm run prisma:seed
```

## 5. Chạy Server

```bash
npm run start:dev
```

Trên Windows PowerShell, nếu bị lỗi execution policy với `npm run`, dùng:

```bash
npm.cmd run start:dev
```

Địa chỉ mặc định:

- API: `http://localhost:3001/api`
- Swagger: `http://localhost:3001/api/docs`
- Health: `http://localhost:3001/api/health`

## 6. Chạy Test Và Build

```bash
npm.cmd run build
npm.cmd run test:unit
npm.cmd run lint:check
```

Trạng thái gần nhất:

- Build: pass.
- Unit test: 4 suites, 28 tests pass.

## 7. Chạy Bằng Docker

```bash
docker-compose up --build -d
```

Sau khi containers chạy, thực hiện migrate nếu app chưa tự chạy migration:

```bash
npm.cmd run prisma:migrate
```

## 8. Gợi Ý Cấu Hình Theo Tính Năng

Virtual Try-On thật:

```env
AI_TRYON_PROVIDER=fal
FAL_KEY="your_fal_api_key"
FASHN_MODEL="fal-ai/fashn/tryon/v1.6"
SAM2_ENABLED=true
SAM2_MODEL="fal-ai/sam2/auto-segment"
FASHN_MODE="balanced"
TIMEOUT_MS=120000
```

AI Stylist:

```env
GEMINI_API_KEY="your_gemini_api_key"
GEMINI_MODEL="gemini-2.0-flash"
```

Storage:

```env
CLOUDINARY_CLOUD_NAME="your_cloud_name"
CLOUDINARY_API_KEY="your_cloudinary_api_key"
CLOUDINARY_API_SECRET="your_cloudinary_api_secret"
CLOUDINARY_UPLOAD_FOLDER=fashionai
```

Payment:

```env
SEPAY_MERCHANT_ID="your_sepay_merchant_id"
SEPAY_SECRET_KEY="your_sepay_checkout_secret_key"
SEPAY_IPN_SECRET="your_sepay_ipn_secret_key"
SEPAY_WEBHOOK_SECRET="your_sepay_webhook_secret_key"
SEPAY_CHECKOUT_URL=https://pay-sandbox.sepay.vn/v1/checkout/init
SEPAY_SUCCESS_URL=http://localhost:3000/orders/success
SEPAY_ERROR_URL=http://localhost:3000/checkout/error
SEPAY_CANCEL_URL=http://localhost:3000/checkout
```

## 9. Cấu Hình SePay Từ Đầu Tới Cuối

### Bước 1: Tạo tài khoản SePay

1. Vào `https://my.sepay.vn`.
2. Đăng ký hoặc đăng nhập tài khoản.
3. Bật Test mode/Sandbox nếu bạn đang tích hợp thử.
4. Vào phần Cổng thanh toán để lấy thông tin merchant.

### Bước 2: Lấy thông tin tích hợp

Bạn cần 3 giá trị:

- `SEPAY_MERCHANT_ID`: merchant ID trong Cổng thanh toán.
- `SEPAY_SECRET_KEY`: secret dùng để ký checkout form.
- `SEPAY_IPN_SECRET`: secret dùng để xác thực IPN. Nếu SePay cho tạo secret riêng ở phần IPN, dùng secret đó.

Điền vào `.env`:

```env
PAYMENT_DEFAULT_PROVIDER=SEPAY
SEPAY_MERCHANT_ID="..."
SEPAY_SECRET_KEY="..."
SEPAY_IPN_SECRET="..."
SEPAY_WEBHOOK_SECRET=""
SEPAY_WEBHOOK_VERIFY_HMAC=false
SEPAY_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS=300
SEPAY_CHECKOUT_URL=https://pay-sandbox.sepay.vn/v1/checkout/init
SEPAY_SUCCESS_URL=http://localhost:3000/orders/success
SEPAY_ERROR_URL=http://localhost:3000/checkout/error
SEPAY_CANCEL_URL=http://localhost:3000/checkout
```

### Bước 3: Tạo public HTTPS URL cho backend local

SePay IPN không gọi được `localhost`. Nếu backend chạy ở `http://localhost:3001`, dùng ngrok:

```bash
ngrok http 3001
```

Ví dụ ngrok trả về:

```text
https://abc123.ngrok-free.app
```

IPN URL cần cấu hình trên SePay:

```text
https://abc123.ngrok-free.app/api/payments/sepay-ipn
```

### Bước 4: Cấu hình IPN trên SePay

Trong my.sepay.vn:

1. Vào Cổng thanh toán.
2. Vào Cấu hình IPN.
3. Nhập IPN URL public ở bước 3.
4. Chọn kiểu xác thực `SECRET_KEY` nếu dùng IPN của Cổng thanh toán.
5. Nhập secret giống `SEPAY_IPN_SECRET`.
6. Lưu cấu hình.

### Bước 5: Chạy backend

```bash
npm.cmd run start:dev
```

### Bước 6: Tạo checkout

Gọi:

```http
POST /api/payments/checkout
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Body:

```json
{
  "targetTier": "MEMBER",
  "provider": "SEPAY"
}
```

Backend trả về:

- `checkoutUrl`: URL có query params đã ký, có thể redirect người dùng tới.
- `formAction`, `formMethod`, `formFields`: dùng nếu frontend muốn submit form POST đúng chuẩn SePay.
- `invoiceNumber`: mã hóa đơn dạng `FAI{orderCode}` để backend match IPN.

### Bước 7: Xác nhận thanh toán

Sau khi thanh toán sandbox thành công, SePay gửi IPN tới:

```text
/api/payments/sepay-ipn
```

Backend sẽ:

1. Kiểm tra header `X-Secret-Key`.
2. Lấy `order.order_invoice_number`.
3. Parse mã đơn từ `FAI{orderCode}`.
4. Kiểm tra số tiền.
5. Mark order `PAID`.
6. Nâng tier user nếu đơn có `targetTier`.

### Bước 8: Nếu dùng SePay Webhooks ngân hàng thật

Nếu bạn cấu hình ở mục `Tích hợp WebHooks` thay vì IPN của Cổng thanh toán, hãy dùng:

```env
SEPAY_WEBHOOK_SECRET="secret_hmac_ban_tao_tren_sepay"
SEPAY_WEBHOOK_VERIFY_HMAC=true
SEPAY_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS=300
```

Trên SePay:

1. Auth Type chọn `HMAC-SHA256`.
2. Content Type chọn `application/json`.
3. URL vẫn là:
   ```text
   https://your-public-backend/api/payments/sepay-ipn
   ```
4. Cấu hình mã thanh toán/prefix để SePay trích được mã `FAI{orderCode}` trong nội dung chuyển khoản.

Backend hiện xử lý webhook ngân hàng theo các rule:

- Verify HMAC bằng `X-SePay-Signature` và `X-SePay-Timestamp`.
- Chống replay timestamp quá 300 giây.
- Chống trùng lặp bằng unique `provider + transactionId`, với `transactionId = payload.id`.
- Chỉ xử lý `transferType = "in"`.
- Parse mã đơn từ `code` hoặc `content` dạng `FAI{orderCode}`.
- Kiểm tra `transferAmount` phải đúng bằng `order.amount` trước khi mark `PAID`.
- Trả đúng body `{"success": true}` để SePay không retry.

## 10. Tài Liệu Liên Quan

- [README.md](./README.md)
- [SRS.md](./SRS.md)
- [SOURCE_REVIEW_PLAN.md](./SOURCE_REVIEW_PLAN.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
