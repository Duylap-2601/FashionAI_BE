import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  NotificationType,
  OrderIssueReason,
  OrderIssueResolution,
  OrderIssueStatus,
  OrderStatus,
  Prisma,
  RefundKind,
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
import { OPEN_REFUND_STATUSES } from "../orders/constants/order-flow.constants";
import {
  issueRefundAmountVnd,
  orderShippingFeeVnd,
  SHOP_FAULT_ISSUE_REASONS,
} from "./utils/issue-refund-amount.util";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_INT4 = 2147483647;
const ISSUE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Các cột tiền cần để tính số hoàn của món theo chính sách đổi trả.
const refundItemSelect = {
  price: true,
  quantity: true,
  lineTotalVnd: true,
} satisfies Prisma.OrderItemSelect;
const refundOrderSelect = {
  id: true,
  orderCode: true,
  itemsSubtotalVnd: true,
  discountVnd: true,
  discountAmount: true,
  shippingFeeVnd: true,
  shippingFee: true,
  items: { select: refundItemSelect },
} satisfies Prisma.OrderSelect;

/**
 * Tìm yêu cầu theo mã đơn (gõ "35501248", "#35501248" hay "ORD-35501248"), email /
 * tên khách hoặc tên sản phẩm. Mã yêu cầu (uuid) chỉ khớp khi gõ đủ.
 */
