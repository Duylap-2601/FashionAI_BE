# Kịch Bản Demo 30 Phút — FashionAI (3 Luồng Chính)

> **Cấu trúc thời lượng chuẩn 30 phút:**
> - **00:00 – 02:00 (2 phút):** Mở đầu & Định vị kiến trúc hệ thống
> - **02:00 – 11:00 (9 phút):** **Luồng 1** — Trải nghiệm AI Tư vấn, Giá đồ & Thử đồ thông minh *(Mở đầu tạo ấn tượng ngay)*
> - **11:00 – 19:00 (8 phút):** **Luồng 2** — Gói Thành viên SaaS, Kiểm soát Quota & Nâng cấp Proration *(Bài toán kinh doanh & kiểm soát chi phí)*
> - **19:00 – 28:30 (9.5 phút):** **Luồng 3** — Đặt hàng May đo, Thanh toán, Vận chuyển GHN & Hậu mãi *(Đặt luồng mua bán ở cuối, khép kín vòng đời)*
> - **28:30 – 30:00 (1.5 phút):** Tổng kết giá trị & Chuyển sang Q&A

---

## Chuẩn Bị Trước Khi Lên Sân Khấu (Checklist)

| Mục cần chuẩn bị | Chi tiết |
| :--- | :--- |
| **Trình duyệt 1 (Khách hàng)** | Tài khoản **`FREE`** (chưa mua gói) để demo chặn Try-On → mua `MEMBER` → nâng `VIP` ở Luồng 2. |
| **Trình duyệt 2 (Khách `VIP` sẵn)** | Tài khoản **`VIP`** đã có sẵn **Số đo cơ thể**, **Địa chỉ GHN**, và **1 đơn `DELIVERED` gồm 2 món có áp Coupon** (dùng cho Luồng 1 Live Try-On & phần Hậu mãi cuối Luồng 3 cho mượt). |
| **Trình duyệt 3 / Ẩn danh (`ADMIN`)** | Đăng nhập sẵn trang quản trị: mở sẵn tab **Đơn hàng**, **Khiếu nại (Order Issues)** và **Gói/Thanh toán**. |
| **Tài nguyên demo** | 1 ảnh toàn thân rõ nét, 1 sản phẩm đang chạy `SaleCampaign`, 1 `Coupon` còn lượt, app ZaloPay Sandbox / SePay QR sẵn sàng. |

---

## 00:00 – 02:00 | MỞ ĐẦU (2 phút)

* **Thao tác:** Chiếu nhanh màn hình trang chủ FashionAI (hoặc sơ đồ tổng quan 30 giây).
* **Nội dung nói:**
  * Giới thiệu FashionAI không phải web bán quần áo thông thường mà là nền tảng **Hybrid: AI Styling & Try-On SaaS + Thời trang May đo (Made-to-Measure)**.
  * Nêu nhanh kiến trúc: NestJS + PostgreSQL (51 bảng) + Redis + BullMQ (Outbox/Queue) + Socket.IO + Tích hợp fal.ai FASHN, Decart Realtime WebRTC, Gemini, ZaloPay/MoMo/SePay và GHN 2 cấp.
  * Báo trước bố cục 3 luồng demo: *(1) AI Tư vấn & Thử đồ → (2) Gói trả phí & Kiểm soát chi phí AI → (3) Đặt hàng May đo, Giao vận GHN & Hậu mãi*.

---

## 02:00 – 11:00 | LUỒNG 1: Trải Nghiệm AI Tư Vấn, Giá Đồ & Thử Đồ Thông Minh (9 phút)

*Mục tiêu: Gây ấn tượng ngay trong 10 phút đầu bằng toàn bộ năng lực AI thực chiến của hệ thống.*

