# Plan Setup Mobile App (React Native) — FashionAI

> Dựa trên khảo sát source code backend thực tế (NestJS + Prisma + Postgres) tại thời điểm 2026-09-24.
> Backend đã có sẵn contract cho mobile (`X-Platform: mobile`, authorization-code OAuth flow) — không cần sửa BE để bắt đầu.

---

## 1. Tech stack đề xuất

- **React Native + Expo** (managed workflow, dùng EAS Build để có custom URL scheme + native modules khi cần).
- **TypeScript** (khớp với BE, tái dùng type/DTO nếu cần).
- State/data: **TanStack Query** (React Query) cho server state + cache, **Zustand** hoặc **Context** cho auth/session state nhẹ.
- Navigation: **React Navigation** (stack + bottom tabs).
- HTTP client: **axios** với interceptor tự refresh token.
- Secure storage: **expo-secure-store** (lưu accessToken/refreshToken, không dùng AsyncStorage thuần vì token nhạy cảm).
- Realtime: **socket.io-client** (khớp version Socket.IO 4.8 phía BE).
- Ảnh: **expo-image-picker** (chọn ảnh người dùng cho try-on/stylist), **expo-image** (hiển thị, cache).
- Form: **react-hook-form** + **zod** (validate giống class-validator phía BE).

---

## 2. Cấu trúc project khởi tạo

```
npx create-expo-app fashionai-mobile -t expo-template-blank-typescript
```

Cấu trúc thư mục đề xuất:
```
src/
  api/
    client.ts           # axios instance + interceptor refresh
    auth.api.ts
    products.api.ts
    tryOn.api.ts
    stylist.api.ts
    orders.api.ts
    payments.api.ts
    notifications.api.ts
  auth/
    AuthContext.tsx      # lưu accessToken, user, hàm login/logout
    useAuth.ts
    secureStorage.ts
  navigation/
    RootNavigator.tsx
    AuthStack.tsx
    MainTabs.tsx
  screens/
    auth/ (Login, Register, ForgotPassword)
    home/
    tryOn/
    stylist/
    chat/
    products/
    orders/
    profile/
  realtime/
    socket.ts            # kết nối namespace '/' và '/chat'
  types/                  # đồng bộ với DTO/response BE
  constants/
    endpoints.ts
    aiActions.ts          # TRY_ON, STYLIST, CHATBOT quota keys
  config/
    env.ts                # đọc EXPO_PUBLIC_API_URL...
```

---

## 3. Cấu hình môi trường (mobile)

`.env` (Expo dùng prefix `EXPO_PUBLIC_` để expose ra client bundle):
```
EXPO_PUBLIC_API_URL=https://api.fashionai.example.com/api
EXPO_PUBLIC_SOCKET_URL=https://api.fashionai.example.com
```

`app.json` / `app.config.ts`:
- Đăng ký custom URL scheme khớp `MOBILE_GOOGLE_CALLBACK_URL` phía BE (mặc định `fashionai://auth`):
```json
{
  "expo": {
    "scheme": "fashionai",
    "ios": { "bundleIdentifier": "com.fashionai.app" },
    "android": { "package": "com.fashionai.app" }
  }
}
```
- Cần xin BE (hoặc set trong `.env` BE) đúng giá trị `MOBILE_GOOGLE_CALLBACK_URL=fashionai://auth` để khớp deep link.

---

## 4. Authentication flow (theo đúng contract BE hiện có)

Nguồn: `src/modules/auth/auth.controller.ts`, `001-cross-platform-auth-flow.md`.

### 4.1 Nguyên tắc chung
- Mọi request auth (login/register/refresh/logout/exchange) phải gửi header **`X-Platform: mobile`**.
- Access token: gửi qua `Authorization: Bearer <accessToken>`.
- Refresh token: BE trả trong **response body** (không dùng cookie) — mobile tự lưu bằng `expo-secure-store`.
- BE phân biệt lỗi token hết hạn bằng `code: "ACCESS_TOKEN_EXPIRED"` (HTTP 401) để client biết cần refresh thay vì logout ngay.