function issueSearchFilter(q?: string): Prisma.OrderIssueWhereInput[] | null {
  const term = q?.trim();
  if (!term) return null;
  const contains = { contains: term, mode: "insensitive" as const };
  const filters: Prisma.OrderIssueWhereInput[] = [
    { user: { email: contains } },
    { user: { name: contains } },
    { orderItem: { productNameSnapshot: contains } },
  ];
  const code = term.replace(/^(#|ORD-)/i, "");
  if (/^\d+$/.test(code) && Number(code) <= MAX_INT4) {
    filters.push({ order: { orderCode: Number(code) } });
  }
  if (UUID_REGEX.test(term)) filters.push({ id: term });
  return filters;
}

const issueInclude = {
  order: {
    select: {
      id: true,
      orderCode: true,
      status: true,
      // Modal duyệt hiện phí ship ban đầu và ẩn ô "hoàn phí ship" khi đơn đã có khoản đó.
      shippingFee: true,
      refunds: {
        where: {
          kind: RefundKind.SHIPPING,
          status: { in: [...OPEN_REFUND_STATUSES, RefundStatus.COMPLETED] },
        },
        select: { id: true, status: true },
      },
    },
  },
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
    const isRefundNotReceived =
      dto.reason === OrderIssueReason.REFUND_NOT_RECEIVED;

    if (isRefundNotReceived) {
      await this.assertRefundNotReceivedEligible(order.id, order.refundStatus);
    } else {
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
    }

    const item = await this.prisma.orderItem.findFirst({
      where: { id: orderItemId, orderId: order.id },
    });
    if (!item) {
      throw new NotFoundException("Không tìm thấy sản phẩm thuộc đơn hàng");
    }

    if (!isRefundNotReceived) {
      await this.assertWithinIssueWindow(order.id, order.updatedAt);
    }

    const activeIssue = await this.prisma.orderIssue.findFirst({
      where: {
        orderItemId: item.id,
        status: isRefundNotReceived
          ? { in: [OrderIssueStatus.PENDING, OrderIssueStatus.APPROVED] }
          : {
              in: [
                OrderIssueStatus.PENDING,
                OrderIssueStatus.APPROVED,
                OrderIssueStatus.RESOLVED,
              ],
            },
      },
      select: { id: true, status: true },
    });
    if (activeIssue) {
      throw new BadRequestException(
        activeIssue.status === OrderIssueStatus.RESOLVED
          ? "Sản phẩm này đã được xử lý hoàn tiền, không thể báo lỗi lại"
          : "Sản phẩm này đã có yêu cầu xử lý đang chờ giải quyết",
      );
    }

    if (files.length === 0) {
      throw new BadRequestException(
        "Vui lòng đính kèm ít nhất 1 ảnh minh chứng cho yêu cầu.",
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

    this.notifyAdminsNewIssue(issue.id, order.orderCode, dto.reason).catch(
      () => undefined,
    );

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

  /**
   * Các đơn của khách có yêu cầu đổi trả (mới cập nhật trước), kèm tóm tắt từng yêu cầu
   * và số tiền đã hoàn, cho trang "Đổi trả & hoàn tiền" trong tài khoản.
   */
  async findMineByOrder(userId: string, query: QueryOrderIssueDto) {
    const { page = 1, limit = 20 } = query;
    const where: Prisma.OrderWhereInput = { userId, issues: { some: {} } };
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          orderCode: true,
          status: true,
          refundStatus: true,
          amountRefundedVnd: true,
          createdAt: true,
          updatedAt: true,
          issues: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              status: true,
              reason: true,
              createdAt: true,
              orderItem: { select: { productNameSnapshot: true, productImageSnapshot: true } },
            },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      items: orders.map(({ amountRefundedVnd, ...order }) => ({
        ...order,
        amountRefundedVnd: Number(amountRefundedVnd),
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findAllAdmin(query: QueryOrderIssueDto) {
    const { page = 1, limit = 20 } = query;
    const search = issueSearchFilter(query.q);
    const where: Prisma.OrderIssueWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.reason ? { reason: query.reason } : {}),
      ...(search ? { OR: search } : {}),
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

  async review(
    issueId: string,
    adminId: string,
    dto: ReviewOrderIssueDto,
    receiptImageUrls: string[] = [],
  ) {
    const issue = await this.prisma.orderIssue.findUnique({
      where: { id: issueId },
      include: {
        order: { select: refundOrderSelect },
        orderItem: { select: refundItemSelect },
      },
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
      await this.notifyUserReviewed(rejected.userId, rejected.id, issue.order, false).catch(
        () => undefined,
      );
      return rejected;
    }

    // "Duyệt & hoàn ngay": shop chuyển khoản luôn, không cần khách gửi trả hàng.
    // Kiểm tra chứng từ trước khi đổi bất kỳ trạng thái nào.
    const refundNow = dto.refundNow === true;
    const transferReference = dto.evidenceReference?.trim();
    if (refundNow && (receiptImageUrls.length === 0 || !transferReference)) {
      throw new BadRequestException(
        "Hoàn tiền ngay cần mã giao dịch và ảnh chứng từ chuyển khoản.",
      );
    }

    // Chỉ còn hướng hoàn tiền: duyệt yêu cầu sẽ đưa đơn vào luồng hoàn trả và
    // tạo khoản hoàn tiền chờ xử lý. Yêu cầu ở APPROVED ("đã duyệt, chờ hoàn tiền");
    // updateRefund chuyển sang RESOLVED khi mọi khoản hoàn của đơn đã chuyển xong.
    // Chuyển issue sang APPROVED trước, rồi mới gọi sang luồng refund có sẵn
    // (ordersService.updateRefund tự mở transaction riêng, không thể lồng chung
    // transaction với orderIssue.update). Nếu updateRefund thất bại (validation
    // hoặc lỗi tạm thời), rollback issue về PENDING để tránh lệch trạng thái
    // (Order đã REQUIRED refund nhưng issue vẫn kẹt PENDING).
    const resolved = await this.prisma.orderIssue.update({
      where: { id: issue.id },
      data: {
        status: OrderIssueStatus.APPROVED,
        approvedResolution: OrderIssueResolution.REFUND,
        adminNote: dto.adminNote,
        adminId,
      },
      include: issueInclude,
    });

    const isRefundNotReceived =
      issue.reason === OrderIssueReason.REFUND_NOT_RECEIVED;

    // Duyệt chưa chuyển tiền (hàng còn chưa về) nên không bắt buộc ảnh chứng từ;
    // ảnh bắt buộc khi admin xác nhận đã chuyển khoản (updateRefund COMPLETED).

    try {
      // Báo chưa nhận được tiền: khoản hoàn cũ đã bị đánh dấu "đã hoàn" nên phải
      // mở lại trước, nếu không updateRefund sẽ báo không còn tiền để hoàn.
      const note = dto.adminNote ? `: ${dto.adminNote}` : "";
      if (isRefundNotReceived) {
        // Báo chưa nhận được tiền: khoản cũ bị đánh dấu thất bại rồi mở lại đúng
        // khoản đó (cùng loại, cùng số tiền) để admin chuyển lại.
        const reopened = await this.ordersService.reopenRefundNotReceived(
          issue.orderId,
          issue.id,
          adminId,
        );
        await this.ordersService.updateRefund(
          issue.orderId,
          {
            refundStatus: RefundStatus.REQUIRED,
            kind: reopened.kind,
            amountVnd: reopened.amountVnd,
            internalNote: `Mở lại hoàn tiền cho issue ${issue.id}${note}`,
          },
          adminId,
          receiptImageUrls,
        );
      } else {
        // Tái dùng luồng refund có sẵn: tạo Refund MANUAL + chuyển Order.refundStatus
        // sang REQUIRED, không tự ghi đè Payment/Order.amountRefundedVnd. Tiền hàng chỉ
        // gồm món bị lỗi, cộng vào khoản đang chờ chuyển nếu đơn đã có món khác được duyệt.
        await this.ordersService.updateRefund(
          issue.orderId,
          {
            refundStatus: RefundStatus.REQUIRED,
            kind: RefundKind.GOODS,
            amountVnd: await this.approvedGoodsRefundVnd(issue),
            internalNote: `Duyệt hoàn tiền cho issue ${issue.id} (item ${issue.orderItemId})${note}`,
          },
          adminId,
          receiptImageUrls,
        );
        // Phí ship ban đầu là khoản riêng, admin chọn có hoàn hay không (mặc định hoàn
        // khi lỗi từ phía shop) và mỗi đơn chỉ hoàn một lần.
        const refundShipping =
          dto.refundShipping ?? SHOP_FAULT_ISSUE_REASONS.includes(issue.reason);
        const shippingFeeVnd = orderShippingFeeVnd(issue.order);
        if (refundShipping && shippingFeeVnd > 0 && !(await this.hasShippingRefund(issue.orderId))) {
          await this.ordersService.updateRefund(
            issue.orderId,
            {
              refundStatus: RefundStatus.REQUIRED,
              kind: RefundKind.SHIPPING,
              amountVnd: shippingFeeVnd,
              internalNote: `Hoàn phí ship ban đầu theo issue ${issue.id}${note}`,
            },
            adminId,
          );
        }
      }
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
    // gửi hàng về. Hoàn ngay thì không cần gửi hàng nên đơn sang "đã hoàn trả" luôn.
    // Báo chưa nhận được tiền thì hàng đã về kho rồi (RETURNED), không đổi trạng thái.
    if (!isRefundNotReceived) {
      await this.ordersService
        .updateStatus(
          issue.orderId,
          refundNow
            ? {
                status: OrderStatus.RETURNED,
                source: "ADMIN",
                publicMessage:
                  "Yêu cầu hoàn trả đã được duyệt và shop đã hoàn tiền. Bạn không cần gửi trả sản phẩm.",
                internalNote: `Duyệt và hoàn tiền ngay cho issue ${issue.id}`,
              }
            : {
                status: OrderStatus.RETURN_APPROVED,
                source: "ADMIN",
                publicMessage:
                  "Yêu cầu hoàn trả đã được duyệt. Vui lòng gửi hàng về cửa hàng để được kiểm tra và hoàn tiền.",
                internalNote: `Duyệt hoàn tiền cho issue ${issue.id}`,
              },
          adminId,
        )
        .catch(() => undefined);
    }

    // Ghi nhận luôn các khoản vừa duyệt là đã chuyển (ảnh chứng từ đã lưu ở bước tạo
    // khoản); khoản cuối xong thì updateRefund chuyển yêu cầu sang RESOLVED.
    if (refundNow && transferReference) {
      await this.completeOpenRefunds(issue.orderId, transferReference, adminId);
    }

    await this.logIssueEvent(
      issue.orderId,
      issue.id,
      "ORDER_ISSUE_REFUND_APPROVED",
      adminId,
      isRefundNotReceived
        ? "Shop đã ghi nhận báo cáo chưa nhận được tiền hoàn và đang kiểm tra lại."
        : "Yêu cầu xử lý lỗi đơn hàng đã được duyệt hoàn tiền.",
      "review",
    );
    await this.notifyUserReviewed(
      resolved.userId,
      resolved.id,
      issue.order,
      true,
      isRefundNotReceived,
    ).catch(() => undefined);
    if (!refundNow) return resolved;
    return (
      (await this.prisma.orderIssue.findUnique({
        where: { id: issue.id },
        include: issueInclude,
      })) ?? resolved
    );
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

  // Chỉ cho báo "chưa nhận được tiền" khi shop đã chốt hoàn tiền và còn trong
  // cửa sổ 7 ngày tính từ lần hoàn tiền gần nhất (đồng bộ với cửa sổ báo lỗi).
  private async assertRefundNotReceivedEligible(
    orderId: string,
    refundStatus: RefundStatus | null,
  ) {
    if (refundStatus !== RefundStatus.COMPLETED) {
      throw new BadRequestException(
        "Chỉ báo được khi cửa hàng đã ghi nhận hoàn tiền cho đơn này.",
      );
    }

    const completedRefund = await this.prisma.refund.findFirst({
      where: { orderId, status: RefundStatus.COMPLETED },
      orderBy: [
        { processedAt: { sort: "desc", nulls: "last" } },
        { requestedAt: "desc" },
      ],
      select: { processedAt: true, requestedAt: true },
    });
    const refundedAt = completedRefund?.processedAt ?? completedRefund?.requestedAt;
    if (!refundedAt || Date.now() - refundedAt.getTime() > ISSUE_WINDOW_MS) {
      throw new BadRequestException(
        "Đã quá 7 ngày kể từ khi hoàn tiền, không thể báo chưa nhận được tiền.",
      );
    }

    const pending = await this.prisma.orderIssue.findFirst({
      where: {
        orderId,
        reason: OrderIssueReason.REFUND_NOT_RECEIVED,
        status: OrderIssueStatus.PENDING,
      },
      select: { id: true },
    });
    if (pending) {
      throw new BadRequestException(
        "Bạn đã gửi báo cáo chưa nhận được tiền cho đơn này, vui lòng chờ shop xử lý.",
      );
    }
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
      select: {
        id: true,
        orderCode: true,
        status: true,
        refundStatus: true,
        updatedAt: true,
      },
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

  private async notifyAdminsNewIssue(
    issueId: string,
    orderCode: number,
    reason: OrderIssueReason,
  ) {
    const isRefundNotReceived = reason === OrderIssueReason.REFUND_NOT_RECEIVED;
    const admins = await this.prisma.user.findMany({
      where: { role: Role.ADMIN },
      select: { id: true },
    });
    for (const admin of admins) {
      await this.notificationService.create({
        userId: admin.id,
        type: NotificationType.ORDER_ISSUE,
        title: isRefundNotReceived
          ? "Khách báo chưa nhận được tiền hoàn"
          : "Báo lỗi đơn hàng mới",
        message: isRefundNotReceived
          ? `Đơn #${orderCode} vừa có báo cáo chưa nhận được tiền hoàn`
          : `Đơn #${orderCode} vừa có yêu cầu xử lý lỗi mới`,
        data: { issueId, orderCode, type: "NEW_ORDER_ISSUE", reason },
      });
    }
  }

  private async approvedGoodsRefundVnd(issue: {
    order: Prisma.OrderGetPayload<{ select: typeof refundOrderSelect }>;
    orderItem: Prisma.OrderItemGetPayload<{ select: typeof refundItemSelect }>;
    orderId: string;
  }): Promise<number> {
    const openGoods = await this.prisma.refund.findFirst({
      where: {
        orderId: issue.orderId,
        provider: "MANUAL",
        kind: RefundKind.GOODS,
        status: { in: OPEN_REFUND_STATUSES },
      },
      orderBy: { requestedAt: "desc" },
      select: { amountVnd: true },
    });
    return (
      Number(openGoods?.amountVnd ?? 0) +
      issueRefundAmountVnd(issue.order, issue.orderItem)
    );
  }

  /** Ghi nhận các khoản hoàn đang chờ của đơn là đã chuyển (tiền hàng trước, rồi phí ship). */
  private async completeOpenRefunds(orderId: string, transferReference: string, adminId: string) {
    const open = await this.prisma.refund.findMany({
      where: { orderId, provider: "MANUAL", status: { in: OPEN_REFUND_STATUSES } },
      select: { kind: true },
    });
    const kinds = [RefundKind.GOODS, RefundKind.SHIPPING].filter((kind) =>
      open.some((refund) => refund.kind === kind),
    );
    for (const kind of kinds) {
      await this.ordersService.updateRefund(
        orderId,
        {
          refundStatus: RefundStatus.COMPLETED,
          kind,
          evidenceReference: transferReference,
          internalNote: transferReference,
        },
        adminId,
      );
    }
  }

  /** Đơn đã có khoản hoàn phí ship đang chờ hoặc đã chuyển. */
  private async hasShippingRefund(orderId: string): Promise<boolean> {
    const count = await this.prisma.refund.count({
      where: {
        orderId,
        kind: RefundKind.SHIPPING,
        status: { in: [...OPEN_REFUND_STATUSES, RefundStatus.COMPLETED] },
      },
    });
    return count > 0;
  }

  private async notifyUserReviewed(
    userId: string,
    issueId: string,
    order: { id: string; orderCode: number },
    approved: boolean,
    refundNotReceived = false,
  ) {
    await this.notificationService.create({
      userId,
      type: NotificationType.ORDER_ISSUE,
      title: approved ? "Yêu cầu xử lý được duyệt" : "Yêu cầu xử lý bị từ chối",
      message: approved
        ? refundNotReceived
          ? "Shop đã ghi nhận báo cáo chưa nhận được tiền hoàn và đang kiểm tra lại khoản chuyển cho bạn."
          : "Yêu cầu báo lỗi của bạn đã được duyệt, shop sẽ liên hệ để xử lý tiếp"
        : "Yêu cầu báo lỗi của bạn chưa được chấp nhận, vui lòng xem ghi chú từ shop",
      // orderId để thông báo mở thẳng trang đổi trả & hoàn tiền của đơn.
      data: {
        issueId,
        orderId: order.id,
        orderCode: order.orderCode,
        type: "ORDER_ISSUE_REVIEWED",
        reason: refundNotReceived ? "REFUND_NOT_RECEIVED" : undefined,
      },
    });
  }
}