### 1.1. AI Stylist gợi ý phối đồ từ Catalog thật (2.5 phút)
* **Thao tác:** Đăng nhập nick `VIP` → Vào **AI Stylist** → Chọn giới tính, dịp mặc (*Công sở / Dự tiệc*), phong cách, ngân sách → Tải ảnh toàn thân + tích xác nhận `imageConsent` → Bấm **Tư vấn**.
* **Kết quả hiển thị:** AI trả về phân tích dáng/phong cách + các bộ outfit ghép từ **sản phẩm thật đang bán trong shop**.
* **Điểm chốt kỹ thuật:**
  * **Chống AI bịa sản phẩm (Anti-hallucination):** Backend chỉ gửi danh sách mã ngắn `P1..Pn` từ `ProductSuggestionService`, lọc đúng giới tính (`FEMALE`/`MALE` + `UNISEX`), mã bịa bị loại bỏ ngay và chỉ lưu `productId` rồi hydrate lại khi đọc.
  * **Bảo mật ảnh & tối ưu chi phí:** Ảnh khách gửi chỉ dùng để phân tích, **không lưu ảnh gốc**, chỉ lưu mã hash để tra cache (`StylistResult.cacheKey`).

### 1.2. AI Fashion Chatbot hội thoại tự nhiên (1.5 phút)
* **Thao tác:** Mở **AI Chat** → Nhắn yêu cầu cụ thể (VD: *"Phối giúp mình 1 set vest công sở tông trung tính dưới 2 triệu"*).
* **Kết quả hiển thị:** Chatbot tư vấn tự nhiên, đính kèm thẻ sản phẩm bấm xem chi tiết ngay; tạo mới `ChatSession` và lưu lịch sử tin nhắn.
* **Điểm chốt kỹ thuật:** Hệ thống theo dõi `tokensIn`/`tokensOut` từng tin nhắn và gợi ý trực tiếp trên kho hàng thật.

### 1.3. Giá đồ (Rack) & Virtual Try-On phối nhiều lớp (2.5 phút)
* **Thao tác:** Từ kết quả Stylist/Chat, bấm thêm áo trong + áo khoác/quần vào **Giá đồ (Rack)** → Vào **Thử đồ ảo (Virtual Try-On)** → Chọn ảnh mẫu và chọn đồ trên Rack → Bấm **Thử đồ**.
* **Kết quả hiển thị:** Sinh ảnh khách mặc bộ đồ đã chọn (hoặc hiển thị nhanh nếu trúng cache đã thử).
* **Điểm chốt kỹ thuật:**
  * Mỗi sản phẩm có thuộc tính `layerRole` (`OUTER`, `INNER`, `BOTTOM`, `FULL_BODY`) giúp hệ thống biết thứ tự lớp trang phục khi thử nhiều món.
  * Kết quả được cache theo `humanImageHash + garmentImageHash` (`TryOnResult`) để khách thử lại cùng bộ không tốn tiền gọi API fal.ai lần 2.

### 1.4. Live Try-On Realtime qua Camera / WebRTC (2.5 phút)
* **Thao tác:** Chuyển sang **Live Try-On** → Chọn sản phẩm muốn thử → Bấm bắt đầu phiên live → Chỉ cho hội đồng thấy luồng thử đồ trực tiếp và bộ đếm thời gian phiên.
* **Điểm chốt kỹ thuật:**
  * Chi phí GPU realtime rất đắt, nên hệ thống kiểm soát qua **`LiveTryOnBudget`** (tách `reservedSeconds` giữ chỗ và `allocatedSeconds` thực dùng theo ngày) + **`LiveTryOnLease`** (khóa tối đa 1 phiên live/user, tự thu hồi khi hết hạn).

> **Câu chuyển sang Luồng 2:** *"Toàn bộ tính năng AI vừa rồi đều gọi dịch vụ AI/GPU có phí thật. Vậy làm sao để dự án có doanh thu bền vững và không bị người dùng spam làm cháy chi phí API? Em xin chuyển sang Luồng 2: Hệ thống gói trả phí SaaS."*

---

## 11:00 – 19:00 | LUỒNG 2: Gói Thành Viên SaaS, Kiểm Soát Quota & Nâng Cấp Proration (8 phút)

