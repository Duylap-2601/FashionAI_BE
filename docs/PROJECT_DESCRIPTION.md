# 👗 FashionAI Backend

**FashionAI** là một nền tảng thương mại điện tử thời trang kết nối người mua với công nghệ AI, cho phép khách hàng thử đồ ảo trước khi mua, nhận tư vấn phong cách cá nhân từ AI, và đặt may đo hàng thủ công theo số đo chuẩn xác.

Khác với các e-commerce thời trang truyền thống chỉ cung cấp ảnh tĩnh và bảng size cố định, FashionAI tích hợp trực tiếp:
- **Virtual Try-On AI** (fal.ai FASHN) vào quy trình mua sắm - khách hàng upload ảnh cá nhân + trang phục → nhận ảnh thử đồ ảo thực tế chỉ trong vài giây
- **AI Stylist** (Gemini Vision) phân tích Personal Color, chiều cao, tone da → tư vấn phong cách cá nhân qua chat
- **Live Try-On Sessions** cho phép khách hàng kết nối realtime với stylist để tư vấn và quyết định mua
- **Made-to-Measure System** hỗ trợ may đo hàng thủ công dựa trên số đo chi tiết từ khách hàng

Backend này là nền móng API hỗ trợ toàn bộ trải nghiệm thương mại lẫn AI đó.

---

## 🏗️ Technology Stack

- **Runtime**: NestJS 10, TypeScript, Express
- **Database**: PostgreSQL + Prisma ORM
- **Realtime**: Socket.IO + Redis adapter (multi-instance support)
- **External Services**: fal.ai FASHN (virtual try-on), Gemini Vision (AI stylist), Cloudinary (storage), SePay (payments), Google OAuth
- **Job Processing**: BullMQ + Redis

---

## 📁 Project Structure

```
src/
├── database/              # Prisma database setup
├── common/                # Shared code (guards, filters, decorators, utils)
├── modules/
│   ├── auth/              # JWT + Google OAuth
│   ├── users/             # User profiles & measurements
│   ├── products/          # Products, categories, reviews
│   ├── collections/       # Hero banners (many-to-many products)
│   ├── orders/            # Order lifecycle & fulfillment
│   ├── payments/          # SePay integration, subscriptions
│   ├── try-on/            # Virtual try-on (fal.ai FASHN)
│   ├── stylist/           # AI stylist (Gemini Vision)
│   ├── chat/              # Chat messaging
│   ├── realtime/          # Socket.IO for live sessions
│   ├── shipping/          # Shipment tracking
│   ├── admin/             # Admin stats & dashboard
│   └── [others]/          # Notifications, mail, storage, health, etc.
```

---

## 🔄 Core Workflows

### Virtual Try-On
```
User Request → Validate (JWT + Quota) → Call fal.ai FASHN 
→ fal.ai processes → Return result image → User sees try-on preview
```

### AI Stylist Consultation
```
User uploads photo → Analyze with Gemini Vision → Personal color + style recommendation 
→ Chat interface for follow-up questions
```

### Live Try-On Session
```
Customer initiates → Stylist accepts → Real-time video call + messaging 
→ Stylist recommends → Customer makes purchase decision
```

### Order Fulfillment (Made-to-Measure)
```
Customer creates order with measurements → Admin reviews measurements 
→ Tailor creates garment → Quality check → Ship to customer
```

---

## 🎯 Key Features

- **Virtual Try-On**: Generate realistic try-on images in seconds
- **AI Styling**: Personal color analysis + fashion recommendations
- **Live Consultation**: Realtime sessions with fashion stylists
- **Made-to-Measure**: Support custom tailored orders with precise measurements
- **Subscription Tiers**: FREE, MEMBER, VIP with quota-based AI feature access
- **Order Management**: End-to-end order tracking from payment to delivery
- **Product Reviews**: Community-driven reviews with replies
- **Collections**: Curated product collections for promotions/hero banners
- **Admin Dashboard**: Statistics, shipment management, role-based access control

---

## 🔐 Security & Access Control

- **Authentication**: JWT tokens + refresh token rotation
- **Social Auth**: Google OAuth integration
- **Authorization**: Role-based access (ADMIN, USER)
- **Input Validation**: Global validation pipe with strict DTO rules
- **Rate Limiting**: Per-endpoint rate limits + quota-based AI feature access
- **Error Handling**: Consistent error responses (400/401/403/408/429/500)

---

## 🚀 Getting Started

```bash
# Setup
npm install
npm run prisma:generate
npm run prisma:migrate

# Development
npm run start:dev

# Testing
npm run test:unit
npm run test:e2e

# Production build
npm run build
npm run start:prod
```

### Environment Variables
- `DATABASE_URL` / `DIRECT_URL` - PostgreSQL
- `REDIS_URL` - Redis for cache & realtime
- `JWT_SECRET` - Token signing key
- `FAL_AI_KEY` - Virtual try-on service
- `GEMINI_API_KEY` - AI stylist service
- `CLOUDINARY_*` - Image storage
- `SEPAY_*` - Payment gateway
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - OAuth

---

## 📊 Current Status

**Recent Milestones:**
- ✅ Virtual try-on with quota management
- ✅ Live try-on sessions (pause/resume support)
- ✅ AI stylist integration
- ✅ Made-to-measure order flow
- ✅ Admin role restrictions
- ✅ Collections system for promotions
- ✅ Payment & subscription system

**In Progress:**
- Multi-garment try-on enhancements
- Advanced analytics dashboard
- Migration destructive operations cleanup

---

## 📚 Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Deep dive into system design
- **[AGENTS.md](./AGENTS.md)** - Development guidelines & patterns
- **Swagger Docs** - `GET /api/docs` (when running locally)

---

**Built with**: NestJS 10 + TypeScript + PostgreSQL + Socket.IO + Redis  
**Last Updated**: 2026-09-18
