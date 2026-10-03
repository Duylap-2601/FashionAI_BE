import { RenderedMail, RenewalReminderData } from '../mail.types';
import { escapeHeader, escapeHtml } from '../utils/escape-html';
import { formatDateVi, formatVnd, textLines } from '../utils/mail-formatters';
import { badge, bulletproofButton, definitionRow, fallbackLink, h1, infoPanel, paragraph } from './mail-components';
import { renderMailLayout } from './mail-layout';
import { mailIdentity, mailTheme } from './mail-theme';

export function renderRenewalReminderMail(input: RenewalReminderData & { subscriptionUrl: string }): RenderedMail {
  const tier = tierDisplay(input.tier, input.tierLabel);
  const subject = escapeHeader(`${mailIdentity.subjectPrefix} Gói ${tier.label} của bạn sắp hết hạn`);
  const preheader = `Gói ${tier.label} còn ${input.daysRemaining} ngày. Gia hạn để tiếp tục sử dụng các tính năng FashionAI.`;
  const content = `
    ${h1(`Gói ${tier.label} sắp hết hạn`)}
    ${paragraph(`Xin chào ${input.name}, gói hội viên của bạn sắp hết hạn vào ${formatDateVi(input.expiresAt)}.`)}
    <div style="margin:0 0 16px 0;">${badge(tier.label, tier.textColor, tier.background)}</div>
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse; margin:18px 0;">
      ${definitionRow('Ngày hết hạn', formatDateVi(input.expiresAt))}
      ${definitionRow('Số ngày còn lại', `${input.daysRemaining} ngày`)}
      ${definitionRow('Giá / 30 ngày', formatVnd(input.price))}
      ${definitionRow('Mã đơn', `#${input.orderCode}`)}
    </table>
    ${infoPanel('Link thanh toán có thể hết hạn trước ngày hết hạn gói. Nếu link không còn hiệu lực, hãy mở trang gói hội viên để tạo checkout mới.', mailTheme.warning)}
    ${bulletproofButton(input.checkoutUrl, 'Gia hạn gói')}
    ${fallbackLink(input.checkoutUrl)}
    <p style="margin:16px 0 0 0; color:${mailTheme.mutedText}; font-size:13px; line-height:21px;">Hoặc mở <a href="${escapeHtml(input.subscriptionUrl)}" style="color:${mailTheme.brand}; text-decoration:underline;">trang gói hội viên</a> để tạo liên kết thanh toán mới.</p>
  `;

  return {
    subject,
    html: renderMailLayout({ subject, preheader, content }),
    text: textLines([
      'StAle. FashionAI',
      `Gói ${tier.label} sắp hết hạn`,
      '',
      `Xin chào ${input.name},`,
      `Gói của bạn hết hạn vào ${formatDateVi(input.expiresAt)}.`,
      `Số ngày còn lại: ${input.daysRemaining}`,
      `Giá / 30 ngày: ${formatVnd(input.price)}`,
      `Mã đơn: #${input.orderCode}`,
      '',
      'Gia hạn gói:',
      input.checkoutUrl,
      '',
      'Nếu link thanh toán hết hạn, mở trang gói hội viên để tạo checkout mới:',
      input.subscriptionUrl,
    ]),
  };
}

function tierDisplay(tier: string, fallback: string) {
  if (tier === 'MEMBER') {
    return { label: 'Hội Viên (Member)', background: mailTheme.member, textColor: mailTheme.heading };
  }
  if (tier === 'VIP') {
    return { label: 'Khách Hàng VIP', background: mailTheme.gold, textColor: mailTheme.brand };
  }
  return { label: fallback || tier, background: mailTheme.background, textColor: mailTheme.brand };
}
