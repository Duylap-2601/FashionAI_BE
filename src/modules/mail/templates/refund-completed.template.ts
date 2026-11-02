import { RefundCompletedData, RenderedMail } from '../mail.types';
import { escapeHeader, escapeHtml } from '../utils/escape-html';
import { formatDateVi, formatVnd, textLines } from '../utils/mail-formatters';
import {
  badge,
  bulletproofButton,
  definitionRow,
  divider,
  fallbackLink,
  h1,
  infoPanel,
  paragraph,
} from './mail-components';
import { renderMailLayout } from './mail-layout';
import { mailIdentity, mailTheme } from './mail-theme';

const REFUND_PROVIDER_LABELS: Record<string, string> = {
  MANUAL: 'Chuyển khoản ngân hàng',
  MOMO: 'Ví MoMo',
  ZALOPAY: 'ZaloPay',
  SEPAY: 'SePay',
};

const MAX_RECEIPT_IMAGES = 5;

export function renderRefundCompletedMail(
  input: RefundCompletedData & { detailUrl: string },
): RenderedMail {
  const providerLabel = REFUND_PROVIDER_LABELS[input.provider] ?? input.provider;
  const subject = escapeHeader(
    `${mailIdentity.subjectPrefix} Đã hoàn tiền đơn hàng #${input.orderCode}`,
  );
  const preheader = `Shop đã hoàn ${formatVnd(input.amountVnd)} cho đơn hàng #${input.orderCode}. Mở để kiểm tra thông tin hoàn tiền.`;
  const content = `
    ${h1('Đã hoàn tiền cho đơn hàng')}
    <div style="margin:0 0 16px 0;">${badge('Đã hoàn tiền', '#ffffff', mailTheme.success)}</div>
    ${paragraph(`Shop đã hoàn ${formatVnd(input.amountVnd)} cho đơn hàng #${input.orderCode}. Vui lòng kiểm tra tài khoản nhận tiền của bạn.`)}
    ${infoPanel(`<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
      ${definitionRow('Số tiền hoàn', formatVnd(input.amountVnd), true)}
      ${definitionRow('Tổng đã hoàn cho đơn', formatVnd(input.totalRefundedVnd))}
      ${definitionRow('Hình thức', providerLabel)}
      ${definitionRow('Thời gian xử lý', formatDateVi(input.processedAt))}
    </table>`, mailTheme.success)}
    ${renderBankAccount(input)}
    ${renderReceipts(input)}
    ${paragraph('Thời gian nhận tiền tùy thuộc vào ngân hàng hoặc ví điện tử, thường từ 1 đến 3 ngày làm việc. Nếu sau thời gian trên bạn chưa nhận được tiền, hãy liên hệ hỗ trợ để được kiểm tra.')}
    ${bulletproofButton(input.detailUrl, 'Kiểm tra đơn hàng')}
    ${fallbackLink(input.detailUrl)}
  `;

  return {
    subject,
    html: renderMailLayout({ subject, preheader, content }),
    text: textLines([
      'StAie. FashionAI',
      `Đã hoàn tiền cho đơn hàng #${input.orderCode}`,
      '',
      `Số tiền hoàn: ${formatVnd(input.amountVnd)}`,
      `Tổng đã hoàn cho đơn: ${formatVnd(input.totalRefundedVnd)}`,
      `Hình thức: ${providerLabel}`,
      `Thời gian xử lý: ${formatDateVi(input.processedAt)}`,
      input.bankName ? `Ngân hàng: ${input.bankName}` : null,
      input.accountNumber ? `Số tài khoản: ${input.accountNumber}` : null,
      input.accountHolder ? `Chủ tài khoản: ${input.accountHolder}` : null,
      input.evidenceReference ? `Mã giao dịch: ${input.evidenceReference}` : null,
      ...(input.receiptImages ?? []).map((url, index) => `Ảnh chứng từ ${index + 1}: ${url}`),
      '',
      'Vui lòng kiểm tra tài khoản nhận tiền. Thời gian nhận tiền tùy thuộc ngân hàng hoặc ví điện tử, thường 1-3 ngày làm việc.',
      '',
      input.detailUrl,
    ]),
  };
}

function renderBankAccount(input: RefundCompletedData): string {
  if (!input.bankName && !input.accountNumber && !input.accountHolder) return '';
  const rows = [
    input.bankName ? definitionRow('Ngân hàng', input.bankName) : '',
    input.accountNumber ? definitionRow('Số tài khoản', input.accountNumber) : '',
    input.accountHolder ? definitionRow('Chủ tài khoản', input.accountHolder) : '',
  ].join('');
  return `${divider()}<h2 style="margin:0 0 10px 0; font-size:18px; line-height:26px; color:${mailTheme.heading};">Tài khoản nhận tiền</h2><table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${rows}</table>`;
}

function renderReceipts(input: RefundCompletedData): string {
  const images = (input.receiptImages ?? [])
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(0, MAX_RECEIPT_IMAGES);
  const reference = input.evidenceReference?.trim();
  if (images.length === 0 && !reference) return '';

  const referenceHtml = reference
    ? `<p style="margin:0 0 12px 0; color:${mailTheme.mutedText}; font-size:13px; line-height:20px;">Mã giao dịch: <span style="color:${mailTheme.heading}; font-weight:600;">${escapeHtml(reference)}</span></p>`
    : '';
  const imagesHtml = images.length > 0 ? renderReceiptImageRows(images) : '';
  const links = images
    .map((url, index) => `<a href="${escapeHtml(url)}" style="color:${mailTheme.brand}; text-decoration:underline;">Ảnh ${index + 1}</a>`)
    .join(' · ');
  const fallbackHtml = images.length > 0
    ? `<p style="margin:8px 0 0 0; color:${mailTheme.mutedText}; font-size:12px; line-height:18px;">Nếu ảnh không hiển thị, mở: ${links}</p>`
    : '';

  return `${divider()}<h2 style="margin:0 0 10px 0; font-size:18px; line-height:26px; color:${mailTheme.heading};">Chứng từ chuyển khoản</h2>${referenceHtml}${imagesHtml}${fallbackHtml}`;
}

function renderReceiptImageRows(images: string[]): string {
  const rows: string[] = [];
  for (let index = 0; index < images.length; index += 2) {
    const pair = images.slice(index, index + 2);
    const cells = pair.map((url, offset) => `
      <td width="50%" style="padding:0 4px 8px 4px; vertical-align:top;">
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="text-decoration:none;">
          <img src="${escapeHtml(url)}" alt="Chứng từ chuyển khoản ${index + offset + 1}" width="248" style="display:block; width:100%; max-width:248px; height:auto; border:1px solid ${mailTheme.border}; border-radius:8px;" />
        </a>
      </td>`).join('');
    const fill = pair.length === 1 ? '<td width="50%"></td>' : '';
    rows.push(`<tr>${cells}${fill}</tr>`);
  }
  return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse; margin:0 -4px;">${rows.join('')}</table>`;
}