### 4.2 Email/password
```
POST /auth/register  { email, password, name }   headers: X-Platform: mobile
POST /auth/login     { email, password }          headers: X-Platform: mobile
→ { user, accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt }
```

### 4.3 Refresh token
```
POST /auth/refresh   { refreshToken }   headers: X-Platform: mobile
→ { accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt }
```
Refresh token rotate mỗi lần gọi → phải lưu lại refreshToken mới, refreshToken cũ không dùng lại được.

### 4.4 Google OAuth (authorization-code pattern, đã implement ở BE)
1. Mobile mở **in-app browser** (dùng `expo-web-browser` → `WebBrowser.openAuthSessionAsync`) tới:
   `GET {API_URL}/auth/google?platform=mobile`
2. User login Google → BE redirect về deep link: `fashionai://auth?code=<authCode>` (code sống 5 phút, dùng 1 lần, lưu trong Redis).
3. App bắt deep link (Expo `Linking` API), lấy `code`.
4. Gọi:
   ```
   POST /auth/exchange   { code }   headers: X-Platform: mobile
   → { user, accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt }
   ```
5. Lưu token, chuyển vào app.

Lưu ý: theo code thật đã đọc ở `auth.controller.ts:140-168`, endpoint `/auth/exchange` cũng đọc `@CurrentPlatform()` — nếu quên header `X-Platform: mobile` thì BE sẽ coi là web và set cookie thay vì trả `refreshToken` trong body → **bắt buộc phải gửi header này ở mọi bước, bao gồm cả exchange**.

### 4.5 Logout
```
POST /auth/logout       { refreshToken }   headers: X-Platform: mobile
POST /auth/logout-all   (cần Bearer token) headers: X-Platform: mobile
```
Xóa token khỏi secure storage sau khi gọi thành công (hoặc thất bại do token đã invalid — vẫn xóa local).

### 4.6 Axios interceptor mẫu (auto refresh)
```typescript
// src/api/client.ts
import axios from 'axios';
import { getTokens, setTokens, clearTokens } from '../auth/secureStorage';

export const api = axios.create({
  baseURL: process.env.EXPO_PUBLIC_API_URL,
  headers: { 'X-Platform': 'mobile' },
});

api.interceptors.request.use(async (config) => {
  const { accessToken } = await getTokens();
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const code = error.response?.data?.code;
    if (error.response?.status === 401 && code === 'ACCESS_TOKEN_EXPIRED' && !original._retry) {
      original._retry = true;
      refreshing ??= refreshAccessToken();
      const newAccessToken = await refreshing;
      refreshing = null;
      if (newAccessToken) {
        original.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(original);
      }
      await clearTokens();
      // điều hướng về màn Login ở đây (qua navigation ref hoặc event emitter)
    }
    return Promise.reject(error);
  },
);

async function refreshAccessToken(): Promise<string | null> {
  const { refreshToken } = await getTokens();
  if (!refreshToken) return null;
  try {
    const { data } = await api.post('/auth/refresh', { refreshToken });
    await setTokens(data.data);
    return data.data.accessToken;
  } catch {
    return null;
  }
}
```

---

## 5. Response envelope chung — cần 1 layer parse thống nhất

Theo `api-response.util.ts` và `http-exception.filter.ts`:

```typescript
// Success
{ success: true, code: string, message: string, data: T, meta?: { page, limit, total } }
// Error
{ success: false, statusCode: number, code: string, message: string, details?: string[] }
```

Đề xuất: viết 1 hàm `unwrap<T>(response)` để lấy `data`, và 1 `ApiError` class giữ `code` + `message` + `statusCode`, để UI switch theo `code` (vd `QUOTA_EXCEEDED`, `SUBSCRIPTION_REQUIRED`) thay vì so message tiếng Việt.

