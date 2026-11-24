/**
 * report.ts — the daily email to the team about yesterday (UTC): problems seen for the first
 * time, the ones that keep coming back, totals, how often published configurators failed per
 * view (from Umami, when an API key is set) and whether the signals themselves arrived.
 *
 * It goes out every day, also when nothing happened: that mail is the proof that the monitoring
 * itself still works. Exactly once per day, whichever process or restart gets there first: the
 * right to send it is a row (SignalStore.claimReport).
 *
 * The bus checks every hour and sends once the hour has passed config.signals.reportHourUtc.
 * `pnpm admin:signals report` prints or sends one by hand.
 */

import type { SignalSeverity, SignalSource } from '@archiyou/types';

import { config } from '../config';
import { emailService } from '../services/EmailService';

import { alertStats } from './alerts';
import { busStats, flushSignals } from './bus';
import { addDays, signalStore, utcDay, type SignalDayRow } from './SignalStore';
import { eventValues, umamiStats } from './umami';

const LIST_MAX = 15;

export interface ConfiguratorRate
{
  script: string;
  views: number;
  errors: number;
}

export interface DailyReport
{
  day: string;
  rows: SignalDayRow[];
  fresh: SignalDayRow[];
  recurring: SignalDayRow[];
  total: number;
  bySeverity: Partial<Record<SignalSeverity, number>>;
  bySource: Partial<Record<SignalSource, number>>;
  /** Null when Umami cannot be asked. */
  rates: ConfiguratorRate[] | null;
  health: {
    received: number; dropped: number; storeFailed: number;
    umamiSent: number; umamiFailed: number; umamiDropped: number;
    alertsSent: number; alertsSuppressed: number;
  };
}

export type ReportOutcome = 'sent' | 'not-yet' | 'already-sent';

/** Send the report on yesterday, if it is time and nobody sent it yet. */
export async function sendDailyReport(now = new Date()): Promise<ReportOutcome>
{
  if (now.getUTCHours() < config.signals.reportHourUtc) return 'not-yet';
  const day = addDays(utcDay(now), -1);
  await flushSignals();
  if (!(await signalStore.claimReport(day))) return 'already-sent';
  try
  {
    const report = await buildReport(day);
    await emailService.sendTeamReport(renderReport(report));
    resetHealth();
    return 'sent';
  }
  catch (err)
  {
    // Not sent: give the day back, so the next hourly check tries again.
    await signalStore.releaseReport(day).catch(() => undefined);
    throw err;
  }
}

export async function buildReport(day: string): Promise<DailyReport>
{
  const rows = await signalStore.day(day);
  const sum = <K extends string>(key: (r: SignalDayRow) => K) => rows.reduce<Partial<Record<K, number>>>((all, r) =>
  {
    all[key(r)] = (all[key(r)] ?? 0) + r.count;
    return all;
  }, {});

  return {
    day,
    rows,
    fresh: rows.filter((r) => r.isNew),
    recurring: rows.filter((r) => !r.isNew).sort((a, b) => b.count - a.count),
    total: rows.reduce((n, r) => n + r.count, 0),
    bySeverity: sum((r) => r.severity),
    bySource: sum((r) => r.source),
    rates: await configuratorRates(day),
    health: {
      received: busStats.received,
      dropped: busStats.dropped + busStats.unknown + busStats.failed,
      storeFailed: busStats.storeFailed,
      umamiSent: umamiStats.sent,
      umamiFailed: umamiStats.failed,
      umamiDropped: umamiStats.dropped,
      alertsSent: alertStats.sent,
      alertsSuppressed: alertStats.suppressed,
    },
  };
}

/** Views and failed runs per published configurator on `day`, worst share first. */
async function configuratorRates(day: string): Promise<ConfiguratorRate[] | null>
{
  const start = new Date(`${day}T00:00:00Z`);
  const end = new Date(Date.parse(`${addDays(day, 1)}T00:00:00Z`) - 1);
  const [views, errors] = await Promise.all([
    eventValues('configurator-view', 'script', start, end),
    eventValues('configurator-error', 'script', start, end),
  ]);
  if (!views || !errors) return null;
  return [...errors.entries()]
    .map(([script, n]) => ({ script, views: views.get(script) ?? 0, errors: n }))
    .sort((a, b) => share(b) - share(a) || b.errors - a.errors);
}