*Mục tiêu: Chứng minh tư duy sản phẩm thực tế & năng lực xử lý tài chính SaaS chặt chẽ.*

### 2.1. Phân tầng quyền lợi & Chặn Quota tài khoản `FREE` (1.5 phút)
* **Thao tác:** Chuyển sang Trình duyệt 1 (nick **`FREE`**) → Mở trang **Bảng giá gói**:
  * `FREE` (0đ): 0 Try-On, 3 Stylist/ngày, 50 Chat/ngày.
  * `MEMBER` (34.000đ/30 ngày): 5 Try-On/ngày, 20 Stylist/ngày, 200 Chat/ngày.
  * `VIP` (99.000đ/30 ngày): 10 Try-On/ngày, không giới hạn Stylist & Chat + Live Try-On.
* Bấm thử vào **Virtual Try-On** bằng nick `FREE` → Bị chặn ngay với thông báo yêu cầu nâng cấp (**HTTP `402 Payment Required`**).

### 2.2. Mua gói `MEMBER` & Thanh toán qua Webhook (2.5 phút)
* **Thao tác:** Bấm đăng ký **Member (34.000đ)** → Chọn thanh toán qua **ZaloPay / SePay QR** → Quét thanh toán thành công.
* **Kết quả hiển thị:** Quay về trang kết quả → Gói chuyển sang `ACTIVE` (+30 ngày), tài khoản lên hạng `MEMBER`.
* **Thử trừ hạn mức:** Bấm thử 1 bộ đồ thành công → Mở xem quota thấy lượt Try-On trong ngày giảm ngay **`5/5 → 4/5`**.
* **Điểm chốt kỹ thuật:**
  * Chỉ kích hoạt gói khi nhận **Webhook Server-to-Server** có chữ ký số hợp lệ (không tin Return URL), chống xử lý trùng qua bảng `WebhookEvent` (`eventKey` unique).
  * Quota kiểm tra và tăng nguyên tử (`INCRBY`) trên **Redis** (TTL tự reset lúc 00:00) và đồng bộ xuống `DailyUsage` trong DB → chặn spam đa tab (trả `429 Too Many Requests`).

### 2.3. Nâng cấp giữa kỳ `MEMBER → VIP` bằng thuật toán Proration (2.5 phút)
* **Thao tác:** Ngay trên tài khoản vừa mua `MEMBER` (còn 30 ngày / hoặc 1 tài khoản còn ~20 ngày), bấm nâng cấp lên **`VIP` (99.000đ)**.
* **Kết quả hiển thị:** Màn hình checkout hiển thị **số tiền thực trả đã được khấu trừ tiền gói cũ** (chỉ thu phần chênh lệch, làm tròn lên 1.000đ) chứ không thu đủ 99.000đ → Hoàn tất thanh toán → Lên **`VIP` ngay lập tức**.
* **Điểm chốt kỹ thuật:**
  * Công thức `calcUpgradeProration`: tính Credit phần ngày chưa dùng của gói cũ, Debit phần tương ứng gói mới, đóng băng báo giá (`Order.prorationSnapshot`) trong 24h. Nếu quá 24h khách mới trả, hệ thống tự quy đổi đúng số ngày tương ứng số tiền thực thu (`resolveGrantedDays`).

### 2.4. Vòng đời gói thành viên (1.5 phút)
* **Thao tác:** Mở trang **Quản lý gói / Lịch sử đăng ký** → Thao tác **Tắt / Bật lại Tự động gia hạn (`autoRenew`)** → Giải thích ngắn gọn 3 cơ chế chạy ngầm:
  * **Bất biến DB:** Partial Unique Index đảm bảo mỗi user tối đa **1 dòng `ACTIVE`**; gia hạn cùng gói sẽ cộng dồn `expiresAt + 30 ngày` và ghi vết dòng `RENEWED`.
  * **Xuống gói (Downgrade):** Tạo dòng `SCHEDULED` bắt đầu đúng khi gói hiện tại hết hạn, không cắt quyền đang dùng.
  * **Cron nhắc gia hạn:** Tự động chạy 9h sáng mỗi ngày nhắc khách trước khi hết hạn 3 ngày.