Các mã lỗi quan trọng cần xử lý UI riêng:
- `401 ACCESS_TOKEN_EXPIRED` → tự refresh (xem §4.6)
- `402 SUBSCRIPTION_REQUIRED` → hiện màn nâng cấp gói (FREE không có quota TRY_ON)
- `429 QUOTA_EXCEEDED` → hiện `{used, limit, remaining, resetAt}` từ `details`/`data`, đề xuất chờ hoặc nâng cấp
- `429` global rate limit → retry sau, không cần UI đặc biệt

---

## 6. Danh sách màn hình theo module BE (ưu tiên)

### Phase 1 — Core (bắt buộc cho MVP)
| Màn hình | Endpoint chính |
|---|---|
| Splash/Auto-login | đọc token từ secure storage, gọi `GET /users/me` để verify |
| Login/Register | `POST /auth/login`, `/auth/register` |
| Google Login | flow §4.4 |
| Home / Product list | `GET /products` (filter, phân trang) |
| Product detail | `GET /products/:id`, `GET /products/:id/reviews`, `/reviews/stats` |
| Profile | `GET/PUT /users/me`, `GET/PUT /users/me/measurements` |
| Quota badge | `GET /users/me/quota?action=` |

### Phase 2 — Tính năng AI cốt lõi
| Màn hình | Endpoint chính |
|---|---|
| Virtual Try-On | `POST /try-on` (multipart humanImage + garments[]), `GET /try-on/history` |
| AI Stylist | `POST /stylist/analyze`, `GET /stylist/history` |
| Chatbot | WebSocket `/chat` namespace, event `chat:send`/`chat:token`/`chat:done` (ưu tiên hơn SSE legacy `POST /chat`) |
| Rack (lưu sản phẩm) | `POST/GET/DELETE /rack` |
| Notifications | `GET /notifications`, WS event từ `RealtimeGateway` namespace `/` |

### Phase 3 — Thương mại
| Màn hình | Endpoint chính |
|---|---|
| Cart/Checkout → Order | `POST /orders/quote`, `POST /orders` |
| Order history/tracking | `GET /orders`, `GET /orders/:id/tracking` |
| Payment (SePay) | `POST /payments/checkout` — cần mở WebView/deep link tới trang thanh toán SePay, xử lý callback |
| Subscription (MEMBER/VIP) | `GET /payments/plans`, `GET /payments/subscriptions/me`, cancel/resume |
| Shipping | `GET /shipping/provinces|districts|wards`, `POST /shipping/calculate-fee` |

### Phase 4 — Nâng cao (có thể để sau)
| Màn hình | Endpoint chính |
|---|---|
| Collections (BST hero banner) | `GET /collections/published`, `/collections/:slug` — theo `[[collections-feature-design]]`, tính năng này BE chưa code xong, mobile nên chờ |
| Avatar 3D preset (GLB + morph) | `GET /avatar/presets/nearest` — cần `three.js`/`expo-three` + `@react-three/fiber-native`, phức tạp, độ ưu tiên thấp cho v1 mobile |
| Live Try-On (video realtime qua Decart) | `GET/POST /try-on/live/*` — cần SDK riêng của Decart cho streaming, tách task riêng khi có SDK mobile từ Decart |

---

## 7. Upload ảnh (Try-On / Stylist / Reviews)

BE dùng `multer` (memory storage) + Cloudinary, nhận `multipart/form-data`. Từ RN dùng `expo-image-picker` lấy URI ảnh rồi build `FormData`:

