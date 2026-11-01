import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  NotificationType,
  OrderIssueResolution,
  OrderIssueStatus,
  OrderStatus,
  Prisma,
  RefundStatus,
  Role,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { NotificationService } from "../notification/notification.service";
import { OrdersService } from "../orders/orders.service";
import { StorageService } from "../storage/storage.service";
import { CreateOrderIssueDto } from "./dto/create-order-issue.dto";
import { QueryOrderIssueDto } from "./dto/query-order-issue.dto";
import { ReviewOrderIssueDto } from "./dto/review-order-issue.dto";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_INT4 = 2147483647;
const ISSUE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const issueInclude = {
  order: { select: { id: true, orderCode: true, status: true } },
  orderItem: {
    select: {
      id: true,
      productId: true,
      quantity: true,
      color: true,
      productNameSnapshot: true,
      productImageSnapshot: true,
    },
  },
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.OrderIssueInclude;

@Injectable()
export class OrderIssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly storageService: StorageService,
    private readonly ordersService: OrdersService,
  ) {}

  async create(
    userId: string,
    orderId: string,
    orderItemId: string,
    dto: CreateOrderIssueDto,
    files: Express.Multer.File[] = [],
  ) {
    const order = await this.findOrderForOwner(userId, orderId);

    // Đơn đã hoàn tất, hoặc đang trong luồng trả hàng (để nhiều item cùng báo lỗi
    // / bổ sung yêu cầu trả một phần) đều được tạo yêu cầu.
    const reportableStatuses: OrderStatus[] = [
      OrderStatus.COMPLETED,
      OrderStatus.RETURN_REQUESTED,
      OrderStatus.RETURN_APPROVED,
      OrderStatus.RETURNING,
    ];
    if (!reportableStatuses.includes(order.status)) {
      throw new BadRequestException(
        "Chỉ có thể báo lỗi khi đơn hàng đã hoàn tất (COMPLETED) hoặc đang trong luồng hoàn trả",
      );
    }

    const item = await this.prisma.orderItem.findFirst({
      where: { id: orderItemId, orderId: order.id },
    });
    if (!item) {
      throw new NotFoundException("Không tìm thấy sản phẩm thuộc đơn hàng");
    }

    await this.assertWithinIssueWindow(order.id, order.updatedAt);

    const activeIssue = await this.prisma.orderIssue.findFirst({
      where: {
        orderItemId: item.id,
        status: { in: [OrderIssueStatus.PENDING, OrderIssueStatus.APPROVED] },
      },
      select: { id: true },
    });
    if (activeIssue) {
      throw new BadRequestException(
        "Sản phẩm này đã có yêu cầu xử lý đang chờ giải quyết",
      );
    }

    const evidenceImages: string[] = [];
    for (const file of files) {
      evidenceImages.push(
        await this.storageService.uploadImage(file.buffer, "order-issues"),
      );
    }

    const issue = await this.prisma.$transaction(async (tx) => {
      const created = await tx.orderIssue.create({
        data: {
          orderId: order.id,
          orderItemId: item.id,
          userId,
          reason: dto.reason,
          description: dto.description,
          desiredResolution: OrderIssueResolution.REFUND,
          bankName: dto.bankName ?? null,
          accountNumber: dto.accountNumber ?? null,
          accountHolder: dto.accountHolder ?? null,
          evidenceImages:
            evidenceImages.length > 0 ? evidenceImages : Prisma.DbNull,
        },
        include: issueInclude,
      });

      // Snapshot STK nhận hoàn lên đơn để admin thấy khi xác nhận hoàn tiền và
      // khách xem lại được trong chi tiết đơn.
      await tx.order.update({
        where: { id: order.id },
        data: {
          refundBankName: dto.bankName ?? null,
          refundAccountNumber: dto.accountNumber ?? null,
          refundAccountHolder: dto.accountHolder ?? null,
        },
      });

      return created;
    });

    // Đưa đơn sang bước chờ hoàn trả để admin biết cần nhận lại hàng trước khi
    // hoàn tiền. Lỗi chuyển trạng thái không được làm hỏng việc tạo yêu cầu.
    if (order.status === OrderStatus.COMPLETED) {
      await this.ordersService
        .updateStatus(
          order.id,
          {
            status: OrderStatus.RETURN_REQUESTED,
            source: "USER",
            publicMessage:
              "Đã ghi nhận yêu cầu hoàn trả. Vui lòng gửi hàng về cửa hàng để được kiểm tra và hoàn tiền.",
            internalNote: `Yêu cầu hoàn trả từ issue ${issue.id}`,
          },
          userId,
        )
        .catch(() => undefined);
    }

    this.notifyAdminsNewIssue(issue.id, order.orderCode).catch(() => undefined);

    return issue;
  }

  async findByOrder(
    orderId: string,
    userId: string,
    isAdmin: boolean,
    query: QueryOrderIssueDto,
  ) {
    const order = isAdmin
      ? await this.findOrderByIdentifier(orderId)
      : await this.findOrderForOwner(userId, orderId);
    if (!order) {
      throw new NotFoundException(`Không tìm thấy đơn hàng có ID ${orderId}`);
    }

    const { page = 1, limit = 20 } = query;
    const where: Prisma.OrderIssueWhereInput = {
      orderId: order.id,
      ...(query.status ? { status: query.status } : {}),
      ...(query.reason ? { reason: query.reason } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.orderIssue.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: issueInclude,
      }),
      this.prisma.orderIssue.count({ where }),
    ]);

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findAllAdmin(query: QueryOrderIssueDto) {
    const { page = 1, limit = 20 } = query;
    const where: Prisma.OrderIssueWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.reason ? { reason: query.reason } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.orderIssue.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: issueInclude,
      }),
      this.prisma.orderIssue.count({ where }),
    ]);

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(issueId: string, userId: string, isAdmin: boolean) {
    const issue = await this.prisma.orderIssue.findUnique({
      where: { id: issueId },
      include: issueInclude,
    });
    if (!issue) {
      throw new NotFoundException("Không tìm thấy yêu cầu xử lý");
    }
    if (!isAdmin && issue.userId !== userId) {
      throw new ForbiddenException("Bạn không có quyền xem yêu cầu này");
    }
    return issue;
  }

  async review(issueId: string, adminId: string, dto: ReviewOrderIssueDto) {
    const issue = await this.prisma.orderIssue.findUnique({
      where: { id: issueId },
      include: { order: { select: { id: true, orderCode: true } } },
    });
    if (!issue) {
      throw new NotFoundException("Không tìm thấy yêu cầu xử lý");
    }
    if (issue.status !== OrderIssueStatus.PENDING) {
      throw new BadRequestException(
        "Yêu cầu này đã được xử lý, không thể duyệt lại",
      );
    }

    if (dto.decision === "REJECT") {
      if (!dto.adminNote?.trim()) {
        throw new BadRequestException(
          "Từ chối yêu cầu cần kèm lý do (adminNote)",
        );
      }
      const rejected = await this.prisma.orderIssue.update({
        where: { id: issue.id },
        data: {
          status: OrderIssueStatus.REJECTED,
          adminNote: dto.adminNote,
          adminId,
        },
        include: issueInclude,
      });
      await this.logIssueEvent(
        issue.orderId,
        issue.id,
        "ORDER_ISSUE_REJECTED",
        adminId,
        "Yêu cầu xử lý lỗi đơn hàng đã bị từ chối.",
        "review",
      );
      await this.notifyUserReviewed(rejected.userId, rejected.id, false).catch(
        () => undefined,
      );
      return rejected;
    }

    // Chỉ còn hướng hoàn tiền: duyệt yêu cầu sẽ đưa đơn vào luồng hoàn trả và
    // tạo khoản hoàn tiền chờ xử lý.
    // Chuyển issue sang RESOLVED trước, rồi mới gọi sang luồng refund có sẵn
    // (ordersService.updateRefund tự mở transaction riêng, không thể lồng chung
    // transaction với orderIssue.update). Nếu updateRefund thất bại (validation
    // hoặc lỗi tạm thời), rollback issue về PENDING để tránh lệch trạng thái
    // (Order đã REQUIRED refund nhưng issue vẫn kẹt PENDING).
    const resolved = await this.prisma.orderIssue.update({
      where: { id: issue.id },
      data: {
        status: OrderIssueStatus.RESOLVED,
        approvedResolution: OrderIssueResolution.REFUND,
        adminNote: dto.adminNote,
        adminId,
      },
      include: issueInclude,
    });

    try {
      // Tái dùng luồng refund có sẵn: tạo Refund MANUAL + chuyển Order.refundStatus
      // sang REQUIRED, không tự ghi đè Payment/Order.amountRefundedVnd.
      await this.ordersService.updateRefund(
        issue.orderId,
        {
          refundStatus: RefundStatus.REQUIRED,
          internalNote: `Duyệt hoàn tiền cho issue ${issue.id} (item ${issue.orderItemId})${dto.adminNote ? `: ${dto.adminNote}` : ""}`,
        },
        adminId,
      );
    } catch (err) {
      await this.prisma.orderIssue.update({
        where: { id: issue.id },
        data: {
          status: OrderIssueStatus.PENDING,
          approvedResolution: null,
          adminNote: issue.adminNote,
          adminId: issue.adminId,
        },
      });
      throw err;
    }

    // Đơn chuyển sang "đã duyệt hoàn trả" để admin/theo dõi biết khách được
    // gửi hàng về. Không chặn luồng duyệt nếu trạng thái hiện tại không hợp lệ.
    await this.ordersService
      .updateStatus(
        issue.orderId,
        {
          status: OrderStatus.RETURN_APPROVED,
          source: "ADMIN",
          publicMessage:
            "Yêu cầu hoàn trả đã được duyệt. Vui lòng gửi hàng về cửa hàng để được kiểm tra và hoàn tiền.",
          internalNote: `Duyệt hoàn tiền cho issue ${issue.id}`,
        },
        adminId,
      )
      .catch(() => undefined);

    await this.logIssueEvent(
      issue.orderId,
      issue.id,
      "ORDER_ISSUE_REFUND_APPROVED",
      adminId,
      "Yêu cầu xử lý lỗi đơn hàng đã được duyệt hoàn tiền.",
      "review",
    );
    await this.notifyUserReviewed(resolved.userId, resolved.id, true).catch(
      () => undefined,
    );
    return resolved;
  }

  // Ghi OrderEvent lên timeline đơn hàng gốc để FE order detail thấy mốc xử lý
  // issue. deduplicationKey theo (issueId, stage) để tránh double-click tạo
  // nhiều event trùng cho cùng 1 bước xử lý.
  private async logIssueEvent(
    orderId: string,
    issueId: string,
    type: string,
    actorId: string | undefined,
    publicMessage: string,
    stage: string,
  ) {
    await this.prisma.orderEvent
      .create({
        data: {
          orderId,
          type,
          source: "ADMIN",
          actorId,
          publicMessage,
          deduplicationKey: `order-issue:${issueId}:${stage}`,
          metadata: { issueId },
        },
      })
      .catch((err) => {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          return null;
        }
        throw err;
      });
  }

  private async assertWithinIssueWindow(orderId: string, fallback: Date) {
    const completedEvent = await this.prisma.orderEvent.findFirst({
      where: { orderId, toStatus: OrderStatus.COMPLETED },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    });
    const completedAt = completedEvent?.occurredAt ?? fallback;
    if (Date.now() - completedAt.getTime() > ISSUE_WINDOW_MS) {
      throw new BadRequestException(
        "Đã quá 7 ngày kể từ khi đơn hàng hoàn tất, không thể báo lỗi",
      );
    }
  }

  private async findOrderForOwner(userId: string, identifier: string) {
    const where = this.resolveOrderWhere(identifier);
    if (!where) {
      throw new NotFoundException(
        `Không tìm thấy đơn hàng có ID ${identifier}`,
      );
    }
    const order = await this.prisma.order.findFirst({
      where: { ...where, userId },
      select: { id: true, orderCode: true, status: true, updatedAt: true },
    });
    if (!order) {
      throw new NotFoundException(
        `Không tìm thấy đơn hàng có ID ${identifier}`,
      );
    }
    return order;
  }

  private async findOrderByIdentifier(identifier: string) {
    const where = this.resolveOrderWhere(identifier);
    if (!where) return null;
    return this.prisma.order.findFirst({
      where,
      select: { id: true, orderCode: true, status: true, updatedAt: true },
    });
  }

  private resolveOrderWhere(identifier: string): Prisma.OrderWhereInput | null {
    const value = identifier.trim();
    if (UUID_REGEX.test(value)) {
      return { id: value };
    }
    const numeric = Number(value.replace(/^ORD-/i, ""));
    if (Number.isInteger(numeric) && numeric > 0 && numeric <= MAX_INT4) {
      return { orderCode: numeric };
    }
    return null;
  }

  private async notifyAdminsNewIssue(issueId: string, orderCode: number) {
    const admins = await this.prisma.user.findMany({
      where: { role: Role.ADMIN },
      select: { id: true },
    });
    for (const admin of admins) {
      await this.notificationService.create({
        userId: admin.id,
        type: NotificationType.ORDER_ISSUE,
        title: "Báo lỗi đơn hàng mới",
        message: `Đơn #${orderCode} vừa có yêu cầu xử lý lỗi mới`,
        data: { issueId, orderCode, type: "NEW_ORDER_ISSUE" },
      });
    }
  }

  private async notifyUserReviewed(
    userId: string,
    issueId: string,
    approved: boolean,
  ) {
    await this.notificationService.create({
      userId,
      type: NotificationType.ORDER_ISSUE,
      title: approved ? "Yêu cầu xử lý được duyệt" : "Yêu cầu xử lý bị từ chối",
      message: approved
        ? "Yêu cầu báo lỗi của bạn đã được duyệt, shop sẽ liên hệ để xử lý tiếp"
        : "Yêu cầu báo lỗi của bạn chưa được chấp nhận, vui lòng xem ghi chú từ shop",
      data: { issueId, type: "ORDER_ISSUE_REVIEWED" },
    });
  }
}