> **Câu chuyển sang Luồng 3:** *"Khi khách đã chọn và thử được bộ đồ ưng ý bằng AI, luồng cuối cùng là đưa trải nghiệm đó ra đời thực: đặt may đo theo đúng số đo cơ thể, thanh toán an toàn, giao hàng qua GHN và xử lý hậu mãi minh bạch."*

---

## 19:00 – 28:30 | LUỒNG 3: Đặt Hàng May Đo, Thanh Toán, Vận Chuyển GHN & Hậu Mãi (9.5 phút)

*Mục tiêu: Khép lại demo bằng luồng mua sắm hoàn chỉnh, nổi bật ở tính cá nhân hóa (May đo), độ chặt tài chính (Authoritative Pricing, Outbox GHN) và hậu mãi chống gian lận.*

### 3.1. Số đo cơ thể & Giỏ hàng đồng bộ (1.5 phút)
* **Thao tác:** Mở mục **Số đo cá nhân (`Measurement`)** xem thông số chiều cao, cân nặng, 3 vòng → Từ món đồ vừa thử, chọn màu/loại (`comboType`) bấm **Thêm vào giỏ hàng**.
* **Kết quả hiển thị:** Giỏ hàng cập nhật tức thì (đồng bộ đa thiết bị qua Socket.IO `cart:updated`).

### 3.2. Checkout & Định giá Authoritative Backend + GHN 2 cấp (2 phút)
* **Thao tác:** Vào **Thanh toán (Checkout)**:
  1. Chọn sản phẩm đang có **`SaleCampaign`** (giá sau sale được tính động ở Backend, không ghi đè giá gốc `Product.price`).
  2. Chọn địa chỉ giao hàng theo **danh mục GHN 2 cấp** (Tỉnh/Thành → Phường/Xã).
  3. Nhập mã giảm giá (**`Coupon`**) → Xem bảng báo giá chi tiết: `Tiền hàng sau Sale + Phí ship GHN (có bảo hiểm hàng) − Giảm giá Coupon`.
* **Điểm chốt kỹ thuật:** Backend tự tính lại 100% ở `OrdersService.buildOrderPricing` — không tin bất kỳ số tiền nào từ client. Giá gốc được snapshot vào `OrderItem.listUnitPriceVnd`, số đo được snapshot vào `OrderItem.measurementSnapshot`.

### 3.3. Đặt hàng, Thanh toán Online & Duyệt May Đo (2.5 phút)
* **Thao tác (Khách):** Bấm **Đặt hàng** → Đơn sinh ra ở trạng thái `CREATED` (có đồng hồ hạn thanh toán `paymentDueAt` 24h) → Thanh toán qua **ZaloPay / MoMo / SePay** → Đơn chuyển sang `PAID`, giỏ hàng tự động xóa đúng món vừa mua.
* **Thao tác (Admin):** Chuyển sang tab **Admin** → Mở đơn mới đặt → Xem **Số đo snapshot** của khách:
  * Chuyển trạng thái qua quy trình may đo: **`MEASUREMENT_REVIEW`** (nêu nhanh: nếu số đo bất thường, Admin có thể gửi yêu cầu khách đo lại ngay trên đơn) → Duyệt xong chuyển **`PROCESSING`** (may) → **`READY_TO_SHIP`**.
* **Điểm chốt kỹ thuật:** Đơn chưa trả quá 24h sẽ được Cron `expireUnpaidOrders` tự động hủy và trả lại lượt dùng Coupon; cổng thanh toán rớt webhook được Cron `reconcileGatewayPayments` quét bù mỗi phút.

