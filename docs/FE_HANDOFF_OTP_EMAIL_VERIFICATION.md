# FE Handover: Đổi luồng xác thực email sang OTP + enforce verify trước khi login

> **Mục tiêu:** Thay luồng "click link trong email" bằng "nhập mã OTP 4 số", và bắt đầu chặn user chưa xác thực email đăng nhập vào app.
>
> **Phạm vi ảnh hưởng:** 3 endpoint đổi contract — `register`, `verify-email`, `resend-verification`. `login`, `forgot-password`, `reset-password` giữ nguyên field, chỉ `login` có thêm 1 case lỗi mới.

---

## 1. Vì sao đổi

- Trước đây đăng ký xong là nhận được `accessToken`/`refreshToken` ngay, email xác thực chỉ mang tính thông báo — user chưa verify vẫn dùng được toàn bộ app.
- Giờ áp theo đúng chuẩn OTP: đăng ký → nhận mã 4 số qua email → nhập mã để verify → mới login được.
- OTP được lưu ở Redis (TTL 5 phút), không còn gửi link qua email nữa.

---

## 2. Các endpoint thay đổi

### 2.1 `POST /auth/register`

**Trước:**
```json
// response 201 (cũ)
{
  "success": true,
  "code": "AUTH_REGISTER_SUCCESS",
  "data": {
    "user": { "...": "..." },
    "accessToken": "...",
    "accessTokenExpiresAt": "...",
    "refreshToken": "...",
    "refreshTokenExpiresAt": "..."
  }
}
```

**Sau:**
```json
// request — không đổi
{
  "email": "user@example.com",
  "password": "StrongPassword123",
  "confirmPassword": "StrongPassword123",
  "name": "Nguyen An"
}
```
```json
// response 201 (mới) — KHÔNG còn accessToken/refreshToken
{
  "success": true,
  "code": "AUTH_REGISTER_SUCCESS",
  "message": "Đăng ký thành công. Vui lòng kiểm tra email để lấy mã OTP xác thực.",
  "data": { "email": "user@example.com" }
}
```

**FE cần sửa:** sau khi register thành công, **không lưu token / không điều hướng vào app**. Chuyển sang màn hình "Nhập mã OTP", truyền kèm `email` để prefill.

---

### 2.2 `POST /auth/verify-email`

**Trước:** body `{ "token": "..." }` (token lấy từ query string của link trong email).

**Sau:**
```json
// request
{
  "email": "user@example.com",
  "otp": "1234"
}
```
```json
// response 200 khi đúng
{
  "success": true,
  "code": "AUTH_VERIFY_EMAIL_SUCCESS",
  "message": "Xác thực email thành công.",
  "data": null
}
```
```json
// response 400 khi sai/hết hạn
{
  "success": false,
  "statusCode": 400,
  "code": "BAD_REQUEST",
  "message": "Mã OTP không hợp lệ hoặc đã hết hạn",
  "path": "/api/auth/verify-email"
}
```

- `otp` là chuỗi đúng 4 chữ số (validate `^\d{4}$`, không phải number).
- Endpoint vẫn **public** (không cần Bearer token).
- OTP hết hạn sau **5 phút** kể từ lúc gửi.
- Sai quá **5 lần** thì mã bị khoá luôn (xoá khỏi Redis) — user phải bấm "Gửi lại mã" để nhận OTP mới, không thể thử lại OTP cũ.
- Verify xong **không trả token** — FE điều hướng user sang màn hình login (hoặc tự gọi `/auth/login` nếu đang giữ password trong state, nhưng khuyến nghị bắt đăng nhập lại thủ công).

---

### 2.3 `POST /auth/resend-verification`

**Trước:** cần header `Authorization: Bearer <accessToken>`, không có body.

**Sau:**
```json
// request — không cần Bearer token nữa
{
  "email": "user@example.com"
}
```
```json
// response 200
{
  "success": true,
  "code": "AUTH_RESEND_VERIFICATION_SENT",
  "message": "Mã OTP xác thực đã được gửi tới email của bạn.",
  "data": null
}
```
```json
// response 400 nếu gọi lại quá sớm (cooldown)
{
  "success": false,
  "statusCode": 400,
  "code": "BAD_REQUEST",
  "message": "Vui lòng chờ ít nhất 60 giây trước khi yêu cầu gửi lại OTP.",
  "path": "/api/auth/resend-verification"
}
```

