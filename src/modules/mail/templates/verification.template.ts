import { RenderedMail, VerificationMailData } from '../mail.types';
import { escapeHeader, escapeHtml } from '../utils/escape-html';
import { textLines } from '../utils/mail-formatters';
import { badge, eyebrow, h1, infoPanel, paragraph } from './mail-components';
import { renderMailLayout } from './mail-layout';
import { mailIdentity, mailTheme } from './mail-theme';

export function renderVerificationMail(input: VerificationMailData): RenderedMail {
  const subject = escapeHeader(`${mailIdentity.subjectPrefix} Mã xác thực email của bạn`);
  const preheader = 'Mã xác thực FashionAI của bạn có hiệu lực trong 5 phút.';
  const otp = escapeHtml(input.otp);
  const content = `
    ${eyebrow('Bảo mật tài khoản')}
    ${h1('Xác thực địa chỉ email')}
    ${paragraph('Cảm ơn bạn đã đăng ký tài khoản tại StAle. FashionAI.')}
    ${paragraph('Nhập mã dưới đây trong ứng dụng để hoàn tất xác thực email.')}
    <div class="mail-otp" dir="ltr" style="margin:22px 0; padding:18px 14px; background:${mailTheme.background}; border:1px solid ${mailTheme.border}; border-radius:10px; text-align:center; font-family:'Courier New', Consolas, monospace; font-size:36px; line-height:44px; letter-spacing:12px; font-weight:700; color:${mailTheme.heading};">${otp}</div>
    ${infoPanel(`${badge('Bảo mật', mailTheme.brand)}<div style="margin-top:10px;">Mã này có hiệu lực trong 5 phút. Không chia sẻ mã này cho bất kỳ ai, kể cả người tự xưng là nhân viên hỗ trợ.</div>`, mailTheme.warning)}
  `;

  return {
    subject,
    html: renderMailLayout({ subject, preheader, content }),
    text: textLines([
      'StAle. FashionAI',
      'Xác thực địa chỉ email',
      '',
      `Mã xác thực của bạn: ${input.otp}`,
      'Mã này có hiệu lực trong 5 phút. Không chia sẻ mã này cho bất kỳ ai.',
    ]),
  };
}