const share = (r: ConfiguratorRate) => (r.views ? r.errors / r.views : Infinity);

function resetHealth(): void
{
  busStats.received = 0;
  busStats.dropped = 0;
  busStats.unknown = 0;
  busStats.failed = 0;
  busStats.storeFailed = 0;
  umamiStats.sent = 0;
  umamiStats.failed = 0;
  umamiStats.dropped = 0;
  alertStats.sent = 0;
  alertStats.suppressed = 0;
}

//// RENDERING ////

export function reportSubject(r: DailyReport): string
{
  if (r.total === 0) return `Archiyou signals ${r.day}: all quiet`;
  const fresh = r.fresh.length ? `${r.fresh.length} new problem${r.fresh.length === 1 ? '' : 's'}, ` : '';
  return `Archiyou signals ${r.day}: ${fresh}${r.total} occurrence${r.total === 1 ? '' : 's'}`;
}

function rowLine(r: SignalDayRow): string
{
  const where = r.script ? ` in ${r.script}` : '';
  const users = r.users.length ? ` (users: ${r.users.join(', ')}${r.users.length >= 20 ? ', …' : ''})` : '';
  return `${r.count}× [${r.severity}] ${r.type}${where}: ${r.message ?? ''}${users}`;
}

function healthLines(r: DailyReport): string[]
{
  const h = r.health;
  return [
    `${h.received} signals received since the last report`,
    h.dropped ? `${h.dropped} dropped (unknown, too many at once)` : '',
    h.storeFailed ? `${h.storeFailed} could not be stored` : '',
    `Umami: ${h.umamiSent} sent${h.umamiFailed ? `, ${h.umamiFailed} failed` : ''}${h.umamiDropped ? `, ${h.umamiDropped} dropped` : ''}`,
    `Alerts: ${h.alertsSent} sent${h.alertsSuppressed ? `, ${h.alertsSuppressed} held back by the hourly limit` : ''}`,
  ].filter(Boolean);
}

function rateLine(r: ConfiguratorRate): string
{
  const pct = r.views ? `${Math.round((r.errors / r.views) * 100)}%` : 'no views';
  return `${r.script}: ${r.errors} failed runs, ${r.views} views (${pct})`;
}

export function renderReport(r: DailyReport): { subject: string; text: string; html: string }
{
  const subject = reportSubject(r);
  const link = `${config.frontendUrl.replace(/\/$/, '')}/admin/signals?range=7d`;
  const totals = Object.entries(r.bySource).map(([k, n]) => `${k} ${n}`).join(', ');
  const sections: Array<[string, string[]]> = [
    ['New problems', r.fresh.slice(0, LIST_MAX).map(rowLine)],
    ['Coming back', r.recurring.slice(0, LIST_MAX).map(rowLine)],
    ['Configurators that failed', r.rates ? r.rates.slice(0, LIST_MAX).map(rateLine) : ['(Umami not configured with an API key)']],
    ['Totals', r.total ? [`${r.total} occurrences of ${r.rows.length} problems; by source: ${totals}`] : ['Nothing went wrong.']],
    ['Monitoring', healthLines(r)],
  ];
  const visible = sections.filter(([, lines]) => lines.length > 0);

  const text = [
    ...visible.flatMap(([title, lines]) => [`${title}:`, ...lines.map((l) => `  ${l}`)]),
    `All signals: ${link}`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(subject)}</title></head>
<body style="font-family:Verdana,Geneva,Tahoma,sans-serif;color:#222;max-width:760px;margin:1em auto;padding:0 1em">
<h1 style="font-weight:normal;font-size:1.4em">${esc(subject)}</h1>
${visible.map(([title, lines]) => `<h2 style="font-size:1.05em;margin:1.4em 0 0.4em">${esc(title)}</h2>
<ul style="margin:0;padding-left:1.2em">${lines.map((l) => `<li style="margin:0.2em 0">${esc(l)}</li>`).join('')}</ul>`).join('\n')}
<p style="margin-top:2em"><a href="${esc(link)}">All signals in the admin</a></p>
</body></html>`;

  return { subject, text, html };
}

function esc(s: string): string
{
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
