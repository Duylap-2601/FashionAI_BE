import { escapeHtml } from '../utils/escape-html';
import { mailTheme } from './mail-theme';

export function eyebrow(text: string): string {
  return `<div style="font-size:12px; line-height:18px; letter-spacing:0.08em; font-weight:700; color:${mailTheme.brand}; text-transform:uppercase; margin-bottom:10px;">${escapeHtml(text)}</div>`;
}

export function h1(text: string): string {
  return `<h1 class="mail-title" style="margin:0 0 16px 0; font-size:28px; line-height:36px; font-weight:700; color:${mailTheme.heading};">${escapeHtml(text)}</h1>`;
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px 0;">${escapeHtml(text)}</p>`;
}

export function badge(label: string, color: string, background: string = '#F9F7F5'): string {
  return `<span style="display:inline-block; padding:5px 10px; border-radius:999px; background:${background}; color:${color}; border:1px solid ${mailTheme.border}; font-size:12px; line-height:18px; font-weight:700;">${escapeHtml(label)}</span>`;
}

export function infoPanel(content: string, borderColor: string = mailTheme.border, background: string = '#FCFBFA'): string {
  return `<div style="background:${background}; border:1px solid ${mailTheme.border}; border-left:4px solid ${borderColor}; border-radius:10px; padding:16px; margin:20px 0;">${content}</div>`;
}

export function divider(): string {
  return `<div style="height:1px; line-height:1px; background:${mailTheme.border}; margin:20px 0;">&nbsp;</div>`;
}

export function fallbackLink(url: string): string {
  const safeUrl = escapeHtml(url);
  return `<p style="margin:18px 0 0 0; color:${mailTheme.mutedText}; font-size:13px; line-height:21px;">Nếu nút không hoạt động, mở đường dẫn này:<br><a href="${safeUrl}" style="color:${mailTheme.brand}; text-decoration:underline; word-break:break-all; overflow-wrap:anywhere;">${safeUrl}</a></p>`;
}

export function bulletproofButton(url: string, label: string): string {
  const safeUrl = escapeHtml(url);
  const safeLabel = escapeHtml(label);
  return `<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse; margin:24px 0 8px 0;"><tr><td align="center" bgcolor="${mailTheme.brand}" style="border-radius:8px;">
    <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${safeUrl}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="16%" strokecolor="${mailTheme.brand}" fillcolor="${mailTheme.brand}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${safeLabel}</center></v:roundrect><![endif]-->
    <!--[if !mso]><!--><a href="${safeUrl}" style="display:inline-block; min-width:172px; min-height:20px; padding:14px 24px; background:${mailTheme.brand}; color:#ffffff; border-radius:8px; font-family:${mailTheme.font}; font-size:16px; line-height:20px; font-weight:700; text-decoration:none; text-align:center;">${safeLabel}</a><!--<![endif]-->
  </td></tr></table>`;
}

export function definitionRow(label: string, value: string, strong = false): string {
  return `<tr><td style="padding:6px 0; color:${mailTheme.mutedText};">${escapeHtml(label)}</td><td align="right" style="padding:6px 0; color:${mailTheme.heading}; ${strong ? 'font-size:18px; font-weight:700;' : 'font-weight:600;'}">${escapeHtml(value)}</td></tr>`;
}
