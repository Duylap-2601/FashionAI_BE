import { PasswordResetMailData, RenderedMail } from '../mail.types';
import { escapeHeader } from '../utils/escape-html';
import { textLines } from '../utils/mail-formatters';
import { bulletproofButton, fallbackLink, h1, infoPanel, paragraph } from './mail-components';
import { renderMailLayout } from './mail-layout';
import { mailIdentity, mailTheme } from './mail-theme';

export function renderPasswordResetMail(input: PasswordResetMailData): RenderedMail {
  const subject = escapeHeader(`${mailIdentity.subjectPrefix} Đặt lại mật khẩu của bạn`);
  const preheader = 'Đặt lại mật khẩu FashionAI trong vòng 1 giờ.';
  const content = `
    ${h1('Đặt lại mật khẩu')}
    ${paragraph('Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản FashionAI của bạn.')}
    ${paragraph('Nhấn nút bên dưới để tạo mật khẩu mới. Đường dẫn chỉ có hiệu lực trong 1 giờ.')}
    ${bulletproofButton(input.resetUrl, 'Tạo mật khẩu mới')}
    ${fallbackLink(input.resetUrl)}
    ${infoPanel('Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này. Mật khẩu hiện tại của bạn vẫn được giữ nguyên.', mailTheme.warning)}
  `;

  return {
    subject,
    html: renderMailLayout({ subject, preheader, content }),
    text: textLines([
      'StAle. FashionAI',
      'Đặt lại mật khẩu',
      '',
      'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản FashionAI của bạn.',
      'Đường dẫn có hiệu lực trong 1 giờ:',
      input.resetUrl,
      '',
      'Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.',
    ]),
  };
}
