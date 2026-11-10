/**
 * Configurators — the wire shapes of a published configurator's fulfillment requests
 * (POST /fulfillments, apps/server/src/routes/fulfillments.ts) and of its author's view on
 * what happened around it (GET /scripts/configurators/:versionId/events).
 */

/** What a configurator's events list: orders and adjustments (which also live in a
 *  project) and fulfillments handed over. */
export const CONFIGURATOR_EVENT_TYPES = [
  'order.received',
  'adjust.requested',
  'fulfillment.emailed',
  'fulfillment.unlocked',
  'fulfillment.downloaded',
  'fulfillment.failed',
] as const;
export type ConfiguratorEventType = typeof CONFIGURATOR_EVENT_TYPES[number];

/** The filter chips of the events view. */
export type ConfiguratorEventFilter = 'all' | 'orders' | 'fulfillments' | 'failed';

export interface ConfiguratorEvent
{
  id: string;
  type: ConfiguratorEventType;
  /** ISO */
  created: string;
  /** The configurator version it came from ('1.2.0'), null when that version is gone. */
  version: string | null;
  /** The fulfillment's name (orders: the product). */
  fulfillment: string | null;
  /** The access rule it went past: 'email', 'signed-in' … ; null for orders and free downloads. */
  access: string | null;
  /** Who: an email address, an @handle or a client's name; null for an anonymous download. */
  who: string | null;
  /** Orders and adjustments: the project they landed in. */
  project: { id: string; label: string; title: string } | null;
  /** Why a fulfillment failed (fulfillment.failed). */
  reason: string | null;
}

export interface ConfiguratorEventCounts
{
  orders: number;
  emailed: number;
  unlocked: number;
  downloads: number;
  failed: number;
}

export interface ConfiguratorEventList
{
  events: ConfiguratorEvent[];
  /** The last 30 days, over the same versions. */
  counts: ConfiguratorEventCounts;
  /** Pass as `before` for the next page; null when there is none. */
  next: string | null;
}

/** POST /fulfillments: how a gated fulfillment is handed over. `queued`: the files go out
 *  by email; `granted`: the browser may make them now. */
export type FulfillmentGrant = { queued: true } | { granted: true };
