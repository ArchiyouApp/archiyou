/**
 * EmailService — transactional email via Mailgun.
 *
 * Ported from the legacy Python Mailer (aypy/backend/Mailer.py): EU region,
 * HTTP Basic auth `api:<key>`, `from` + `h:Reply-To` headers, multipart POST.
 * Uses Node's global `fetch` + `FormData` — no extra dependency.
 *
 * Dev fallback: when `config.mailgun.key` is empty the message is logged to the
 * console (including the reset link) instead of being sent, so the whole
 * password-reset flow is testable locally without Mailgun credentials.
 */

import { config } from '../config';

const REPLY_TO = 'info@archiyou.com';

interface Message {
  to: string;
  subject: string;
  html: string;
  /** Who a reply goes to; Archiyou's own address when unset. */
  replyTo?: string;
  /** Extra context logged in the dev (no-key) fallback, e.g. the reset link. */
  devNote?: string;
}

export class EmailService {
  /** Send a "reset your password" email with a CTA linking to `link`. */
  async sendPasswordReset(to: string, link: string): Promise<void> {
    await this.send({
      to,
      subject: 'Reset your Archiyou password',
      html: renderEmail({
        subject: 'Forgot your password? No problem!',
        text: 'Click the button below to set a new password. This link expires in 1 hour. If you didn’t request this, you can safely ignore this email.',
        buttonText: 'Reset your password',
        buttonLink: link,
      }),
      devNote: `reset link: ${link}`,
    });
  }

  /** Send a "confirm your email address" email with a CTA linking to `link`. */
  async sendEmailVerification(to: string, link: string): Promise<void> {
    await this.send({
      to,
      subject: 'Confirm your Archiyou email address',
      html: renderEmail({
        subject: 'Welcome to Archiyou!',
        text: 'Please confirm your email address to finish setting up your account. This link expires in 24 hours. Until it is confirmed you can still use the editor, but you will not be able to publish or share scripts.',
        buttonText: 'Confirm your email',
        buttonLink: link,
      }),
      devNote: `verification link: ${link}`,
    });
  }

  /** A visitor ordered a product from one of the author's configurators: it is a request
   *  in their Projects now. Replies go to the visitor. */
  async sendOrderReceived(to: string, order: {
    product: string;
    configurator: string;
    clientName: string | null;
    clientEmail: string;
    clientPhone: string | null;
    message: string | null;
    link: string;
  }): Promise<void> {
    const who = order.clientName || order.clientEmail;
    await this.send({
      to,
      replyTo: order.clientEmail,
      subject: `New order: ${order.product} from ${who}`,
      html: renderEmail({
        subject: `New order from ${who}`,
        text: `${who} ordered "${order.product}" from your configurator ${order.configurator}. `
          + 'The configuration and their details are in your projects as a request. Reply to this email to answer them.',
        details: [
          ['Name', order.clientName],
          ['Email', order.clientEmail],
          ['Phone', order.clientPhone],
        ],
        quote: order.message,
        buttonText: 'Open the request',
        buttonLink: order.link,
      }),
      devNote: `request: ${order.link}`,
    });
  }