### 3.4. Outbox Tạo Vận Đơn GHN, Theo Dõi & Order Chat (1.5 phút)
* **Thao tác:**
  * Khi Admin đẩy đơn sang vận chuyển → Hệ thống ghi `OutboxEvent` trong cùng DB transaction, **BullMQ worker** gọi API GHN bất đồng bộ tạo mã vận đơn và link tracking.
  * Mô phỏng / xem cập nhật trạng thái GHN tự động kéo đơn từ `READY_TO_SHIP` → `SHIPPING` → `DELIVERED` (kèm Cron đồng bộ mỗi 5 phút).
  * Mở nhanh khung **Chat trực tiếp trong đơn hàng (`OrderChat`)** gửi 1 tin nhắn realtime giữa Admin và Khách.
  * Quay lại Khách bấm **Đã nhận hàng (`COMPLETED`)**.

### 3.5. Hậu mãi — Khiếu nại & Hoàn tiền chia tỷ lệ Voucher (2 phút)
* **Thao tác (dùng đơn `DELIVERED` có 2 món + Coupon đã chuẩn bị sẵn):**
  1. **Khách:** Vào đơn → Chọn 1 món bị lỗi size (`WRONG_SIZE`) → Tạo **Khiếu nại (`OrderIssue`)**, tải ảnh minh chứng.
  2. **Admin:** Mở `/admin/order-issues` xem yêu cầu → Chỉ rõ cho Hội đồng 2 điểm ăn tiền:
     * **Chống trục lợi Voucher (`issueRefundAmountVnd`):** Món trả chiếm bao nhiêu % giá trị đơn thì trừ đúng tỷ lệ % Coupon tương ứng (tránh mua kèm đồ đắt để ăn voucher rồi trả lại).
     * **Tách bạch 2 khoản hoàn:** `GOODS` (tiền hàng) và `SHIPPING` (gợi ý hoàn phí ship ban đầu vì lỗi thuộc về shop).
  3. Admin bấm **Duyệt & Hoàn tiền** (qua Gateway online có `idempotencyKey` hoặc ghi nhận chuyển khoản kèm ảnh biên lai) → Trạng thái hoàn tiền & khiếu nại cập nhật đồng bộ (`RESOLVED`).

---

## 28:30 – 30:00 | TỔNG KẾT (1.5 phút)

* Chốt lại **3 trụ cột** của FashionAI vừa chứng minh trực tiếp trên hệ thống:
  1. **AI thực dụng:** Tư vấn không bịa sản phẩm, thử đồ đa lớp theo `layerRole`, Live Try-On WebRTC.
  2. **Kinh doanh & Kiểm soát chi phí bài bản:** Mô hình SaaS phân tầng, Proration giữa kỳ, Redis Quota & GPU Lease.
  3. **Vận hành E-commerce may đo chuẩn sản xuất:** Định giá Authoritative, GHN 2 cấp, Transactional Outbox, đối soát thanh toán tự động và hoàn tiền minh bạch.

---

## Mẹo Điều Chỉnh Nhịp Trong 30 Phút

* **Nếu Hội đồng hỏi xen ngang giữa chừng (thiếu giờ):** Rút gọn mục `1.2` (Chatbot), `2.4` (lịch sử gói) và `3.4` (Order Chat) — vẫn giữ đủ 3 xương sống chính, tiết kiệm được 4–5 phút mà không đứt mạch.
* **Nếu chạy nhanh hơn dự kiến (dư 3–4 phút):** Mở thêm màn hình **Admin Dashboard / Analytics** hoặc chỉ nhanh **sơ đồ ERD ([FashionAI_ERD.drawio](./FashionAI_ERD.drawio))** tab `2. Orders, Payments & SaaS` để giải thích độ chặt của Database.
* **Tài liệu tra cứu nhanh cho phần Q&A sau 30 phút:** [BUSINESS_FINANCE_DEMO_GUIDE.md](./BUSINESS_FINANCE_DEMO_GUIDE.md).
