# 🚀 Hướng Dẫn Khởi Chạy Dự Án FashionAI Backend

## 📋 Tổng Quan

**FashionAI Backend** là hệ thống RESTful API hỗ trợ tính năng Thử Đồ Ảo (Virtual Try-On) và Tư Vấn Phong Cách (AI Stylist).

- **Framework**: NestJS 10.x
- **ORM & Database**: Prisma ORM + PostgreSQL
- **Caching & Quota**: Redis (ioredis)
- **AI Virtual Try-On Provider**: fal.ai (FASHN v1.6 + SAM2)
- **AI Stylist Provider**: Google Gemini 2.0 Flash / Vision
- **Payment Provider**: PayOS
- **Storage Provider**: Cloudinary / Object Storage
- **Language**: TypeScript 5.x

---

## 💻 Yêu Cầu Hệ Thống

### Bắt Bắt Buộc:
- **Node.js**: v18.0.0 trở lên
- **npm**: v9.0.0 trở lên
- **PostgreSQL Database**: v14.0 trở lên
- **Redis Server**: v6.0 trở lên

---

## 📥 Hướng Dẫn Cài Đặt Từng Bước

### Bước 1: Clone Repository & Cài Đặt Dependencies

```bash
# Clone dự án
git clone <repository-url>
cd fashionai-backend

# Cài đặt dependencies
npm install
```

---

### Bước 2: Cấu Hình Biến Môi Trường (.env)

Tạo file `.env` tại thư mục gốc:

```env
# Application
NODE_ENV=development
PORT=3000
API_PREFIX=api

# CORS
CORS_ORIGINS=http://localhost:3000
CORS_CREDENTIALS=true

# Database (PostgreSQL)
DATABASE_URL="postgresql://postgres:password@localhost:5432/fashionai?sslmode=disable"
DIRECT_URL="postgresql://postgres:password@localhost:5432/fashionai?sslmode=disable"

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT Secrets
JWT_ACCESS_SECRET="your_access_secret_here"
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_SECRET="your_refresh_secret_here"
JWT_REFRESH_EXPIRES_IN=30d

# fal.ai Key (Try-On)
FAL_KEY="your_fal_api_key"
FASHN_MODEL="fashn/tryon-v1.6"

# Google Gemini API Key (Stylist)
GEMINI_API_KEY="your_gemini_api_key"
GEMINI_MODEL="gemini-2.0-flash"

# Cloudinary (Object Storage)
CLOUDINARY_CLOUD_NAME="your_cloud_name"
CLOUDINARY_API_KEY="your_api_key"
CLOUDINARY_API_SECRET="your_api_secret"

# PayOS (Thanh toán)
PAYOS_CLIENT_ID="your_payos_client_id"
PAYOS_API_KEY="your_payos_api_key"
PAYOS_CHECKSUM_KEY="your_payos_checksum_key"
```

---

### Bước 3: Khởi Tạo Database Schema (Prisma)

```bash
# Sinh Prisma Client
npm run prisma:generate

# Chạy Migration Database
npm run prisma:migrate
```

---

### Bước 4: Chạy Server Phát Triển

```bash
npm run start:dev
```

Mở trình duyệt truy cập Swagger UI: `http://localhost:3000/api/docs`

---

## 🐳 Khởi Chạy Bằng Docker

```bash
docker-compose up --build -d
```

---

## 🧪 Chạy Kiểm Thử (Tests)

```bash
# Unit Tests
npm run test:unit

# E2E Tests
npm run test:e2e
```
