/**
 * rules.ts — where each type of signal goes. This table IS the routing: adding a type means
 * adding it to @archiyou/types (signals.ts) and giving it a line here, which the compiler
 * enforces.
 *
 *   severity  how bad it is (the admin's filter, the report's order)
 *   store     counted in the `signals` table: the admin's Signals section and the daily report
 *   umami     the Umami event name it is sent as, or nothing. Never carries the user.
 *   alert     email the team. `repeatAfterMinutes: null` only the first time this problem is
 *             seen (until its rows are purged); a number, again once that long has passed.
 *
 * Errors of a script while its author is editing it are never signalled: that is work, not a
 * problem.
 */

import type { SignalSeverity, SignalType } from '@archiyou/types';

export interface SignalRule
{
  severity: SignalSeverity;
  store: boolean;
  umami?: string;
  alert?: { repeatAfterMinutes: number | null };
}

export const RULES: Record<SignalType, SignalRule> = {
  // From browsers (POST /signals)
  'configurator.view':     { severity: 'info',     store: false, umami: 'configurator-view' },
  'run.failed':            { severity: 'error',    store: true,  umami: 'configurator-error' },
  'output.failed':         { severity: 'error',    store: true,  umami: 'output-error' },
  'app.crashed':           { severity: 'error',    store: true },
  'execution.fallback':    { severity: 'warn',     store: true },

  // From the server itself
  'api.error':             { severity: 'error',    store: true,  alert: { repeatAfterMinutes: null } },
  'execution.failed':      { severity: 'error',    store: true,  umami: 'execution-error' },
  'execution.unavailable': { severity: 'critical', store: true,  alert: { repeatAfterMinutes: 60 } },
  'worker.down':           { severity: 'critical', store: true,  alert: { repeatAfterMinutes: 60 } },
  'fulfillment.failed':    { severity: 'error',    store: true,  umami: 'fulfillment-error', alert: { repeatAfterMinutes: null } },
  // Never an alert: alerts are emails, and email is what failed.
  'email.failed':          { severity: 'error',    store: true },
  'translation.failed':    { severity: 'warn',     store: true },
  'maintenance.failed':    { severity: 'warn',     store: true },
  // Written by the report itself (SignalStore.claimReport), not through the bus.
  'report.sent':           { severity: 'info',     store: false },
};
