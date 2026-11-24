/**
 * Signals — what goes wrong anywhere in Archiyou (and a few things that go right, to have rates),
 * as one small message. The server routes every signal by its type
 * (apps/server/src/signals/rules.ts): to Umami, to its own `signals` table (the admin's Signals
 * section and the daily report read that), and/or straight to the team by email.
 *
 * Browsers send only the CLIENT_SIGNAL_TYPES, through POST /signals
 * (apps/editor/src/services/signals.ts). `user` is never taken from what a browser sends: the
 * server sets it from the caller's token.
 */

export const CLIENT_SIGNAL_TYPES = [
  /** A published configurator showed its first model (for the failure rate, Umami only). */
  'configurator.view',
  /** A run of a published configurator failed. */
  'run.failed',
  /** Making an output in the browser failed: a fulfillment, a project's files. */
  'output.failed',
  /** An uncaught error or rejection in the app itself. */
  'app.crashed',
  /** The server refused a run, so the browser made the model itself. */
  'execution.fallback',
] as const;

export const SERVER_SIGNAL_TYPES = [
  /** A route failed in a way no handler expected (a 500). */
  'api.error',
  /** A server run got no result: the job failed, timed out or the worker died during it. */
  'execution.failed',
  /** The execution pipeline (Redis/BullMQ) could not start. */
  'execution.unavailable',
  /** No execution worker is listening while server runs are switched on. */
  'worker.down',
  /** A fulfillment asked for by email could not be made or sent. */
  'fulfillment.failed',
  /** Mailgun refused or could not be reached. */
  'email.failed',
  /** A background translation of a configurator failed. */
  'translation.failed',
  /** Housekeeping failed (purging old rows). */
  'maintenance.failed',
  /** The daily report went out: stored to make sure it goes out once. */
  'report.sent',
] as const;

export const SIGNAL_TYPES = [...CLIENT_SIGNAL_TYPES, ...SERVER_SIGNAL_TYPES] as const;

export type ClientSignalType = typeof CLIENT_SIGNAL_TYPES[number];
export type SignalType = typeof SIGNAL_TYPES[number];

export const SIGNAL_SOURCES = ['configurator', 'editor', 'api', 'worker'] as const;
export type SignalSource = typeof SIGNAL_SOURCES[number];

export const SIGNAL_SEVERITIES = ['info', 'warn', 'error', 'critical'] as const;
export type SignalSeverity = typeof SIGNAL_SEVERITIES[number];

/** Longest values kept; longer ones are cut, not refused. */
export const SIGNAL_LIMITS = {
  message: 300,
  script: 200,
  query: 500,
  url: 500,
  dataKeys: 10,
  dataValue: 200,
  /** Signals in one POST /signals. */
  batch: 10,
  /** Signals one page sends in its whole life. */
  perPage: 10,
} as const;

/** The error itself out of a Runner's formatted message ('**** EXECUTION ERROR ****', see
 *  packages/core/src/runner/Runner.ts), which also quotes lines of the script around it: the
 *  script's code is the author's and is never sent along. */
export function errorOnly(message: string | undefined): string | undefined
{
  if (!message?.includes('EXECUTION ERROR')) return message;
  const match = message.match(/- error: '([\s\S]*?)'\s*(\n- line:|\n- context:|$)/);
  return match ? match[1].trim() : message.split('- context:')[0].replace(/\*{4} EXECUTION ERROR \*{4}/, '').trim();
}

export interface Signal
{
  type: SignalType;
  source: SignalSource;
  message?: string;
  /** 'author/name:version' */
  script?: string;
  /** The script version's id (Script.id). */
  scriptVersionId?: string;
  /** Line in the script, for a run that failed. */
  line?: number;
  /** The configuration as a link query ('WIDTH=900&ROOF=flat'), to make it again. */
  query?: string;
  /** The page it happened on (path and query, no host needed). */
  url?: string;
  /** Version of the app (editor) or server that sent it. */
  appVersion?: string;
  /** A few short facts more; never the script's code, never personal data. */
  data?: Record<string, string | number | boolean>;
  /** Handle of the signed-in user. Set by the server only. */
  user?: string;
}

/** What a browser sends: a client type, and never a user. */
export type ClientSignal = Omit<Signal, 'type' | 'source' | 'user'> & {
  type: ClientSignalType;
  source: 'configurator' | 'editor';
};

//// ADMIN ////

export const SIGNAL_RANGES = ['today', '7d', '30d', '90d'] as const;
export type SignalRange = typeof SIGNAL_RANGES[number];

export const SIGNAL_SORTS = ['last', 'count', 'first'] as const;
export type SignalSort = typeof SIGNAL_SORTS[number];

/** The details of one occurrence, kept to make a problem again. */
export interface SignalSample
{
  scriptVersionId?: string;
  line?: number;
  query?: string;
  url?: string;
  appVersion?: string;
  data?: Record<string, string | number | boolean>;
}

/** One problem (one fingerprint) over the chosen range, as the admin's Signals table shows it. */
export interface AdminSignal
{
  fingerprint: string;
  type: SignalType;
  source: SignalSource;
  severity: SignalSeverity;
  script: string | null;
  message: string | null;
  count: number;
  /** Signed-in users it happened to (at most 20 a day are kept). */
  users: string[];
  firstSeen: string;
  lastSeen: string;
  /** First seen inside the range: it did not happen before. */
  isNew: boolean;
  /** The latest occurrence's details. */
  sample: SignalSample;
}

export interface AdminSignalList
{
  items: AdminSignal[];
  /** Problems matching the filter (for paging). */
  total: number;
  /** Occurrences per severity in the range, before the severity/type/source filters. */
  counts: Record<SignalSeverity, number>;
  /** The types that occur in the range, to offer in the filter. */
  types: SignalType[];
}
