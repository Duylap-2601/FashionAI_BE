import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { OrderIssueStatus, OrderStatus } from "@prisma/client";
import { AdminOrderIssuesController } from "../../src/modules/order-issues/admin-order-issues.controller";
import { OrderIssuesController } from "../../src/modules/order-issues/order-issues.controller";
import { OrderIssuesService } from "../../src/modules/order-issues/order-issues.service";
import { NotificationService } from "../../src/modules/notification/notification.service";
import { OrdersService } from "../../src/modules/orders/orders.service";
import { StorageService } from "../../src/modules/storage/storage.service";
import { JwtAuthGuard } from "../../src/modules/auth/guards/jwt-auth.guard";
import {
  createPrismaMock,
  createTestApp,
  PrismaMock,
} from "./helpers/test-app";

const USER_ID = "user-1";
const ADMIN_ID = "admin-1";
const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";

let currentUser: { id: string; email: string; role: "USER" | "ADMIN" } = {
  id: USER_ID,
  email: "user@test.com",
  role: "USER",
};

const authGuardStub = {
  canActivate: (context: any) => {
    context.switchToHttp().getRequest().user = currentUser;
    return true;
  },
};

describe("OrderIssues (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaMock;
  let ordersService: { updateRefund: jest.Mock; updateStatus: jest.Mock };
  let storageService: { uploadImage: jest.Mock };
  let notificationService: { create: jest.Mock };

  const completedOrder = {
    id: ORDER_ID,
    orderCode: 100001,
    status: OrderStatus.COMPLETED,
    updatedAt: new Date(),
  };
  const orderItem = { id: ITEM_ID, orderId: ORDER_ID };

  beforeEach(async () => {
    currentUser = { id: USER_ID, email: "user@test.com", role: "USER" };
    ordersService = {
      updateRefund: jest.fn().mockResolvedValue({}),
      updateStatus: jest.fn().mockResolvedValue({}),
    };
    notificationService = { create: jest.fn().mockResolvedValue({}) };
    storageService = {
      uploadImage: jest
        .fn()
        .mockResolvedValue("https://cdn.test/order-issues/x.png"),
    };

    prisma = createPrismaMock({
      orderIssue: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
    });

    const created = await createTestApp({
      prisma,
      metadata: {
        controllers: [OrderIssuesController, AdminOrderIssuesController],
        providers: [
          OrderIssuesService,
          {
            provide: NotificationService,
            useValue: notificationService,
          },
          { provide: StorageService, useValue: storageService },
          { provide: OrdersService, useValue: ordersService },
        ],
      },
      configure: (builder) =>
        builder.overrideGuard(JwtAuthGuard).useValue(authGuardStub),
    });

    app = created.app;
  });

  afterEach(async () => {
    await app?.close();
  });

  // Đơn 3 món (750k + 550k + 550k) + 30.150đ ship, khách báo sai số đo món 750k.
  function pendingIssue() {
    const item = { price: 750000, quantity: 1, lineTotalVnd: BigInt(750000) };
    return {
      id: "issue-1",
      status: OrderIssueStatus.PENDING,
      reason: "WRONG_SIZE",
      orderId: ORDER_ID,
      orderItemId: ITEM_ID,
      order: {
        id: ORDER_ID,
        orderCode: 100001,
        itemsSubtotalVnd: BigInt(1850000),
        discountVnd: BigInt(0),
        discountAmount: null,
        shippingFeeVnd: BigInt(30150),
        shippingFee: null,
        items: [
          item,
          { price: 550000, quantity: 1, lineTotalVnd: BigInt(550000) },
          { price: 550000, quantity: 1, lineTotalVnd: BigInt(550000) },
        ],
      },
      orderItem: item,
    };
  }

  function mockCompletedOrder() {
    prisma.order.findFirst.mockResolvedValue(completedOrder);
    prisma.orderItem.findFirst.mockResolvedValue(orderItem);
    prisma.orderEvent.findFirst.mockResolvedValue({ occurredAt: new Date() });
  }

  describe("POST /api/orders/:orderId/items/:orderItemId/issues", () => {
    const url = `/api/orders/${ORDER_ID}/items/${ITEM_ID}/issues`;
    const validBody = {
      reason: "WRONG_SIZE",
      description: "Áo bị lệch vai trái khoảng 4cm so với số đo đã đặt",
      desiredResolution: "REFUND",
      bankName: "Vietcombank",
      accountNumber: "0123456789",
      accountHolder: "NGUYEN VAN A",
    };

    const postIssueWithEvidence = () =>
      request(app.getHttpServer())
        .post(url)
        .field("reason", validBody.reason)
        .field("description", validBody.description)
        .field("desiredResolution", validBody.desiredResolution)
        .field("bankName", validBody.bankName)
        .field("accountNumber", validBody.accountNumber)
        .field("accountHolder", validBody.accountHolder)
        .attach("evidenceImages", Buffer.from("evidence"), {
          filename: "evidence.png",
          contentType: "image/png",
        });

    it("tạo issue khi đơn COMPLETED trong hạn 7 ngày", async () => {
      mockCompletedOrder();
      prisma.orderIssue.create.mockResolvedValue({
        id: "issue-1",
        status: "PENDING",
      });

      const res = await postIssueWithEvidence().expect(201);

      expect(res.body.data.status).toBe("PENDING");
      expect(storageService.uploadImage).toHaveBeenCalled();
      expect(prisma.orderIssue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: ORDER_ID,
            orderItemId: ITEM_ID,
          }),
        }),
      );
    });

    it("trả 400 khi thiếu ảnh minh chứng", async () => {
      mockCompletedOrder();

      const res = await request(app.getHttpServer())
        .post(url)
        .send(validBody)
        .expect(400);

      expect(res.body.message).toContain("ảnh minh chứng");
      expect(prisma.orderIssue.create).not.toHaveBeenCalled();
    });

    it("trả 400 khi đơn chưa COMPLETED", async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...completedOrder,
        status: OrderStatus.DELIVERED,
      });

      await request(app.getHttpServer()).post(url).send(validBody).expect(400);
    });

    it("trả 400 khi quá 7 ngày kể từ COMPLETED", async () => {
      prisma.order.findFirst.mockResolvedValue(completedOrder);
      prisma.orderItem.findFirst.mockResolvedValue(orderItem);
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      prisma.orderEvent.findFirst.mockResolvedValue({
        occurredAt: eightDaysAgo,
      });

      await request(app.getHttpServer()).post(url).send(validBody).expect(400);
    });

    it("trả 400 khi item đã có issue đang active", async () => {
      mockCompletedOrder();
      prisma.orderIssue.findFirst.mockResolvedValue({ id: "issue-old", status: OrderIssueStatus.PENDING });

      await request(app.getHttpServer()).post(url).send(validBody).expect(400);
    });

    it("trả 400 khi item đã xử lý hoàn tiền xong", async () => {
      mockCompletedOrder();
      prisma.orderIssue.findFirst.mockResolvedValue({ id: "issue-old", status: OrderIssueStatus.RESOLVED });

      const res = await postIssueWithEvidence().expect(400);

      expect(res.body.message).toContain("đã được xử lý hoàn tiền");
      expect(prisma.orderIssue.create).not.toHaveBeenCalled();
    });

    it("trả 400 khi mô tả quá ngắn", async () => {
      await request(app.getHttpServer())
        .post(url)
        .send({ ...validBody, description: "ngắn" })
        .expect(400);
    });
  });

  describe("PATCH /api/order-issues/:issueId/review (admin)", () => {
    beforeEach(() => {
      currentUser = { id: ADMIN_ID, email: "admin@test.com", role: "ADMIN" };
    });

    it("approve REFUND gọi updateRefund và để issue ở APPROVED (chờ hoàn tiền)", async () => {
      prisma.orderIssue.findUnique.mockResolvedValue(pendingIssue());
      prisma.orderIssue.update.mockResolvedValue({
        id: "issue-1",
        status: "APPROVED",
      });

      const res = await request(app.getHttpServer())
        .patch("/api/order-issues/issue-1/review")
        .field("decision", "APPROVE")
        .field("approvedResolution", "REFUND")
        .attach("receiptImages", Buffer.from("receipt"), {
          filename: "receipt.png",
          contentType: "image/png",
        })
        .expect(200);

      expect(res.body.data.status).toBe("APPROVED");
      // Chỉ sang RESOLVED khi mọi khoản hoàn của đơn đã chuyển (OrdersService.updateRefund).
      expect(prisma.orderIssue.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "APPROVED", approvedResolution: "REFUND" }) }),
      );
      expect(storageService.uploadImage).toHaveBeenCalled();
      // Tiền hàng chỉ gồm món bị lỗi (không hoàn cả đơn 1.880.150đ); phí ship ban đầu
      // là khoản riêng, mặc định hoàn khi lỗi từ phía shop.
      expect(ordersService.updateRefund).toHaveBeenCalledTimes(2);
      expect(ordersService.updateRefund).toHaveBeenNthCalledWith(
        1,
        ORDER_ID,
        expect.objectContaining({ refundStatus: "REQUIRED", kind: "GOODS", amountVnd: 750000 }),
        ADMIN_ID,
        ["https://cdn.test/order-issues/x.png"],
      );
      expect(ordersService.updateRefund).toHaveBeenNthCalledWith(
        2,
        ORDER_ID,
        expect.objectContaining({ refundStatus: "REQUIRED", kind: "SHIPPING", amountVnd: 30150 }),
        ADMIN_ID,
      );
    });

    it("thông báo duyệt cho khách kèm orderId để mở trang đổi trả của đơn", async () => {
      prisma.orderIssue.findUnique.mockResolvedValue(pendingIssue());
      prisma.orderIssue.update.mockResolvedValue({ id: "issue-1", status: "RESOLVED", userId: USER_ID });

      await request(app.getHttpServer())
        .patch("/api/order-issues/issue-1/review")
        .field("decision", "APPROVE")
        .attach("receiptImages", Buffer.from("receipt"), { filename: "receipt.png", contentType: "image/png" })
        .expect(200);

      expect(notificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ORDER_ISSUE",
          data: expect.objectContaining({ orderId: ORDER_ID, orderCode: 100001, type: "ORDER_ISSUE_REVIEWED" }),
        }),
      );
    });

    it("admin bỏ chọn hoàn phí ship thì chỉ tạo khoản tiền hàng", async () => {
      prisma.orderIssue.findUnique.mockResolvedValue(pendingIssue());
      prisma.orderIssue.update.mockResolvedValue({ id: "issue-1", status: "RESOLVED" });

      await request(app.getHttpServer())
        .patch("/api/order-issues/issue-1/review")
        .field("decision", "APPROVE")
        .field("refundShipping", "false")
        .attach("receiptImages", Buffer.from("receipt"), {
          filename: "receipt.png",
          contentType: "image/png",
        })
        .expect(200);

      expect(ordersService.updateRefund).toHaveBeenCalledTimes(1);
      expect(ordersService.updateRefund).toHaveBeenCalledWith(
        ORDER_ID,
        expect.objectContaining({ kind: "GOODS", amountVnd: 750000 }),
        ADMIN_ID,
        ["https://cdn.test/order-issues/x.png"],
      );
    });

    it("approve món thứ hai cộng vào khoản tiền hàng đang chờ, không hoàn ship lần nữa", async () => {
      prisma.orderIssue.findUnique.mockResolvedValue(pendingIssue());
      prisma.orderIssue.update.mockResolvedValue({ id: "issue-1", status: "RESOLVED" });
      // Đơn đã có khoản tiền hàng 550k chờ chuyển và khoản phí ship từ món trước.
      prisma.refund.findFirst.mockResolvedValue({ amountVnd: BigInt(550000) });
      prisma.refund.count.mockResolvedValue(1);

      await request(app.getHttpServer())
        .patch("/api/order-issues/issue-1/review")
        .field("decision", "APPROVE")
        .attach("receiptImages", Buffer.from("receipt"), {
          filename: "receipt.png",
          contentType: "image/png",
        })
        .expect(200);

      expect(ordersService.updateRefund).toHaveBeenCalledWith(
        ORDER_ID,
        expect.objectContaining({ refundStatus: "REQUIRED", kind: "GOODS", amountVnd: 550000 + 750000 }),
        ADMIN_ID,
        ["https://cdn.test/order-issues/x.png"],
      );
      expect(ordersService.updateRefund).toHaveBeenCalledTimes(1);
    });

    it("duyệt & hoàn ngay: tạo khoản, đơn sang RETURNED rồi ghi nhận đã hoàn từng khoản", async () => {
      // Lần đọc thứ hai là yêu cầu sau khi hoàn xong (đã RESOLVED).
      prisma.orderIssue.findUnique
        .mockResolvedValueOnce(pendingIssue())
        .mockResolvedValueOnce({ id: "issue-1", status: "RESOLVED" });
      prisma.orderIssue.update.mockResolvedValue({ id: "issue-1", status: "APPROVED" });
      prisma.refund.findMany.mockResolvedValue([{ kind: "SHIPPING" }, { kind: "GOODS" }]);

      await request(app.getHttpServer())
        .patch("/api/order-issues/issue-1/review")
        .field("decision", "APPROVE")
        .field("refundNow", "true")
        .field("evidenceReference", "VCB FT2611040099")
        .attach("receiptImages", Buffer.from("receipt"), { filename: "receipt.png", contentType: "image/png" })
        .expect(200);

      const calls = ordersService.updateRefund.mock.calls.map(([, dto]) => `${dto.refundStatus}:${dto.kind}`);
      expect(calls).toEqual(["REQUIRED:GOODS", "REQUIRED:SHIPPING", "COMPLETED:GOODS", "COMPLETED:SHIPPING"]);
      expect(ordersService.updateRefund).toHaveBeenLastCalledWith(
        ORDER_ID,
        expect.objectContaining({ refundStatus: "COMPLETED", kind: "SHIPPING", evidenceReference: "VCB FT2611040099" }),
        ADMIN_ID,
      );
      expect(ordersService.updateStatus).toHaveBeenCalledWith(
        ORDER_ID,
        expect.objectContaining({ status: "RETURNED" }),
        ADMIN_ID,
      );
    });

    it("duyệt & hoàn ngay thiếu mã giao dịch thì báo lỗi trước khi đổi trạng thái", async () => {
      prisma.orderIssue.findUnique.mockResolvedValue(pendingIssue());

      const res = await request(app.getHttpServer())
        .patch("/api/order-issues/issue-1/review")
        .field("decision", "APPROVE")
        .field("refundNow", "true")
        .attach("receiptImages", Buffer.from("receipt"), { filename: "receipt.png", contentType: "image/png" })
        .expect(400);

      expect(res.body.message).toContain("mã giao dịch");
      expect(prisma.orderIssue.update).not.toHaveBeenCalled();
      expect(ordersService.updateRefund).not.toHaveBeenCalled();
    });

    it("approve không cần ảnh chứng từ vì chưa chuyển tiền", async () => {
      prisma.orderIssue.findUnique.mockResolvedValue(pendingIssue());
      prisma.orderIssue.update.mockResolvedValue({ id: "issue-1", status: "APPROVED" });

      await request(app.getHttpServer())
        .patch("/api/order-issues/issue-1/review")
        .send({ decision: "APPROVE", approvedResolution: "REFUND" })
        .expect(200);

      expect(ordersService.updateRefund).toHaveBeenCalledWith(
        ORDER_ID,
        expect.objectContaining({ refundStatus: "REQUIRED", kind: "GOODS" }),
        ADMIN_ID,
        [],
      );
    });

    it("trả 400 khi approve EXCHANGE (chỉ hỗ trợ REFUND)", async () => {
      const res = await request(app.getHttpServer())
        .patch("/api/order-issues/issue-1/review")
        .send({ decision: "APPROVE", approvedResolution: "EXCHANGE" })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(ordersService.updateRefund).not.toHaveBeenCalled();
    });

    it("approve thiếu approvedResolution vẫn duyệt REFUND", async () => {
      prisma.orderIssue.findUnique.mockResolvedValue(pendingIssue());
      prisma.orderIssue.update.mockResolvedValue({
        id: "issue-1",
        status: "RESOLVED",
      });

      const res = await request(app.getHttpServer())
        .patch("/api/order-issues/issue-1/review")
        .field("decision", "APPROVE")
        .attach("receiptImages", Buffer.from("receipt"), {
          filename: "receipt.png",
          contentType: "image/png",
        })
        .expect(200);

      expect(res.body.data.status).toBe("RESOLVED");
      expect(ordersService.updateRefund).toHaveBeenCalledWith(
        ORDER_ID,
        expect.objectContaining({ refundStatus: "REQUIRED" }),
        ADMIN_ID,
        ["https://cdn.test/order-issues/x.png"],
      );
    });

    it("trả 400 khi REJECT thiếu adminNote", async () => {
      prisma.orderIssue.findUnique.mockResolvedValue({
        id: "issue-1",
        status: "PENDING",
      });

      await request(app.getHttpServer())
        .patch("/api/order-issues/issue-1/review")
        .send({ decision: "REJECT" })
        .expect(400);
    });

  });

  describe("GET /api/order-issues/mine", () => {
    it("trả các đơn có đổi trả của chính khách, không bị route :issueId bắt nhầm", async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          id: ORDER_ID,
          orderCode: 100001,
          status: "RETURNED",
          refundStatus: "COMPLETED",
          amountRefundedVnd: BigInt(1300000),
          createdAt: new Date(),
          updatedAt: new Date(),
          issues: [{ id: "issue-1", status: "RESOLVED", reason: "WRONG_SIZE", createdAt: new Date(), orderItem: null }],
        },
      ]);
      prisma.order.count.mockResolvedValue(1);

      const res = await request(app.getHttpServer()).get("/api/order-issues/mine").expect(200);

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: USER_ID, issues: { some: {} } } }),
      );
      expect(prisma.orderIssue.findUnique).not.toHaveBeenCalled();
      expect(res.body.data[0]).toEqual(expect.objectContaining({ orderCode: 100001, amountRefundedVnd: 1300000 }));
      expect(res.body.meta.total).toBe(1);
    });
  });

  describe("GET /api/order-issues (admin)", () => {
    it("chặn user thường với 403", async () => {
      await request(app.getHttpServer()).get("/api/order-issues").expect(403);
    });

    it("admin tìm theo mã đơn dạng #35501248 hoặc ORD-35501248", async () => {
      currentUser = { id: ADMIN_ID, email: "admin@test.com", role: "ADMIN" };
      prisma.orderIssue.findMany.mockResolvedValue([]);

      await request(app.getHttpServer()).get("/api/order-issues").query({ q: "ORD-35501248" }).expect(200);

      expect(prisma.orderIssue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([{ order: { orderCode: 35501248 } }, { user: { email: { contains: "ORD-35501248", mode: "insensitive" } } }]),
          }),
        }),
      );
    });

    it("admin xem được danh sách có phân trang", async () => {
      currentUser = { id: ADMIN_ID, email: "admin@test.com", role: "ADMIN" };
      prisma.orderIssue.findMany.mockResolvedValue([{ id: "issue-1" }]);
      prisma.orderIssue.count.mockResolvedValue(1);

      const res = await request(app.getHttpServer())
        .get("/api/order-issues")
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(1);
    });
  });
});
