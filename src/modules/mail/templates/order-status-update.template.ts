import { OrderStatus } from '@prisma/client';
import { OrderStatusUpdateData, RenderedMail } from '../mail.types';
import { escapeHeader, escapeHtml } from '../utils/escape-html';
import { textLines } from '../utils/mail-formatters';
import { badge, bulletproofButton, divider, fallbackLink, h1, infoPanel, paragraph } from './mail-components';
import { renderMailLayout } from './mail-layout';
import { mailIdentity, mailTheme } from './mail-theme';

interface StatusMeta {
  label: string;
  title: string;
  message: string;
  accent: string;
}

const ORDER_STATUS_MAIL_META: Partial<Record<OrderStatus, StatusMeta>> = {
  [OrderStatus.CONFIRMED]: {
    label: 'Đã xác nhận',
    title: 'Đơn hàng đã được xác nhận',
    message: 'Shop đã xác nhận đơn hàng của bạn và đang chuẩn bị hàng để giao. Chúng tôi sẽ thông báo khi đơn được gửi đi.',
    accent: mailTheme.success,
  },
  [OrderStatus.CANCELLED]: {
    label: 'Đã hủy',
    title: 'Đơn hàng đã bị hủy',
    message: 'Đơn hàng của bạn đã được hủy. Nếu có yêu cầu hoàn tiền, trạng thái xử lý sẽ được cập nhật trong chi tiết đơn hàng.',
    accent: mailTheme.error,
  },
};

export function renderOrderStatusUpdateMail(input: OrderStatusUpdateData & { detailUrl: string }): RenderedMail {
  const meta = ORDER_STATUS_MAIL_META[input.status];
  if (!meta) throw new Error(`Unsupported mail order status: ${input.status}`);

  const subject = escapeHeader(`${mailIdentity.subjectPrefix} Đơn hàng #${input.orderCode} - ${meta.label}`);
  const preheader = `Đơn hàng #${input.orderCode}: ${meta.label}. Mở chi tiết đơn hàng để xem thông tin mới nhất.`;
  const shipping = renderShipping(input.shippingInfo);
  const content = `
    ${h1(meta.title)}
    <div style="margin:0 0 16px 0;">${badge(meta.label, '#ffffff', meta.accent)}</div>
    ${paragraph(meta.message)}
    ${infoPanel(`<strong style="color:${mailTheme.heading};">Trạng thái hiện tại:</strong> <span style="color:${meta.accent}; font-weight:700;">${escapeHtml(meta.label)}</span>`, meta.accent)}
    ${shipping}
    ${bulletproofButton(input.detailUrl, 'Xem chi tiết đơn hàng')}
    ${fallbackLink(input.detailUrl)}
  `;

  return {
    subject,
    html: renderMailLayout({ subject, preheader, content }),
    text: textLines([
      'StAle. FashionAI',
      meta.title,
      '',
      meta.message,
      `Trạng thái hiện tại: ${meta.label}`,
      input.shippingInfo?.name || input.shippingInfo?.phone || input.shippingInfo?.address ? '\nThông tin giao hàng:' : null,
      input.shippingInfo?.name ? `Tên: ${input.shippingInfo.name}` : null,
      input.shippingInfo?.phone ? `Điện thoại: ${input.shippingInfo.phone}` : null,
      input.shippingInfo?.address ? `Địa chỉ: ${input.shippingInfo.address}` : null,
      '',
      input.detailUrl,
    ]),
  };
}

function renderShipping(info: OrderStatusUpdateData['shippingInfo']): string {
  if (!info?.name && !info?.phone && !info?.address) return '';
  return `${divider()}<h2 style="margin:0 0 10px 0; font-size:18px; line-height:26px; color:${mailTheme.heading};">Thông tin giao hàng</h2>${info.name ? `<p style="margin:2px 0;">${escapeHtml(info.name)}${info.phone ? ` - ${escapeHtml(info.phone)}` : ''}</p>` : info.phone ? `<p style="margin:2px 0;">${escapeHtml(info.phone)}</p>` : ''}${info.address ? `<p style="margin:2px 0;">${escapeHtml(info.address)}</p>` : ''}`;
}
