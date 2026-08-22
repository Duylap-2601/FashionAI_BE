# Software Requirements Specification - FashionAI

Version: 1.1
Updated: 2026-08-17
Status: Draft, aligned with current backend source

## 1. Overview

FashionAI is an AI-assisted fashion platform focused on office wear and suits. The backend provides APIs for authentication, product catalog, body measurements, virtual try-on, AI styling advice, quota control, and tier upgrades through payment.

Frontend is expected to be a separate Next.js application.

## 2. User Roles And Tiers

### Guest

- Can view product catalog and product detail.
- Cannot use Virtual Try-On or AI Stylist.
- Must log in before using protected AI endpoints.

### Free User

- Can save profile and body measurements.
- Can use limited AI quota per day.
- Current backend limit:
  - Try-On: 3/day.
  - Stylist: see `src/common/constants/ai-quota.constants.ts`.

### Member

- Higher daily Try-On quota.
- Can be upgraded after successful payment.

### VIP

- Unlimited AI quota for configured actions.
- Can be upgraded after successful payment.

### Admin

- Can create, update, and delete products.
- Future requirement: manage users, quota configuration, and usage statistics.

## 3. Functional Requirements

### FR-01 Authentication And Account

Required:

- Register with email/password.
- Login with email/password.
- Google OAuth login.
- JWT access token.
- Refresh token rotation.
- Logout current session.
- Logout all sessions.
- Change password.
- Forgot password.
- Reset password.
- Verify email.
- Resend verification email.

Current status: implemented.

Remaining:

- Add scheduled cleanup job for expired tokens.
- Verify OAuth state/CSRF behavior for production.

### FR-02 Body Measurements

Required fields:

- height
- weight
- chest
- waist
- hip
- shoulder

Validation:

- height: 100-250 cm
- weight: 30-300 kg
- chest/waist/hip: 50-200 cm
- shoulder: 30-80 cm

Current status: implemented through Users module and measurement DTOs.

Remaining:

- Frontend onboarding prompt is outside backend scope.

### FR-03 Product Catalog

Required:

- Public product list.
- Public product detail.
- Search by name/description.
- Filter by category, size, color, and price.
- Admin-only create/update/delete.

Current status: implemented.

Remaining:

- Admin multipart image upload endpoint.
- Optional richer catalog fields: brand, stock, size chart, multi-color/multi-size arrays.

### FR-04 Virtual Try-On

Required:

- Try-On using product catalog item.
- Try-On using uploaded garment image.
- Upload human image.
- Optional SAM2 preprocessing.
- FASHN virtual try-on.
- Return result URL.
- Save result history.
- Cache repeated inputs.
- Do not deduct quota on cache hit.

Current status: implemented for image/product flows.

Remaining:

- 3D mannequin try-on.
- Result download endpoint.
- Delete-all history endpoint.
- Explicit cache key and cache expiry.
- Optional image-quality gate before expensive AI call.
- Precomputed mannequin strategy for cost control.

### FR-05 Quota And Rate Limiting

Required:

- Quota by tier.
- Global rate limit.
- Auth endpoint rate limit.
- Cache hits do not consume Try-On quota.
- Return quota details on limit exceeded.

Current status: implemented.

Remaining:

- Align exact per-action quotas between SRS and code.
- Reset quota at exact next midnight rather than fixed 24-hour TTL.
- Add admin quota configuration if needed.

### FR-06 AI Stylist

Required:

- Analyze user image using Gemini Vision.
- Recommend style, fit, colors, outfit combinations, and verdict.
- Use product context when `productId` is provided.
- Use body measurements when available.
- Save history.

Current status: implemented.

Remaining:

- Add repair prompt for malformed Gemini JSON.
- Add stronger schema validation and more tests.

### FR-07 Try-On History

Required:

- List user's try-on results.
- View one result.
- Delete one result.
- Reopen old result without consuming quota.

Current status: implemented.