**FE cần sửa:**
- Đổi endpoint này sang gọi public, truyền `email` trong body (không còn gắn JWT).
- Có cooldown **60 giây** giữa 2 lần gửi — nên disable nút "Gửi lại mã" và hiện countdown ngay sau khi gọi thành công, để tránh user bấm liên tục dính lỗi 400.

---

### 2.4 `POST /auth/login` — thêm 1 case lỗi mới

Request/response field **không đổi**. Chỉ thêm case: nếu tài khoản chưa verify email, trả **403** thay vì cho đăng nhập:

```json
// response 403 — tài khoản chưa verify
{
  "success": false,
  "statusCode": 403,
  "code": "FORBIDDEN",
  "message": "Tài khoản chưa xác thực email. Vui lòng xác thực OTP trước khi đăng nhập.",
  "path": "/api/auth/login"
}
```

So sánh với case sai mật khẩu (giữ nguyên, **401**):
```json
{
  "success": false,
  "statusCode": 401,
  "code": "UNAUTHORIZED",
  "message": "Email hoặc mật khẩu không đúng",
  "path": "/api/auth/login"
}
```

**FE cần sửa:** bắt riêng status `403` ở login, hiện thông báo + nút "Xác thực ngay" dẫn sang màn hình nhập OTP (prefill email vừa login). Không gộp chung với thông báo lỗi 401.

---

## 3. Luồng FE cần implement (end-to-end)

```
[Màn hình Đăng ký]
  submit → POST /auth/register
  → thành công → chuyển [Màn hình Nhập OTP] (prefill email), KHÔNG lưu token

[Màn hình Nhập OTP]
  nhập 4 số → POST /auth/verify-email {email, otp}
  → thành công → chuyển [Màn hình Login] (hoặc tự gọi login nếu còn giữ password)
  → lỗi 400 → hiện message trả về, giữ nguyên màn hình để thử lại

  nút "Gửi lại mã" → POST /auth/resend-verification {email}
  → thành công → disable nút + countdown 60s
  → lỗi 400 (cooldown) → hiện message, giữ countdown hiện tại

[Màn hình Login]
  submit → POST /auth/login
  → 403 → hiện "chưa xác thực" + nút "Xác thực ngay" → [Màn hình Nhập OTP] (prefill email)
  → 401 → hiện "sai email/mật khẩu" (như cũ)
  → 200 → vào app (như cũ)
```

---

## 4. Google OAuth — không bị ảnh hưởng

User đăng nhập bằng Google tự động có `isVerified: true` ngay khi tạo/liên kết tài khoản (email đã được Google xác thực sẵn). Luồng `/auth/google`, `/auth/google/callback`, `/auth/exchange` **giữ nguyên 100%**, không đi qua OTP, không bị guard 403 ở login chặn (vì Google login không dùng endpoint `/auth/login`).

---

## 5. Bug đã fix — không cần FE làm gì

Trước đây `forgot-password` (và register cũ) có thể bị **treo vô thời hạn**, nút gửi mail loading mãi không phản hồi. Nguyên nhân là lỗi cấu hình kết nối Redis cho hàng đợi gửi mail ở backend (thiếu TLS cho `rediss://`), đã fix tại `src/app.module.ts`. Nếu trước đây FE từng gặp hiện tượng này thì không phải do code FE — giờ đã hết.

---

## 6. Lưu ý / hạn chế hiện tại

- Lỗi OTP (sai mã / hết hạn / quá số lần / cooldown resend) đều trả **400 `BAD_REQUEST`**, phân biệt nhau qua `message` (chuỗi tiếng Việt), **chưa có `code` riêng** cho từng case. Nếu cần xử lý logic khác nhau theo từng lỗi (ví dụ tự động focus lại input khi sai OTP, nhưng hiện nút resend khi hết hạn), tạm thời phải so khớp theo nội dung `message`:
  - `"Mã OTP không hợp lệ hoặc đã hết hạn"` — sai mã hoặc hết hạn (verify-email)
  - `"Bạn đã nhập sai OTP quá nhiều lần. Vui lòng yêu cầu gửi lại mã mới."` — khoá do sai quá 5 lần
  - `"Vui lòng chờ ít nhất 60 giây trước khi yêu cầu gửi lại OTP."` — cooldown resend
  - Nếu cần `code` riêng biệt, báo lại để BE bổ sung.
- Case 403 ở login dùng HTTP status để phân biệt với 401, không cần match message.
- Bảng `EmailVerificationToken` (token theo link, cũ) vẫn còn trong DB schema nhưng không còn được dùng — không liên quan tới FE, chỉ là dọn dẹp kỹ thuật phía BE.
