# FashionAI Backend - NestJS RESTful API

Backend API cho nền tảng FashionAI: thử đồ ảo bằng AI, tư vấn phong cách, quản lý sản phẩm, quota sử dụng AI và nâng cấp tài khoản.

## Tính Năng Chính

- Authentication:
  - Đăng ký, đăng nhập bằng email/password.
  - Google OAuth.
  - JWT access token và refresh token rotation.
  - Logout, logout-all, blacklist access token.
  - Đổi mật khẩu, quên mật khẩu, reset mật khẩu.
  - Xác thực email.
- Users & Measurements:
  - Xem/cập nhật hồ sơ cá nhân.
  - Lưu và cập nhật số đo cơ thể.
  - Xem quota AI còn lại theo action.
- Products:
  - Public API danh sách/chi tiết sản phẩm.
  - Search, filter theo category, màu, size, khoảng giá.
  - CRUD sản phẩm cho admin.
- Virtual Try-On:
  - `POST /api/try-on` yêu cầu JWT và quota.
  - Hỗ trợ `humanImage` + `garmentImage` hoặc `humanImage` + `productId`.
  - fal.ai FASHN, SAM2 optional, timeout cấu hình qua env.
  - Lưu kết quả vào storage và DB.
  - Cache theo hash input, cache hit không trừ quota.
  - Lịch sử try-on: list/detail/delete.
- AI Stylist:
  - Gemini Vision phân tích ảnh người dùng.
  - Có thể tư vấn theo `productId` hoặc mô tả trang phục.
  - Dùng số đo người dùng nếu có.
  - Parse/validate JSON output.
  - Lưu lịch sử tư vấn.
- Quota & Rate Limit:
  - Quota theo tier và action.
  - Redis counter, fallback in-memory, sync DB.
  - Global rate limit và auth endpoint rate limit.
- Payments:
  - Checkout nâng cấp tier hoặc thanh toán đơn sản phẩm qua SePay.
  - IPN/webhook (có xác thực HMAC) cập nhật order và user tier.
  - Mock payment success cho môi trường development.

## Tech Stack

- NestJS 10 + TypeScript
- Prisma + PostgreSQL
- Redis/ioredis
- fal.ai FASHN + SAM2
- Google Gemini
- Cloudinary-compatible storage
- SePay sandbox
- Jest
- Docker / Docker Compose

## Cấu Trúc Dự Án

```text
src/
  app.module.ts
  main.ts
  common/
    decorators/
    dto/
    filters/
    guards/
    middleware/
    pipes/
    redis/
    services/
  database/
  modules/
    auth/
    users/
    products/
    try-on/
    stylist/
    payments/
    mail/
    storage/
    health/
prisma/
  schema.prisma
  seed.ts
test/
  unit/
```

## Cài Đặt

Yêu cầu:

- Node.js 18+
- npm 9+
- PostgreSQL 14+
- Redis 6+ nếu muốn quota/rate-limit dùng Redis thật

```bash
npm install
```

Tạo file `.env` từ `.env.example` và điền cấu hình thật:

```bash
cp .env.example .env
```

Khởi tạo Prisma:

```bash
npm run prisma:generate
npm run prisma:migrate
```

Chạy development server:

```bash
npm run start:dev
```

Mặc định:

- API: `http://localhost:3001/api`
- Swagger: `http://localhost:3001/api/docs`

## Scripts

```bash
npm.cmd run build
npm.cmd run test:unit
npm.cmd run lint:check
```

Trên Windows PowerShell, dùng `npm.cmd` nếu `npm run ...` bị chặn bởi execution policy.

## Docker

```bash
docker-compose up --build -d
```

## Trạng Thái So Với SRS

Xem bản rà soát hiện tại tại [SOURCE_REVIEW_PLAN.md](./SOURCE_REVIEW_PLAN.md). Các phần còn thiếu lớn gồm 3D mannequin, order_items cho mua sản phẩm thật, upload ảnh sản phẩm dạng multipart, health check Redis/AI provider, và một số hardening production.