Remaining:

- Delete all results.
- Download image endpoint.

### FR-08 Payments And Tier Upgrade

Required:

- Create checkout for tier upgrade.
- Receive payment webhook.
- Mark order as paid.
- Upgrade user tier.
- Expose user order history.

Current status: implemented for subscription/tier upgrade.

Remaining:

- Verify SePay IPN/webhook HMAC signature (implemented).
- Separate production behavior from mock/fallback behavior.
- Add product purchase order flow if required.

### FR-09 Product Orders

Required if FashionAI sells clothing directly:

- Create product order.
- Store order items.
- Store shipping info.
- List user orders.
- View order detail.
- Cancel pending order.

Current status: not implemented as product-order flow. Existing `Order` model is for tier upgrade/payment.

### FR-10 3D Mannequin

Required for phase 2:

- Generate 3D avatar from measurements.
- Run Blender headless.
- Map measurements to MPFB2 morph targets.
- Export GLB.
- Store GLB URL.
- Let frontend render mannequin and capture image for Try-On.

Current status: not implemented.

## 4. Non-Functional Requirements

### Performance

- Non-AI API should respond quickly under normal DB load.
- Try-On timeout is configurable with `TIMEOUT_MS`.
- Cache hit should avoid external AI call.

### Security

- JWT for protected endpoints.
- Refresh token stored and rotated.
- CORS configured by env.
- API keys must stay server-side.
- File upload MIME/size validation required.
- Payment webhooks must be verified in production.

### Reliability

- SAM2 failure should fall back to original garment image.
- AI provider timeout should return a controlled error.
- Redis fallback exists for local development, but production should use real Redis.

### Observability

Required:

- Request ID.
- Structured logs.
- Health checks for database, Redis, and external dependencies.
- Cost/usage monitoring for AI providers.

Current status:

- Request ID exists.
- Database health exists.
- Redis/provider health and cost monitoring are still missing.

## 5. Data Model Summary

Implemented Prisma models:

- `User`
- `Measurement`
- `RefreshToken`
- `PasswordResetToken`
- `EmailVerificationToken`
- `Product`
- `ProductImage`
- `TryOnResult`
- `StylistResult`
- `Order`
- `Payment`
- `DailyUsage`

Future models if product checkout is required:

- `OrderItem`
- Optional `TierHistory` or audit log.

## 6. API Summary

Auth:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/auth/logout-all`
- `POST /api/auth/change-password`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/verify-email`
- `POST /api/auth/resend-verification`
- `GET /api/auth/google`
- `GET /api/auth/google/callback`

Users:

- `GET /api/users/me`
- `PUT /api/users/me`
- `GET /api/users/me/measurements`
- `PUT /api/users/me/measurements`
- `GET /api/users/me/quota`

Products:

- `GET /api/products`
- `GET /api/products/:id`
- `POST /api/products`
- `PUT /api/products/:id`
- `DELETE /api/products/:id`

Try-On:

- `POST /api/try-on`
- `GET /api/try-on/history`
- `GET /api/try-on/history/:id`
- `DELETE /api/try-on/history/:id`

Stylist:

- `POST /api/stylist/analyze`
- `GET /api/stylist/history`
- `GET /api/stylist/history/:id`
- `DELETE /api/stylist/history/:id`

Payments:

- `POST /api/payments/checkout`
- `POST /api/payments/sepay-ipn`
- `POST /api/payments/sepay-webhook`
- `GET /api/payments/orders`
- `GET /api/payments/mock-success`

Health:

- `GET /api/health`

## 7. Implementation Priority

1. Documentation cleanup and response consistency.
2. Quota reset, Redis health, payment webhook hardening.
3. Admin product image upload.
4. Product purchase order flow if required.
5. Try-On completion: download, delete-all history, explicit cache expiry.
6. AI Stylist repair prompt and stronger tests.
7. 3D mannequin phase.
8. E2E tests and CI/CD.
