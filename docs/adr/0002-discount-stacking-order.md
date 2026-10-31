# Sale áp trước, mã giảm giá áp sau

Khi một sản phẩm vừa đang sale vừa có mã giảm giá, khách được hưởng cả hai.
Giá sale được tính trên giá niêm yết; mã giảm giá được tính trên tạm tính sau
sale. Vì vậy tạm tính trong đơn hàng mang nghĩa "tổng tiền hàng sau sale, trước
mã giảm giá", còn tổng đơn vẫn giữ công thức cũ: tạm tính + phí ship − mã giảm
giá.

## Consequences

- Điều kiện giá trị tối thiểu của mã giảm giá được so với tạm tính sau sale.
- Giao diện thanh toán phải hiển thị riêng dòng giảm giá sale và dòng mã giảm
  giá để khách hiểu vì sao tổng thay đổi.
- Không cần lưu tổng giảm sale trên đơn; có thể suy ra từ giá niêm yết và giá
  đã trả của từng dòng.