  /** A professional's delivery to their client: the link to its page. From Archiyou, but
   *  replies go to the professional, and the footer says who sent it and where to report
   *  mail nobody asked for — every verified user can send these. */
  async sendDelivery(to: string, delivery: {
    professionalName: string;
    professionalEmail: string;
    recipientName: string | null;
    title: string;
    message: string | null;
    offer: { total: number; currency: string; validUntil?: string | null } | null;
    link: string;
  }): Promise<void> {
    const { professionalName: from, offer } = delivery;
    const what = offer ? 'an offer' : 'a design';
    const total = offer ? formatMoney(offer.total, offer.currency) : null;
    await this.send({
      to,
      replyTo: delivery.professionalEmail,
      subject: `${from} sent you ${what}: ${delivery.title}`,
      html: renderEmail({
        subject: delivery.title,
        text: `${delivery.recipientName ? `Hello ${delivery.recipientName}, ` : ''}${from} sent you ${what}. `
          + 'Open it to look at the design in 3D and at the documents that come with it.',
        quote: delivery.message,
        details: offer ? [['Total', total], ['Valid until', offer.validUntil ?? null]] : [],
        buttonText: offer ? 'View the offer' : 'View the design',
        buttonLink: delivery.link,
        footerNote: `Sent by ${from} (${delivery.professionalEmail}) with Archiyou. Reply to this email to reach them. `
          + 'Not expecting this? Let us know at info@archiyou.com.',
        signature: ['Kind regards,', from],
      }),
      devNote: `delivery: ${delivery.link}`,
    });
  }

  /** The client answered a delivery: accepted, declined, or asked for changes. */
  async sendClientResponse(to: string, answer: {
    clientName: string;
    title: string;
    response: 'accepted' | 'declined' | 'changes';
    note: string | null;
    link: string;
  }): Promise<void> {
    const said = { accepted: 'accepted', declined: 'declined', changes: 'asks for changes to' }[answer.response];
    const subject = { accepted: 'Accepted', declined: 'Declined', changes: 'Changes requested' }[answer.response];
    await this.send({
      to,
      subject: `${subject}: ${answer.title}`,
      html: renderEmail({
        subject: `${answer.clientName} ${said} ${answer.title}`,
        text: `${answer.clientName} ${said} "${answer.title}".`,
        quote: answer.note,
        buttonText: 'Open the project',
        buttonLink: answer.link,
      }),
      devNote: `project: ${answer.link}`,
    });
  }

  /** The client adjusted a delivered design in the configurator and sent the changes. */
  async sendAdjustRequested(to: string, adjustment: {
    clientName: string;
    project: string;
    rev: number;
    changed: string[];
    message: string | null;
    link: string;
  }): Promise<void> {
    await this.send({
      to,
      subject: `${adjustment.clientName} sent changes to ${adjustment.project}`,
      html: renderEmail({
        subject: `Changes from ${adjustment.clientName}`,
        text: `${adjustment.clientName} adjusted the design you sent and sent it back. It is v${adjustment.rev} in ${adjustment.project}.`,
        details: [['Changed', adjustment.changed.join(', ') || 'nothing (sent as it was)']],
        quote: adjustment.message,
        buttonText: 'Open the project',
        buttonLink: adjustment.link,
      }),
      devNote: `project: ${adjustment.link}`,
    });
  }

  /** Low-level send. Never throws to callers — a failed/absent send must not leak
   *  whether an account exists (forgot-password always answers 200). */
  private async send({ to, subject, html, replyTo, devNote }: Message): Promise<void> {
    if (!config.mailgun.key) {
      console.log(
        `📧 [EmailService] MAILGUN_KEY not set — not sending. ` +
          `to="${to}" subject="${subject}"${devNote ? `\n   ${devNote}` : ''}`,
      );
      return;
    }

    try {
      const form = new FormData();
      form.set('from', config.mailgun.from);
      form.set('to', to);
      form.set('subject', subject);
      form.set('html', html);
      form.set('h:Reply-To', replyTo ?? REPLY_TO);

      const auth = 'Basic ' + Buffer.from(`api:${config.mailgun.key}`).toString('base64');
      const url = `${config.mailgun.apiBase}/v3/${config.mailgun.domain}/messages`;
      const res = await fetch(url, { method: 'POST', headers: { Authorization: auth }, body: form });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`📧 [EmailService] Mailgun send failed (${res.status}) to="${to}": ${body}`);
      }
    } catch (err) {
      console.error(`📧 [EmailService] Mailgun send error to="${to}":`, err);
    }
  }
}

export const emailService = new EmailService();

//// TEMPLATE ////

