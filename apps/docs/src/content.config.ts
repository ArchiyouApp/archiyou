/**
 * The docs site reads its pages from help/ at the repository root, the same markdown
 * the editor's help panel plays (tour, tutorials), so there is one copy of every page.
 * How help/ paths become Starlight page ids: src/help.ts. A page missing in a language
 * falls back to English, with Starlight's notice.
 */

import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

import { helpId } from './help';

export const collections = {
  docs: defineCollection({
    loader: glob({
      base: '../../help',
      pattern: '*/*/**/*.md',
      generateId: ({ entry }) => helpId(entry),
    }),
    // Starlight's frontmatter, plus what the help panel uses (`order` also sorts the
    // sidebar, see helpSidebar())
    schema: docsSchema({
      extend: z.object({
        tags: z.string().optional(),
        thumbnail: z.string().optional(),
        order: z.number().optional(),
      }),
    }),
  }),
};
