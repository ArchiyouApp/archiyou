/**
 * alerts.ts — email the team about a problem the moment it is stored, when its rule asks for
 * that (rules.ts `alert`). Two brakes:
 *
 *   per problem  the last alert is a column of the problem's row (`alerted_at`), so a restart
 *                does not send it again. `repeatAfterMinutes: null` alerts once per problem.
 *   overall      at most config.signals.alertMaxPerHour alerts an hour; the rest are counted
 *                and named in the daily report, and alert again with their next occurrence.
 */

import { config } from '../config';
import { emailService } from '../services/EmailService';

import type { SignalRule } from './rules';
import { signalStore, type SignalOccurrence } from './SignalStore';

const HOUR_MS = 60 * 60 * 1000;

export const alertStats = { sent: 0, suppressed: 0 };

/** When each alert of the last hour went out. */
let recent: number[] = [];

export async function considerAlert(o: SignalOccurrence, rule: SignalRule, now = Date.now()): Promise<boolean>
{
  if (!rule.alert) return false;

  const last = await signalStore.lastAlerted(o.fingerprint);
  const repeat = rule.alert.repeatAfterMinutes;
  if (last && (repeat === null || now - last.getTime() < repeat * 60 * 1000)) return false;

  recent = recent.filter((at) => now - at < HOUR_MS);
  if (recent.length >= config.signals.alertMaxPerHour)
  {
    alertStats.suppressed++;
    return false;
  }

  // Marked before it is sent, so two flushes that race send it once.
  await signalStore.markAlerted(o.fingerprint, o.day, new Date(now));
  recent.push(now);
  alertStats.sent++;
  await emailService.sendTeamAlert(alertMail(o, rule));
  return true;
}

export function alertMail(o: SignalOccurrence, rule: SignalRule): Parameters<typeof emailService.sendTeamAlert>[0]
{
  const where = o.script ? ` in ${o.script}` : '';
  return {
    subject: `${rule.severity === 'critical' ? 'Critical' : 'Problem'}: ${o.type}${where}`,
    text: o.message || o.type,
    details: [
      ['Type', `${o.type} (${o.severity}, from ${o.source})`],
      ['Script', o.script],
      ['Times', o.count > 1 ? `${o.count} since the last check` : null],
      ['Users', o.users.length ? o.users.join(', ') : null],
      ['Line', o.sample.line !== undefined ? String(o.sample.line) : null],
      ['Configuration', o.sample.query],
      ['Page', o.sample.url],
      ['Version', o.sample.appVersion],
      ...Object.entries(o.sample.data ?? {}).map(([k, v]) => [k, String(v)] as [string, string]),
    ],
    link: `${config.frontendUrl.replace(/\/$/, '')}/admin/signals?range=today&type=${encodeURIComponent(o.type)}`,
  };
}

/** Forget the hourly brake (tests). */
export function resetAlerts(): void
{
  recent = [];
  alertStats.sent = 0;
  alertStats.suppressed = 0;
}
