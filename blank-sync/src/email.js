// Sends the morning reorder email through Gmail (needs a Gmail app password).
import nodemailer from 'nodemailer';
import { config } from './config.js';

export function emailConfigured() {
  return Boolean(config.gmailUser && config.gmailAppPassword && config.alertEmailTo);
}

export function reorderEmailText({ groups, notSet, lowCount }, pageUrl) {
  const lines = [`${lowCount} blank color/size${lowCount === 1 ? ' is' : 's are'} at or below the minimum.`, ''];
  for (const g of groups) {
    lines.push(`${g.supplier} (${g.totalQty} shirts)`);
    for (const l of g.lines) {
      lines.push(`  Order ${l.orderQty}: ${l.product} - ${l.variant} (have ${l.available})${l.reorderUrl ? `  ${l.reorderUrl}` : ''}`);
    }
    lines.push('');
  }
  if (notSet.length) lines.push(`${notSet.length} blank color/size(s) have no "Reorder at" yet and aren't checked.`, '');
  lines.push(`Full list with photos: ${pageUrl}`);
  return lines.join('\n');
}

export async function sendReorderEmail({ subject, text, html }, transportFactory = nodemailer.createTransport) {
  const transport = transportFactory({
    service: 'gmail',
    auth: { user: config.gmailUser, pass: config.gmailAppPassword },
  });
  await transport.sendMail({
    from: `Blank Sync <${config.gmailUser}>`,
    to: config.alertEmailTo,
    subject,
    text,
    html,
  });
}