```typescript
const formData = new FormData();
formData.append('humanImage', {
  uri: pickedImage.uri,
  name: 'human.jpg',
  type: 'image/jpeg',
} as any);
garments.forEach((g, i) => {
  formData.append(`garments[${i}][image]`, { uri: g.uri, name: `garment${i}.jpg`, type: 'image/jpeg' } as any);
  formData.append(`garments[${i}][category]`, g.category); // UPPER | LOWER | FULL_BODY
});

await api.post('/try-on', formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
});
```
Giới hạn ảnh 10MB (theo `FileValidationPipe` phía BE) — nên resize/compress phía client trước khi upload (`expo-image-manipulator`) để tránh lỗi 413/timeout trên mobile network.

---

## 8. Realtime (Socket.IO)

```typescript
import { io } from 'socket.io-client';

const socket = io(process.env.EXPO_PUBLIC_SOCKET_URL, {
  transports: ['websocket'], // BẮT BUỘC — BE chỉ chấp nhận websocket, không polling
  auth: { token: accessToken },
});

socket.on('token:expiring', () => { /* chủ động refresh access token và gọi socket.emit('auth:refresh', ...) nếu BE hỗ trợ */ });
socket.on('token:expired', () => { /* reconnect với token mới */ });

const chatSocket = io(`${process.env.EXPO_PUBLIC_SOCKET_URL}/chat`, {
  transports: ['websocket'],
  auth: { token: accessToken },
});
chatSocket.emit('chat:send', { message, sessionId });
chatSocket.on('chat:token', (chunk) => { /* append streaming text */ });
chatSocket.on('chat:done', () => { /* kết thúc */ });
chatSocket.on('chat:error', (err) => { /* {code, message} */ });
```
Cần re-connect logic khi app resume từ background (RN không giữ WS connection ổn định khi background lâu) — dùng `AppState` listener để reconnect khi app active lại.

---

## 9. Việc cần xác nhận / phối hợp với BE trước khi code

1. **CORS/allowed origins** cho mobile — mobile app không bị CORS chi phối (native request), nhưng cần xác nhận domain API production đã có SSL hợp lệ.
2. **`MOBILE_GOOGLE_CALLBACK_URL`** trên BE production phải khớp đúng scheme app đăng ký (`fashionai://auth`) — nhờ backend dev set env này trước khi test OAuth thật.
3. Theo `001-cross-platform-auth-flow.md`, mục **SEC-H2** (rate limit chưa cover `/auth/refresh`, `/auth/logout`, `/auth/exchange`) và **SEC-M1** (refresh token chưa bind platform) đang là risk đã được accept, không phải blocker — không cần chờ fix để bắt đầu mobile.
4. Endpoint `POST /avatar/generate` (Blender on-demand) và preset GLB (`docs/phase4-avatar-fe-handover.md`) được thiết kế cho web (Three.js/React), việc port sang RN cần đánh giá riêng (`expo-three` hỗ trợ GLB morph targets hạn chế) — nên xếp vào Phase 4, không phải MVP.
5. Live Try-On (Decart) — cần hỏi BE/Decart có SDK React Native hay chỉ có Web SDK; nếu chỉ có Web SDK thì phải nhúng qua WebView, ảnh hưởng lớn đến UX.

---

## 10. Checklist khởi động (tuần đầu)

- [ ] `npx create-expo-app` + cấu hình TypeScript, ESLint/Prettier khớp convention BE (nếu có).
- [ ] Cài `axios`, `@tanstack/react-query`, `zustand`, `expo-secure-store`, `expo-image-picker`, `expo-web-browser`, `socket.io-client`, `react-navigation`.
- [ ] Setup `api/client.ts` với interceptor refresh (§4.6).
- [ ] Setup `AuthContext` + màn Login/Register, test với BE thật (`X-Platform: mobile` header).
- [ ] Test Google OAuth deep link end-to-end trên thiết bị thật (deep link không hoạt động tốt trên simulator iOS đôi khi).
- [ ] Dựng màn Home + Product list để verify response envelope + pagination.
- [ ] Dựng flow Try-On cơ bản (upload ảnh, gọi `/try-on`, hiển thị kết quả) để verify multipart upload hoạt động qua RN.
