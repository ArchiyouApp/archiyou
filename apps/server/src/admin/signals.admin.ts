/**
 * signals — look at the signals table and try the team's mails by hand (src/signals).
 *
 * Usage (from apps/server):
 *   pnpm admin:signals list [--range today|7d|30d|90d]   the problems, most recent first
 *   pnpm admin:signals report [--day YYYY-MM-DD] [--send] the daily report on a day (yesterday
 *                                                         by default); printed, or sent to
 *                                                         SERVER_SIGNALS_EMAIL with --send
 *   pnpm admin:signals alert-test                         send one test alert
 *
 * `report --send` does not count as the day's report: the automatic one still goes out.
 *
 * Exit codes: 0 done, 2 usage error.
 */

import '../env';

import { SIGNAL_RANGES, type SignalRange } from '@archiyou/types';

import { config } from '../config';
import { closeDb } from '../db/client';
import { emailService } from '../services/EmailService';
import { buildReport, renderReport } from '../signals/report';
import { addDays, signalStore, utcDay } from '../signals/SignalStore';

function argValue(flag: string): string | undefined
{
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

function usage(message?: string): never
{
  if (message) console.error(`\n✗ ${message}`);
  console.error(`
Usage:
  pnpm admin:signals list [--range today|7d|30d|90d]
  pnpm admin:signals report [--day YYYY-MM-DD] [--send]
  pnpm admin:signals alert-test
`);
  process.exit(2);
}

async function list(): Promise<void>
{
  const range = (argValue('--range') ?? '7d') as SignalRange;
  if (!SIGNAL_RANGES.includes(range)) usage(`Unknown range '${range}'`);
  const { items, total, counts } = await signalStore.list({ range, limit: 200 });
  console.log(`${total} problem(s) in ${range}; occurrences by severity: ${JSON.stringify(counts)}\n`);
  items.forEach((s) =>
  {
    const users = s.users.length ? `  users: ${s.users.join(', ')}` : '';
    console.log(`${s.isNew ? 'NEW ' : '    '}${String(s.count).padStart(5)}×  [${s.severity}] ${s.type}${s.script ? `  ${s.script}` : ''}`);
    console.log(`           ${s.message ?? ''}${users}`);
    console.log(`           last ${s.lastSeen}, first ${s.firstSeen}`);
  });
}

async function report(): Promise<void>
{
  const day = argValue('--day') ?? addDays(utcDay(), -1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) usage(`'${day}' is not a day (YYYY-MM-DD)`);
  const rendered = renderReport(await buildReport(day));
  if (process.argv.includes('--send'))
  {
    if (!config.signals.to.length) usage('SERVER_SIGNALS_EMAIL is not set: there is nobody to send it to.');
    await emailService.sendTeamReport(rendered);
    console.log(`Sent "${rendered.subject}" to ${config.signals.to.join(', ')}.`);
    return;
  }
  console.log(`${rendered.subject}\n\n${rendered.text}`);
}

async function alertTest(): Promise<void>
{
  await emailService.sendTeamAlert({
    subject: 'Test alert from Archiyou signals',
    text: 'If this reached you, alerts reach the team.',
    details: [['Sent by', 'pnpm admin:signals alert-test'], ['To', config.signals.to.join(', ') || '(the console)']],
    link: `${config.frontendUrl.replace(/\/$/, '')}/admin/signals`,
  });
  if (config.signals.to.length) console.log(`Sent a test alert to ${config.signals.to.join(', ')}.`);
}

async function main(): Promise<void>
{
  const command = process.argv[2];
  if (command === 'list') await list();
  else if (command === 'report') await report();
  else if (command === 'alert-test') await alertTest();
  else usage(command ? `Unknown command '${command}'` : undefined);
}

main()
  .catch((err) =>
  {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
