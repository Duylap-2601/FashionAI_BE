import { escapeHtml } from '../utils/escape-html';
import { mailIdentity, mailTheme } from './mail-theme';

interface MailLayoutInput {
  subject: string;
  preheader: string;
  content: string;
  supportEmail?: string;
}

export function renderMailLayout(input: MailLayoutInput): string {
  const year = new Date().getFullYear();
  const title = escapeHtml(input.subject);
  const preheader = escapeHtml(input.preheader);
  const supportEmail = input.supportEmail ? escapeHtml(input.supportEmail) : '';

  return `<!doctype html>
<html lang="vi" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="x-ua-compatible" content="ie=edge">
  <title>${title}</title>
  <!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
  <style>
    @media only screen and (max-width: 640px) {
      .mail-card { width: 100% !important; }
      .mail-padded { padding-left: 20px !important; padding-right: 20px !important; }
      .mail-title { font-size: 24px !important; line-height: 32px !important; }
      .mail-otp { font-size: 30px !important; letter-spacing: 8px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background:${mailTheme.background}; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
  <div style="display:none!important; visibility:hidden; font-size:1px; line-height:1px; max-height:0; max-width:0; overflow:hidden; opacity:0; color:transparent; mso-hide:all;">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="${mailTheme.background}" style="width:100%; border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; background:${mailTheme.background};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <!--[if mso]><table role="presentation" width="600" border="0" cellspacing="0" cellpadding="0"><tr><td><![endif]-->
        <table class="mail-card" role="presentation" align="center" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="${mailTheme.surface}" style="width:100%; max-width:600px; border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; background:${mailTheme.surface}; border:1px solid ${mailTheme.border}; border-radius:12px; overflow:hidden;">
          <tr>
            <td class="mail-padded" style="padding:28px 32px 20px 32px; border-bottom:1px solid ${mailTheme.border};">
              <div style="font-family:${mailTheme.wordmarkFont}; color:${mailTheme.brand}; font-size:28px; line-height:32px; letter-spacing:-0.3px;">${mailIdentity.wordmarkHtml}</div>
              <div style="font-family:${mailTheme.font}; color:${mailTheme.mutedText}; font-size:13px; line-height:20px; margin-top:4px;">${mailIdentity.product}</div>
            </td>
          </tr>
          <tr>
            <td class="mail-padded" style="padding:32px; font-family:${mailTheme.font}; color:${mailTheme.body}; font-size:16px; line-height:26px;">
              ${input.content}
            </td>
          </tr>
          <tr>
            <td class="mail-padded" style="padding:22px 32px 28px 32px; border-top:1px solid ${mailTheme.border}; font-family:${mailTheme.font}; color:${mailTheme.mutedText}; font-size:12px; line-height:20px;">
              <div style="font-weight:600; color:${mailTheme.heading};">${mailIdentity.fromName}</div>
              <div>© ${year} ${mailIdentity.fromName}. Mọi quyền được bảo lưu.</div>
              ${supportEmail ? `<div>Hỗ trợ: <a href="mailto:${supportEmail}" style="color:${mailTheme.brand}; text-decoration:underline;">${supportEmail}</a></div>` : ''}
            </td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}
