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

  /** Low-level send. Never throws to callers — a failed/absent send must not leak
   *  whether an account exists (forgot-password always answers 200). */
  private async send({ to, subject, html, devNote }: Message): Promise<void> {
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
      form.set('h:Reply-To', REPLY_TO);

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
}

/** Minimal HTML email (inline styles for mail-client compatibility), ported from
 *  aypy/templates/mailer/archiyou.html: dark header + logo, white rounded card,
 *  CTA button, grey footer. */
function renderEmail({ subject, text, buttonText, buttonLink }: EmailContent): string {
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
        <a href="${escapeAttr(buttonLink)}" style="text-decoration:none;">
          <div style="margin:1.5em auto;text-align:center;font-size:1.2em;background:#f10827;width:220px;color:white;padding:1em;border-radius:0.5em;">
            ${escapeHtml(buttonText)}
          </div>
        </a>
        <p style="color:#999;font-size:0.85em;">If the button doesn’t work, copy this link into your browser:<br>
          <a href="${escapeAttr(buttonLink)}" style="color:#103eaa;word-break:break-all;">${escapeHtml(buttonLink)}</a>
        </p>
        <div style="color:#999;">
          <p>All the best,</p>
          <p>- The Archiyou team</p>
        </div>
      </div>
    </div>
    <div style="background:rgb(189,189,189);font-size:0.8em;padding:1em 4em 1em 2em;color:white;margin-top:3em;font-family:Verdana,Geneva,Tahoma,sans-serif;">
      <p>This email was sent automatically — you can reach us by replying to it. We value your privacy and won’t share your data. See our
        <a href="https://archiyou.com/privacy" style="color:white;font-weight:bold;text-decoration:none;">Privacy Statement</a>.</p>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
