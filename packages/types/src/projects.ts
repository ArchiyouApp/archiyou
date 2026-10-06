/**
 * Projects — the wire shapes of /projects, /clients, /orders and /d/:token
 * (apps/server/src/routes/projects.ts and client.ts), shared by the server and the editor.
 * Dates are ISO strings. See plans/PROJECTS.md.
 *
 * A project belongs to a `professional` (a username handle): whoever runs it, not
 * necessarily the author of the scripts in it.
 */

export const PROJECT_STATUSES = ['request', 'active', 'won', 'lost'] as const;
export type ProjectStatus = typeof PROJECT_STATUSES[number];

/** How a configuration got into its project: a visitor's order, added by the professional
 *  (editor or configurator), or a client's adjustment of a delivered design. */
export type ConfigurationOrigin = 'order' | 'added' | 'adjust';

export type DeliveryStatus = 'draft' | 'sent' | 'revoked';
export type DeliveryResponse = 'accepted' | 'declined' | 'changes';
export type DeliveryFileKind = 'model' | 'document' | 'sheet' | 'preview';

export type ProjectEventActor = 'professional' | 'client';

/** A script snapshot (core ScriptData). Kept loose here so this package does not depend on core. */
export type ScriptSnapshot = Record<string, unknown>;

export interface ClientData
{
  id: string;
  email: string | null;
  name: string | null;
  company: string | null;
  phone: string | null;
  address: string | null;
  note: string | null;
  created: string;
  updated: string;
}

/** The fields a professional (or an order form) supplies for a client. */
export interface ClientInput
{
  email?: string | null;
  name?: string | null;
  company?: string | null;
  phone?: string | null;
  address?: string | null;
  note?: string | null;
}

/** The published configurator a configuration came from, when it was one. */
export interface ConfigurationSource
{
  author: string;
  name: string;
  version: string;
}

export interface ConfigurationData
{
  id: string;
  projectId: string;
  rev: number;
  label: string | null;
  origin: ConfigurationOrigin;
  /** The product fulfillment that was ordered (origin 'order'). */
  fulfillment: string | null;
  /** Script identity, from the snapshot. */
  scriptName: string | null;
  scriptAuthor: string | null;
  sourceFileId: string | null;
  sourceVersionId: string | null;
  /** Set when the snapshot is a published version: it can be opened as a configurator. */
  configurator: ConfigurationSource | null;
  /** The full validated parameter values (uppercase names). */
  values: Record<string, unknown>;
  /** The values that differ from the script's defaults: what makes this configuration. */
  changed: Record<string, unknown>;
  unitSystem: 'metric' | 'imperial' | null;
  lang: string | null;
  thumbnail: string | null;
  /** The visitor's message with an order or an adjustment. */
  message: string | null;
  sourceDeliveryId: string | null;
  created: string;
  /** Only on GET /projects/:id/configurations/:cid. */
  script?: ScriptSnapshot;
}

export interface DeliveryOffer
{
  total: number;
  currency: string;
  /** Information for the client (YYYY-MM-DD). Does not expire the link. */
  validUntil?: string | null;
  note?: string | null;
}

export interface DeliveryFile
{
  name: string;
  kind: DeliveryFileKind;
  bytes: number;
  mime: string;
}

export interface DeliveryData
{
  id: string;
  projectId: string;
  configurationId: string;
  number: number;
  title: string;
  message: string | null;
  offer: DeliveryOffer | null;
  recipientEmail: string | null;
  recipientName: string | null;
  files: DeliveryFile[];
  status: DeliveryStatus;
  allowAdjust: boolean;
  /** The client's link, once sent. */
  link: string | null;
  sentAt: string | null;
  firstOpenedAt: string | null;
  openCount: number;
  downloadCount: number;
  response: DeliveryResponse | null;
  responseNote: string | null;
  responseAt: string | null;
  created: string;
  updated: string;
}

export interface ProjectEvent
{
  id: string;
  type: string;
  actor: ProjectEventActor;
  deliveryId: string | null;
  configurationId: string | null;
  meta: Record<string, unknown> | null;
  created: string;
}

/** A row of the project list. */
export interface ProjectSummary
{
  id: string;
  number: number;
  title: string;
  status: ProjectStatus;
  clientId: string | null;
  clientName: string | null;
  /** The latest configuration's thumbnail. */
  thumbnail: string | null;
  /** The client did something the professional has not looked at yet. */
  unread: boolean;
  archived: boolean;
  created: string;
  updated: string;
}

export interface ProjectData extends ProjectSummary
{
  note: string | null;
  client: ClientData | null;
  configurations: ConfigurationData[];
  deliveries: DeliveryData[];
  events: ProjectEvent[];
}

export type ProjectCounts = Record<ProjectStatus, number>;

export interface ProjectList
{
  data: ProjectSummary[];
  total: number;
  limit: number;
  offset: number;
  counts: ProjectCounts;
}

/** `P-007`: how a project number is shown. */
export function projectLabel(number: number): string
{
  return `P-${String(number).padStart(3, '0')}`;
}
