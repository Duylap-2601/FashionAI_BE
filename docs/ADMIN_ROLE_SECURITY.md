# Admin Role Security Enhancements

## 📋 Tổng quan

Tài liệu này mô tả các cải tiến bảo mật được thêm vào hệ thống quản lý quyền admin.

## 🔐 Các quy tắc bảo mật đã thêm

### 1. Admin không thể tự thay đổi role của chính họ

**Vấn đề:** Admin có thể vô tình hoặc cố ý hạ cấp chính mình xuống USER, gây mất quyền truy cập dashboard.

**Giải pháp:** 
- Kiểm tra `id === currentUserId` khi cập nhật role
- Throw `BadRequestException` nếu admin cố gắng thay đổi role của chính họ
- Admin vẫn có thể thay đổi `tier` và `isVerified` của chính họ

**Code:**
```typescript
// src/modules/users/users.service.ts
if (id === currentUserId && dto.role !== undefined) {
  throw new BadRequestException('Bạn không thể thay đổi quyền của chính mình');
}
```

### 2. Không thể hạ cấp admin cuối cùng

**Vấn đề:** Nếu hệ thống chỉ còn 1 admin và admin đó bị hạ cấp, sẽ không còn ai có quyền quản trị.

**Giải pháp:**
- Đếm số lượng admin trong hệ thống trước khi hạ cấp
- Nếu chỉ còn 1 admin, không cho phép hạ cấp
- Yêu cầu phải có ít nhất 1 admin trong hệ thống

**Code:**
```typescript
if (dto.role && dto.role !== user.role && user.role === 'ADMIN') {
  const adminCount = await this.prisma.user.count({
    where: { role: 'ADMIN' },
  });

  if (adminCount <= 1) {
    throw new BadRequestException(
      'Không thể hạ cấp admin cuối cùng. Phải có ít nhất một admin trong hệ thống.',
    );
  }
}
```

## 📝 API Changes

### `PATCH /users/:id`

**Request Headers:**
```
Authorization: Bearer <admin_access_token>
```

**Request Body:**
```json
{
  "role": "USER" | "ADMIN",
  "tier": "FREE" | "MEMBER" | "VIP",
  "isVerified": boolean
}
```

**Success Response (200):**
```json
{
  "status": "success",
  "code": "ADMIN_USER_UPDATED",
  "message": "Cập nhật thông tin người dùng thành công",
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "User Name",
    "role": "ADMIN",
    "tier": "VIP",
    "isVerified": true
  }
}
```

**Error Responses:**

**400 - Admin cố tự thay đổi role:**
```json
{
  "statusCode": 400,
  "message": "Bạn không thể thay đổi quyền của chính mình"
}
```

**400 - Hạ cấp admin cuối cùng:**
```json
{
  "statusCode": 400,
  "message": "Không thể hạ cấp admin cuối cùng. Phải có ít nhất một admin trong hệ thống."
}
```

**404 - User không tồn tại:**
```json
{
  "statusCode": 404,
  "message": "Không tìm thấy người dùng"
}
```

## 🧪 Testing

### Test Scripts

1. **Test admin self-modification prevention:**
   ```bash
   ADMIN_ACCESS_TOKEN="..." ADMIN_USER_ID="..." node test-admin-self-modification.js
   ```

2. **Test admin user data:**
   ```bash
   ACCESS_TOKEN="..." node test-admin-user.js
   ```

### Manual Testing

1. **Test Case 1: Admin tự hạ cấp chính họ**
   - Login as admin
   - Try to change your own role to USER via PATCH /users/:your-id
   - Expected: 400 Bad Request với message "Bạn không thể thay đổi quyền của chính mình"

2. **Test Case 2: Hạ cấp admin cuối cùng**
   - Ensure only 1 admin exists in system
   - Try to demote that admin to USER
   - Expected: 400 Bad Request với message về admin cuối cùng

3. **Test Case 3: Admin thay đổi tier của chính họ**
   - Login as admin
   - Try to change your own tier via PATCH /users/:your-id
   - Expected: 200 Success - Admin CÓ THỂ thay đổi tier của chính họ

4. **Test Case 4: Admin A thay đổi role của Admin B (khi có >= 2 admins)**
   - Login as Admin A
   - Try to demote Admin B to USER
   - Expected: 200 Success - Được phép khi còn nhiều admin

## 🔄 Migration Notes

### Không cần migration

Các thay đổi này chỉ là business logic, không ảnh hưởng đến database schema.

### Rollback Strategy

Nếu cần rollback:
1. Revert commit trong `users.service.ts`
2. Revert commit trong `users.controller.ts`
3. Không cần rollback database

## 📊 Impact Analysis

### Performance
- **Minimal impact**: Thêm 1 query đếm admin (chỉ khi hạ cấp admin)
- Query có index trên `role` column nên rất nhanh

### Security
- **High improvement**: Ngăn chặn tình huống hệ thống mất hết admin
- **High improvement**: Ngăn admin vô tình tự hạ cấp

### User Experience
- Admin được bảo vệ khỏi lỗi thao tác
- Message lỗi rõ ràng, dễ hiểu

## 📚 Related Files

- `src/modules/users/users.service.ts` - Business logic
- `src/modules/users/users.controller.ts` - API endpoint
- `src/modules/users/dto/update-user-admin.dto.ts` - DTO validation
- `test-admin-self-modification.js` - Test script

## 👥 Future Improvements

1. **Audit Log**: Log mọi thay đổi về role
2. **Super Admin**: Tạo role SUPER_ADMIN có quyền cao nhất
3. **Role Permissions**: Thêm permission granular thay vì chỉ 2 role
4. **2FA for Admin**: Yêu cầu xác thực 2 lớp khi thay đổi role
5. **Admin Invitation**: Chỉ admin hiện tại mới được mời admin mới

## 📞 Contact

Nếu có vấn đề hoặc câu hỏi, liên hệ development team.
