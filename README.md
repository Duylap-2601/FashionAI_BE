# FashionAI Backend - NestJS RESTful API

Backend API cho nền tảng FashionAI: thử đồ ảo bằng AI, tư vấn phong cách, chatbot, quản lý sản phẩm, quota sử dụng AI và nâng cấp tài khoản.

## Tính Năng Chính

- **Authentication:**
  - Đăng ký, đăng nhập bằng email/password.
  - Google OAuth.
  - JWT access token và refresh token rotation.
  - Logout, logout-all, blacklist access token.
  - Đổi mật khẩu, quên mật khẩu, reset mật khẩu.
  - Xác thực email.
- **Users & Measurements:**
  - Xem/cập nhật hồ sơ cá nhân.
  - Lưu và cập nhật số đo cơ thể (15 fields: height, weight, chest, waist, hip, shoulder, neck, sleeveLength, wrist, thigh, inseam, knee, calf, shirtLength, underbust).
  - Xem quota AI còn lại theo action.
- **Products:**
  - Public API danh sách/chi tiết sản phẩm.
  - Search, filter theo category, màu, size, khoảng giá.
  - CRUD sản phẩm cho admin (multipart image upload).
- **Virtual Try-On:**
  - `POST /api/try-on` yêu cầu JWT và quota.
  - Hỗ trợ `humanImage` + `garmentImage` hoặc `humanImage` + `productId`.
  - fal.ai FASHN v1.6, SAM2 optional, timeout cấu hình qua env.
  - Lưu kết quả vào storage và DB.
  - Cache theo hash input, cache hit không trừ quota.
  - Lịch sử try-on: list/detail/delete/delete-all, download.
  - **Quality gate** (opt-in): Gemini pre-check ảnh trước khi gọi fal.ai.
- **AI Stylist:**
  - Gemini Vision phân tích ảnh người dùng.
  - Có thể tư vấn theo `productId` hoặc mô tả trang phục.
  - Dùng số đo người dùng nếu có.
  - Parse/validate JSON output + **repair prompt** khi JSON sai.
  - Lưu lịch sử tư vấn: list/detail/delete/delete-all.
  - **Quota 3/day FREE**, 20/day MEMBER.
- **Chatbot (NEW):**
  - `POST /api/chat` streaming SSE với Groq (Llama 3.3 / GPT-OSS).
  - Context-aware: lịch sử chat, số đo, sản phẩm đang xem.
  - Quản lý phiên chat: tạo/list/xem/xóa session.
  - Quota: 50/day FREE, 200/day MEMBER.
- **Quota & Rate Limit:**
  - Quota theo tier (FREE/MEMBER/VIP) và action (TRY_ON/STYLIST/CHATBOT).
  - Redis counter, fallback in-memory, sync DB.
  - Global rate limit và auth endpoint rate limit.
- **Payments:**
  - Checkout nâng cấp tier hoặc thanh toán đơn sản phẩm qua SePay.
  - IPN/webhook (có xác thực HMAC) cập nhật order và user tier.
  - Mock payment success cho môi trường development.
- **3D Avatar / Mannequin (NEW):**
  - `POST /api/avatar/generate` Blender + MPFB2 pipeline (~2s sync).
  - Cache theo hash số đo, preset grid, morph target deltas cho FE.
  - `GET /api/avatar/me`, `/presets`, `/presets/nearest`.
  - GLB streaming fallback khi chưa có Cloudinary.
- **Mail (NEW - Brevo):**
  - Transactional emails via Brevo API (thay thế nodemailer).
  - Xác thực email, reset password, xác nhận đơn hàng, cập nhật trạng thái.

## Tech Stack

- NestJS 10 + TypeScript
- Prisma + PostgreSQL
- Redis/ioredis
- fal.ai FASHN + SAM2
- Google Gemini
- **Groq (Chatbot: openai/gpt-oss-120b, qwen/qwen3.6-27b, openai/gpt-oss-20b)**
- Cloudinary-compatible storage
- **Brevo (Transactional Email API)**
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
    chat/              # NEW: Chatbot module
    payments/
    mail/
    storage/
    health/
    avatar/            # NEW: 3D Avatar module
    admin/
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

## Trạng Thái Hiện Tại (2026-08-22)

✅ **Hoàn thiện production-ready:**
- Auth, Users, Products, Try-On, Stylist, **Chatbot**, **Avatar**, Payments, Mail, Quota
- Response envelope chuẩn `{success, code, message, timestamp, path, data, meta?}`
- Security: CORS locked in prod, OAuth state/CSRF, token cleanup cron
- Try-On: cacheKey/expiresAt, quality gate, delete-all
- Stylist: repair prompt, 3/day quota, delete-all
- Chatbot: streaming SSE, session management, quota enforcement
- Avatar: Blender pipeline, presets, morph targets
- Mail: Brevo API integration

⚠️ **Còn thiếu / Technical Debt:**
- 72 lint warnings (explicit `any`)
- No CI/CD pipeline
- E2E tests failing (payments-webhook needs valid HMAC)
- Swagger descriptions cần review encoding

Xem chi tiết tại [SOURCE_REVIEW_PLAN.md](./SOURCE_REVIEW_PLAN.md).
