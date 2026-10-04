import { OrderConfirmationData, RenderedMail } from '../mail.types';
import { escapeHeader, escapeHtml } from '../utils/escape-html';
import { formatVnd, textLines } from '../utils/mail-formatters';
import { badge, bulletproofButton, definitionRow, divider, fallbackLink, h1, paragraph } from './mail-components';
import { renderMailLayout } from './mail-layout';
import { mailIdentity, mailTheme } from './mail-theme';

export function renderOrderConfirmationMail(input: OrderConfirmationData & { detailUrl: string }): RenderedMail {
  const subject = escapeHeader(`${mailIdentity.subjectPrefix} Xác nhận đơn hàng #${input.orderCode}`);
  const preheader = `Đơn hàng #${input.orderCode} đã được thanh toán. Xem chi tiết đơn hàng và thông tin giao nhận.`;
  const rows = input.items.map((item) => renderItemRow(item.name, item.color, item.quantity, item.price)).join('');
  const shipping = renderShipping(input.shippingInfo);
  const content = `
    ${h1('Cảm ơn bạn đã đặt hàng')}
    <div style="margin:0 0 16px 0;">${badge('Đã thanh toán', '#ffffff', mailTheme.success)}</div>
    ${paragraph(`Đơn hàng #${input.orderCode} của bạn đã được thanh toán thành công.`)}
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse; margin:20px 0;">${rows}</table>
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse; margin:16px 0;">
      ${definitionRow('Tạm tính', formatVnd(input.itemsTotal))}
      ${definitionRow('Vận chuyển', formatVnd(input.shippingFee))}
      ${input.discountAmount > 0 ? definitionRow('Giảm giá', `-${formatVnd(input.discountAmount)}`) : ''}
      ${definitionRow('Tổng cộng', formatVnd(input.total), true)}
    </table>
    ${shipping}
    ${bulletproofButton(input.detailUrl, 'Xem chi tiết đơn hàng')}
    ${fallbackLink(input.detailUrl)}
  `;

  return {
    subject,
    html: renderMailLayout({ subject, preheader, content }),
    text: textLines([
      'StAle. FashionAI',
      `Cảm ơn bạn đã đặt hàng #${input.orderCode}`,
      'Trạng thái: Đã thanh toán',
      '',
      ...input.items.map((item) => `- ${item.name}${item.color ? ` (${item.color})` : ''} | SL: ${item.quantity} | ${formatVnd(item.price * item.quantity)}`),
      '',
      `Tạm tính: ${formatVnd(input.itemsTotal)}`,
      `Vận chuyển: ${formatVnd(input.shippingFee)}`,
      input.discountAmount > 0 ? `Giảm giá: -${formatVnd(input.discountAmount)}` : null,
      `Tổng cộng: ${formatVnd(input.total)}`,
      input.shippingInfo?.name || input.shippingInfo?.phone || input.shippingInfo?.address ? '\nThông tin giao hàng:' : null,
      input.shippingInfo?.name ? `Tên: ${input.shippingInfo.name}` : null,
      input.shippingInfo?.phone ? `Điện thoại: ${input.shippingInfo.phone}` : null,
      input.shippingInfo?.address ? `Địa chỉ: ${input.shippingInfo.address}` : null,
      input.shippingInfo?.note ? `Ghi chú: ${input.shippingInfo.note}` : null,
      '',
      input.detailUrl,
    ]),
  };
}

function renderItemRow(name: string, color: string | null | undefined, quantity: number, price: number): string {
  const variant = color ? `<div style="color:${mailTheme.mutedText}; font-size:13px; line-height:20px; margin-top:2px;">${escapeHtml(color)}</div>` : '';
  return `<tr><td style="padding:14px 0; border-bottom:1px solid ${mailTheme.border};"><div style="font-weight:700; color:${mailTheme.heading};">${escapeHtml(name)}</div>${variant}<div style="color:${mailTheme.mutedText}; font-size:13px; line-height:20px; margin-top:2px;">SL: ${escapeHtml(quantity)}</div></td><td align="right" style="padding:14px 0; border-bottom:1px solid ${mailTheme.border}; color:${mailTheme.heading}; font-weight:700;">${escapeHtml(formatVnd(price * quantity))}</td></tr>`;
}

function renderShipping(info: OrderConfirmationData['shippingInfo']): string {
  if (!info?.name && !info?.phone && !info?.address && !info?.note) return '';
  return `${divider()}<h2 style="margin:0 0 10px 0; font-size:18px; line-height:26px; color:${mailTheme.heading};">Thông tin giao hàng</h2>${info.name ? `<p style="margin:2px 0;">${escapeHtml(info.name)}${info.phone ? ` - ${escapeHtml(info.phone)}` : ''}</p>` : info.phone ? `<p style="margin:2px 0;">${escapeHtml(info.phone)}</p>` : ''}${info.address ? `<p style="margin:2px 0;">${escapeHtml(info.address)}</p>` : ''}${info.note ? `<p style="margin:8px 0 0 0; color:${mailTheme.mutedText};">Ghi chú: ${escapeHtml(info.note)}</p>` : ''}`;
}
