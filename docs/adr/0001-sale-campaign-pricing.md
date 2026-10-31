# Giá sale là dẫn xuất từ chiến dịch, không ghi đè giá sản phẩm

Giá niêm yết của sản phẩm phải giữ nguyên để có thể mở nhiều đợt sale, tự hết
hạn và so sánh lịch sử. Vì vậy sale được mô hình hóa thành chiến dịch giảm giá
theo sản phẩm và thời gian; giá bán thực tế được resolve tại thời điểm đọc hoặc
tính đơn, không cập nhật vào giá sản phẩm. Đơn hàng chỉ lưu snapshot giá niêm
yết của dòng được giảm giá; campaign id, tên và phần trăm không được lưu vì có
thể suy ra từ giá đã trả.

## Consequences

- Không cần cron hoàn giá khi chiến dịch kết thúc.
- Sửa hoặc xoá chiến dịch không làm thay đổi đơn cũ.
- Sort và lọc theo giá bán thực tế phải resolve campaign trước khi sắp xếp,
  thay vì sort trực tiếp trên cột giá.
- Muốn lưu campaign đã áp cho mục đích báo cáo thì phải thêm snapshot riêng;
  hiện tại chưa cần.
