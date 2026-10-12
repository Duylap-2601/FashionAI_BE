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
  let ordersService: { updateRefund: jest.Mock };
  let storageService: { uploadImage: jest.Mock };

  const completedOrder = {
    id: ORDER_ID,
    orderCode: 100001,
    status: OrderStatus.COMPLETED,
    updatedAt: new Date(),
  };
  const orderItem = { id: ITEM_ID, orderId: ORDER_ID };

  beforeEach(async () => {
    currentUser = { id: USER_ID, email: "user@test.com", role: "USER" };
    ordersService = { updateRefund: jest.fn().mockResolvedValue({}) };
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
            useValue: { create: jest.fn().mockResolvedValue({}) },
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
    };

    it("tạo issue khi đơn COMPLETED trong hạn 7 ngày", async () => {
      mockCompletedOrder();
      prisma.orderIssue.create.mockResolvedValue({
        id: "issue-1",
        status: "PENDING",
      });

      const res = await request(app.getHttpServer())
        .post(url)
        .send(validBody)
        .expect(201);

      expect(res.body.data.status).toBe("PENDING");
      expect(prisma.orderIssue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: ORDER_ID,
            orderItemId: ITEM_ID,
          }),
        }),
      );
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
      prisma.orderIssue.findFirst.mockResolvedValue({ id: "issue-old" });

      await request(app.getHttpServer()).post(url).send(validBody).expect(400);
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

    it("approve REFUND gọi updateRefund và chuyển issue sang RESOLVED", async () => {
      prisma.orderIssue.findUnique.mockResolvedValue({
        id: "issue-1",
        status: OrderIssueStatus.PENDING,
        orderId: ORDER_ID,
        orderItemId: ITEM_ID,
        order: { id: ORDER_ID, orderCode: 100001 },
      });
      prisma.orderIssue.update.mockResolvedValue({
        id: "issue-1",
        status: "RESOLVED",
      });

      const res = await request(app.getHttpServer())
        .patch("/api/order-issues/issue-1/review")
        .send({ decision: "APPROVE", approvedResolution: "REFUND" })
        .expect(200);

      expect(res.body.data.status).toBe("RESOLVED");
      expect(ordersService.updateRefund).toHaveBeenCalledWith(
        ORDER_ID,
        expect.objectContaining({ refundStatus: "REQUIRED" }),
        ADMIN_ID,
      );
    });

    it("approve EXCHANGE chuyển issue sang APPROVED, không gọi refund", async () => {
      prisma.orderIssue.findUnique.mockResolvedValue({
        id: "issue-1",
        status: OrderIssueStatus.PENDING,
        orderId: ORDER_ID,
        orderItemId: ITEM_ID,
        order: { id: ORDER_ID, orderCode: 100001 },
      });
      prisma.orderIssue.update.mockResolvedValue({
        id: "issue-1",
        status: "APPROVED",
      });

      const res = await request(app.getHttpServer())
        .patch("/api/order-issues/issue-1/review")
        .send({ decision: "APPROVE", approvedResolution: "EXCHANGE" })
        .expect(200);

      expect(res.body.data.status).toBe("APPROVED");
      expect(ordersService.updateRefund).not.toHaveBeenCalled();
    });

    it("trả 400 khi APPROVE thiếu approvedResolution", async () => {
      prisma.orderIssue.findUnique.mockResolvedValue({
        id: "issue-1",
        status: "PENDING",
      });

      await request(app.getHttpServer())
        .patch("/api/order-issues/issue-1/review")
        .send({ decision: "APPROVE" })
        .expect(400);
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

    it("trả 400 khi resolve issue chưa APPROVED", async () => {
      prisma.orderIssue.findUnique.mockResolvedValue({
        id: "issue-1",
        status: "PENDING",
      });

      await request(app.getHttpServer())
        .patch("/api/order-issues/issue-1/resolve")
        .send({})
        .expect(400);
    });
  });

  describe("GET /api/order-issues (admin)", () => {
    it("chặn user thường với 403", async () => {
      await request(app.getHttpServer()).get("/api/order-issues").expect(403);
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
