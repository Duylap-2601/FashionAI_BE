# FashionAI Backend - NestJS RESTful API

Hệ thống RESTful API cho ứng dụng thử đồ ảo (AI Virtual Try-On) và tư vấn thời trang AI (AI Stylist) xây dựng bằng **NestJS 10**, **Prisma ORM**, **PostgreSQL**, **fal.ai**, **Google Gemini Vision**, **PayOS**, **Redis**, và **Cloudinary**.

---

## 📋 Tính Năng Nổi Bật

- 🔐 **Authentication & User Management**:
  - Đăng ký / Đăng nhập (Email + Mật khẩu, Google OAuth2 SSO).
  - JWT Access Token & Refresh Token Rotation.
  - Quên mật khẩu, đặt lại mật khẩu qua Email.
  - Xác thực Email tài khoản.
  - Quản lý Hồ sơ & Số đo cơ thể (Body Measurements).
- 👔 **AI Virtual Try-On (`/api/try-on`)**:
  - Thử đồ tự động bằng mô hình AI **FASHN v1.6** & **SAM2** qua **fal.ai**.
  - Hỗ trợ thử theo ảnh tải lên hoặc theo `productId` từ Catalog.
  - Tự động tách nền/nhãn trang phục (Garment Auto-Segmentation).
  - Lưu trữ kết quả vĩnh viễn trên Cloudinary.
  - Caching kết quả trùng lặp không tiêu tốn lượt Quota.
  - Xem lịch sử thử đồ (`/api/try-on/history`).
- 🎨 **AI Stylist (`/api/stylist`)**:
  - Phân tích màu da, dáng người và tư vấn phong cách từ ảnh nhân vật bằng **Google Gemini Vision**.
  - Trả về cấu trúc JSON chuẩn hóa (Personal Color, Body Type, Outfit Suggestions).
  - Tự động sửa lỗi/retries khi AI trả dữ liệu không đúng cấu trúc.
  - Xem lịch sử tư vấn (`/api/stylist/history`).
- 🛍️ **Products & Catalog (`/api/products`)**:
  - Quản lý danh mục sản phẩm thời trang.
  - Bộ lọc sản phẩm theo loại (Category), màu sắc, kích cỡ, mức giá.
  - API CRUD phân quyền cho Admin (`RolesGuard`).
- 🛡️ **Bảo Vệ Chi Phí & Giới Hạn Sử Dụng (Quota & Rate Limiting)**:
  - Phân hạng tài khoản: `FREE` (3 lượt/ngày), `MEMBER` (10 lượt/ngày), `VIP` (Không giới hạn).
  - Đếm Quota tự động qua **Redis / Database**.
  - Khóa trùng lặp Request (Duplicate Request Lock).
  - HTTP 429 Too Many Requests kèm chi tiết Quota còn lại.
- 💳 **Thanh Toán & Nâng Cấp Tài Khoản (`/api/payments`)**:
  - Tích hợp cổng thanh toán **PayOS**.
  - Tự động nâng cấp User Tier ngay khi thanh toán thành công (Webhook Idempotency).

---

## 🏗️ Cấu Trúc Dự Án

```
src/
├── app.module.ts              # Root Module
├── main.ts                    # Application Entry Point
├── common/                    # Shared Decorators, Filters, Guards, Pipes, DTOs
│   ├── decorators/            # @Public, @CurrentUser, @Roles
│   ├── dto/                   # ApiResponseDto
│   ├── filters/               # GlobalExceptionFilter
│   ├── guards/                # JwtAuthGuard, RolesGuard, QuotaGuard
│   ├── middleware/            # RequestIdMiddleware
│   └── pipes/                 # FileValidationPipe
├── database/                  # Prisma Service & Prisma Module
├── modules/
│   ├── auth/                  # Register, Login, Refresh, Password, Google OAuth
│   ├── users/                 # Profile, Body Measurements
│   ├── try-on/                # AI Try-On service & history
│   ├── stylist/               # Gemini AI Stylist service & history
│   ├── products/              # Product Catalog & Admin CRUD
│   ├── payments/              # PayOS Checkout & Webhook handler
│   ├── mail/                  # Nodemailer Service
│   ├── storage/               # Cloudinary File Storage Service
│   └── health/                # Terminus Health Check Endpoint
└── prisma/
    ├── schema.prisma          # Database Schema (PostgreSQL)
    └── seed.ts                # Database Seeder
```

---

## 🚀 Cài Đặt & Chạy

### 1. Yêu Cầu Cần Thiết
- **Node.js**: v18+ (hỗ trợ Fetch & FormData API)
- **PostgreSQL**: v14+ (Hoặc Neon DB connection)
- **Redis**: v6+ (Local hoặc Redis Cloud)

### 2. Cài Đặt Dependencies
```bash
npm install
```

### 3. Cấu Hình Môi Trường
Tạo file `.env` từ `.env.example`:
```bash
cp .env.example .env
```
Điền đầy đủ các thông tin bí mật (`DATABASE_URL`, `JWT_ACCESS_SECRET`, `FAL_KEY`, `GEMINI_API_KEY`, `PAYOS_*`, etc.).

### 4. Chạy Migration Database
```bash
npx prisma migrate dev
npx prisma generate
```

### 5. Chạy Application (Development)
```bash
npm run start:dev
```
- **API Server**: `http://localhost:3000/api`
- **Swagger Documentation**: `http://localhost:3000/api/docs`

---

## 🧪 Kiểm Thử (Testing)

```bash
# Unit Tests
npm run test:unit

# E2E Tests
npm run test:e2e

# Linting
npm run lint:check
```

---

## 🐳 Docker Deployment

```bash
# Build và Khởi chạy ứng dụng + PostgreSQL + Redis
docker-compose up --build -d
```

---

## 📧 Liên Hệ & Hỗ Trợ
- **Tài liệu cài đặt chi tiết**: Xem file [GETTING_STARTED.md](./GETTING_STARTED.md)
- **Tài liệu thiết kế chi tiết**: Xem file [SRS.md](./SRS.md) và [ARCHITECTURE.md](./ARCHITECTURE.md)