interface EmailContent {
  subject: string;
  text: string;
  buttonText: string;
  buttonLink: string;
  /** Someone's own words (an order message, a professional's note): shown quoted, as
   *  plain text — escaped, line breaks kept, links not made clickable. */
  quote?: string | null;
  /** Labelled facts under the text; rows without a value are left out. */
  details?: Array<[string, string | null | undefined]>;
  /** A last line in the grey footer, before the privacy note. */
  footerNote?: string;
  /** The closing lines; the Archiyou team's by default. */
  signature?: string[];
}

/** Minimal HTML email (inline styles for mail-client compatibility), ported from
 *  aypy/templates/mailer/archiyou.html: dark header + logo, white rounded card,
 *  CTA button, grey footer. */
function renderEmail({ subject, text, buttonText, buttonLink, quote, details, footerNote, signature }: EmailContent): string {
  const rows = (details ?? []).filter(([, value]) => !!value);
  const detailsHtml = rows.length
    ? `<table style="color:#444;margin:1em 0;border-collapse:collapse">${rows.map(([label, value]) =>
      `<tr><td style="color:#999;padding:0.2em 1em 0.2em 0">${escapeHtml(label)}</td><td>${escapeHtml(value as string)}</td></tr>`).join('')}</table>`
    : '';
  const quoteHtml = quote
    ? `<blockquote style="margin:1em 0;padding:0.5em 1em;border-left:3px solid #ccc;color:#444">${escapeHtml(quote).replace(/\n/g, '<br>')}</blockquote>`
    : '';
  const closing = (signature ?? ['All the best,', '- The Archiyou team']).map((line) => `<p>${escapeHtml(line)}</p>`).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Archiyou: ${escapeHtml(subject)}</title></head>
<body style="padding:0;margin:0;background:rgb(228,228,228)">
  <div style="margin:0;padding:0;background:rgb(228,228,228)">
    <div style="margin:0;padding:2em;background:#180c2d">
      <img src="https://cms.archiyou.com/uploads/email_header_740de28746.png" height="50" alt="Archiyou"
           style="display:block;margin-left:auto;margin-right:auto" />
    </div>
    <div style="display:block;padding-top:1em;font-family:Verdana,Geneva,Tahoma,sans-serif;max-width:600px;margin:2em auto 0">
      <div style="display:block;padding:2em;background:white;border-radius:1em;margin:1em">
        <h1 style="text-align:center;font-weight:normal;">${escapeHtml(subject)}</h1>
        <p style="color:#666">${escapeHtml(text)}</p>
        ${detailsHtml}
        ${quoteHtml}
        <a href="${escapeAttr(buttonLink)}" style="text-decoration:none;">
          <div style="margin:1.5em auto;text-align:center;font-size:1.2em;background:#f10827;width:220px;color:white;padding:1em;border-radius:0.5em;">
            ${escapeHtml(buttonText)}
          </div>
        </a>
        <p style="color:#999;font-size:0.85em;">If the button doesn’t work, copy this link into your browser:<br>
          <a href="${escapeAttr(buttonLink)}" style="color:#103eaa;word-break:break-all;">${escapeHtml(buttonLink)}</a>
        </p>
        <div style="color:#999;">
          ${closing}
        </div>
      </div>
    </div>
    <div style="background:rgb(189,189,189);font-size:0.8em;padding:1em 4em 1em 2em;color:white;margin-top:3em;font-family:Verdana,Geneva,Tahoma,sans-serif;">
      ${footerNote ? `<p>${escapeHtml(footerNote)}</p>` : ''}
      <p>This email was sent automatically — you can reach us by replying to it. We value your privacy and won’t share your data. See our
        <a href="https://archiyou.com/privacy" style="color:white;font-weight:bold;text-decoration:none;">Privacy Statement</a>.</p>
    </div>
  </div>
</body>
</html>`;
}

/** "€1,200.00": the amount in its currency. */
function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
