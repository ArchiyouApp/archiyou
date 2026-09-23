/**
 * FeedbackStore — the `feedback` table: messages visitors send from a configurator's
 * "Give feedback" button, read and moderated by operators on /admin.
 */

import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { uuid4 } from '@archiyou/core/src/utils';

import { db } from '../db/client';
import { feedback, type FeedbackRow } from '../db/schema';

/** Longest message kept. Enforced by the route schema; repeated here as the store's own floor. */
export const FEEDBACK_MAX_LENGTH = 5000;

/** Feedback on the wire (ISO dates). */
export interface FeedbackData {
  id: string;
  message: string;
  scriptId: string | null;
  fileId: string | null;
  scriptAuthor: string | null;
  scriptName: string | null;
  scriptVersion: string | null;
  url: string | null;
  username: string | null;
  starred: boolean;
  created: string;
}

export interface NewFeedback {
  message: string;
  scriptId?: string | null;
  fileId?: string | null;
  scriptAuthor?: string | null;
  scriptName?: string | null;
  scriptVersion?: string | null;
  url?: string | null;
  username?: string | null;
}

export type FeedbackSort = 'newest' | 'oldest' | 'starred' | 'script';

export class FeedbackStoreError extends Error {
  constructor(public readonly code: 'not_found', message: string) {
    super(message);
  }
}

function rowToData(row: FeedbackRow): FeedbackData {
  return {
    id: row.id,
    message: row.message,
    scriptId: row.scriptId,
    fileId: row.fileId,
    scriptAuthor: row.scriptAuthor,
    scriptName: row.scriptName,
    scriptVersion: row.scriptVersion,
    url: row.url,
    username: row.username,
    starred: row.starred,
    created: row.created.toISOString(),
  };
}

export class FeedbackStore {
  async create(input: NewFeedback): Promise<FeedbackData> {
    const row = db.insert(feedback).values({
      id: uuid4(),
      message: input.message.trim().slice(0, FEEDBACK_MAX_LENGTH),
      scriptId: input.scriptId ?? null,
      fileId: input.fileId ?? null,
      scriptAuthor: input.scriptAuthor?.toLowerCase() ?? null,
      scriptName: input.scriptName ?? null,
      scriptVersion: input.scriptVersion ?? null,
      url: input.url ?? null,
      username: input.username ?? null,
      // Explicit: the column default, unixepoch() * 1000, only has whole seconds.
      created: new Date(),
    }).returning().get();
    return rowToData(row);
  }

  async list(opts: { q?: string; starred?: boolean; sort?: FeedbackSort; limit?: number; offset?: number } = {}):
    Promise<{ total: number; items: FeedbackData[] }> {
    const filters = [];
    if (opts.starred !== undefined) filters.push(eq(feedback.starred, opts.starred));
    if (opts.q) {
      const like = `%${opts.q.toLowerCase()}%`;
      filters.push(sql`(lower(${feedback.message}) LIKE ${like}
        OR lower(coalesce(${feedback.scriptName}, '')) LIKE ${like}
        OR lower(coalesce(${feedback.scriptAuthor}, '')) LIKE ${like}
        OR lower(coalesce(${feedback.username}, '')) LIKE ${like})`);
    }
    const where = filters.length ? and(...filters) : undefined;

    const total = db.select({ n: sql<number>`count(*)` }).from(feedback).where(where).get()?.n ?? 0;

    const order =
      opts.sort === 'oldest' ? [asc(feedback.created)] :
      opts.sort === 'starred' ? [desc(feedback.starred), desc(feedback.created)] :
      opts.sort === 'script' ? [asc(feedback.scriptAuthor), asc(feedback.scriptName), desc(feedback.created)] :
      [desc(feedback.created)];

    const items = db.select().from(feedback).where(where)
      .orderBy(...order, asc(feedback.id))
      .limit(opts.limit ?? 50)
      .offset(opts.offset ?? 0)
      .all()
      .map(rowToData);
    return { total, items };
  }

  async setStarred(id: string, starred: boolean): Promise<FeedbackData> {
    const row = db.update(feedback).set({ starred }).where(eq(feedback.id, id)).returning().get();
    if (!row) throw new FeedbackStoreError('not_found', `Feedback ${id} not found`);
    return rowToData(row);
  }

  async delete(id: string): Promise<void> {
    const res = db.delete(feedback).where(eq(feedback.id, id)).run();
    if (res.changes === 0) throw new FeedbackStoreError('not_found', `Feedback ${id} not found`);
  }
}

export const feedbackStore = new FeedbackStore();
