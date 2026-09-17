# Configurator feedback: storage, admin overview and admin link

| | |
|---|---|
| Dates | 2026-09-14 |
| Model | Claude Opus 5 (claude-opus-5), 1M context, Claude Code agent |
| Tool | Claude Code as agent, without plan mode: a direct request implemented from the prompt, reported back and tested by the human |
| Human | Mark van der Net: wrote the prompts below, specified the admin tab (actions, sort, search), tested the feedback form and the admin overview in the app |
| Branch | `recipe` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

```
2026-09-14 21:37 +0200  Is the feedback working (on the bottom right of the configurator?) If not, please add it to the database (table: "feedback") and wire it up. Also make an admin tab in the admin menu with a overview of the feedback. As actions add [as icons]: "star", "delete". Add a sort and search bar too
2026-09-14 23:15 +0200  Can you also add admin to the bottom of the left bar in the browser?
2026-09-14 23:15 +0200  Can you also add a link to admin page to the bottom of the left bar in the browser (if user is admin ) ?
```

## Plan

None: the work was small enough to go straight from the first prompt, which specifies it (feedback table, wiring of the configurator's feedback form, admin tab with star and delete actions, sort and search). The agent's reports to the human, reproduced below, stand in for the plan.

## Agent reports (verbatim)

*2026-09-14 19:43 UTC*

No, the feedback button wasn't working. It only logged the message to the browser console, and there was no endpoint to send it to. It now saves to a new `feedback` table, and there's a **Feedback** tab in the admin menu.

**How I checked it:** all 305 server unit tests pass, including a new `tests/unit/feedback.test.ts`, and the server, UI and editor type-check cleanly. I sent feedback through the real button on `/configurators/test/mgtest:0.1` and the row was saved with the script details and page URL. I deleted my two test rows afterwards.

**I couldn't open the new admin tab in the browser.** Your local database has no admin account, and it looks like a copy of real user data, so I didn't make anyone an admin. The admin endpoints are covered by the tests, but please give the tab a look yourself.

**Configurator feedback**
- The migration `0006_wide_luke_cage.sql` creates the table. Each row stores the message, which script and version it was about, the page URL (with the parameter values, so you can reopen the exact configuration), the sender's username if they were signed in, a starred flag and the time.
- `POST /feedback` is public, so anonymous visitors can use it, and limited to 10 messages per 10 minutes per IP address. You can change the limit with `SERVER_FEEDBACK_RATE_LIMIT` / `SERVER_FEEDBACK_RATE_WINDOW`.
- The form shows "Sending…" while it works. If sending fails, the form stays open with the message intact and shows an error.

**Admin → Feedback** (`/admin/feedback`)
- **Search** matches the message, configurator name, author and sender.
- **Sort:** newest first, oldest first, starred first, or by configurator. There's also a filter for all / starred / not starred.
- Each row shows the message, a link back to the configurator page it came from, the sender and the date.
- **Icon actions:** the star toggles on and off (filled when starred). Delete asks for confirmation first, since it can't be undone.

The main new files are `apps/server/src/routes/feedback.ts`, `apps/server/src/services/FeedbackStore.ts` and `packages/ui/src/admin/admin-feedback.ts`. The admin routes are added to `routes/admin.ts`. Your running dev server already applied the migration when it restarted. Nothing is committed.

*2026-09-14 21:16 UTC*

I added the link. Admin accounts now see an **Admin** item with a shield icon at the bottom of the browser's left bar, under an "OPERATOR" heading. It goes to `/admin`. Everyone else doesn't see it.

The editor typechecks cleanly. To see it on screen, I temporarily marked the signed-out session as admin in the page only, which didn't touch the server or the database. The link showed at the bottom of the sidebar, below Home, My Scripts, Shared Scripts, Configurators and Projects. I then reloaded the page to undo that.

The change is all in `apps/editor/src/pages/browser.ts`. It uses the same menu-item component as the rest of the sidebar, so it looks and highlights the same.
## Review and decisions by the human

- Asked whether the configurator's feedback form (bottom right) worked, and if not to store feedback in a `feedback` table and wire it up.
- Specified the admin side: a Feedback tab in the admin menu with star and delete as icon actions, plus sort and search.
- Then asked for a link to the admin page at the bottom of the browser's left bar, for admins only.
- Tested the result in the app.

## Commits

The feedback work is part of one mixed commit with the human's own message, made before the disclosure process existed. Its feedback part is these files; the IFC4 and OpenSCAD parts of the same commit have their own records.

| Commit | Subject | Feedback files in it |
|---|---|---|
| 22a4393 | Implemented browser functionality. Configurator Feedback logic. Work on procedural output formats: IFC4 and OpenSCAD. First working exporters | `apps/server/src/services/FeedbackStore.ts`, `apps/server/src/routes/feedback.ts`, `apps/server/tests/unit/feedback.test.ts`, the `feedback` table in `apps/server/src/db/schema.ts` and migration `0006_wide_luke_cage.sql`, `apps/server/src/routes/admin.ts`, `apps/server/src/config.ts`, `apps/server/src/plugin.ts`; `apps/editor/src/services/feedback.ts`, `apps/editor/src/services/admin.ts`, `apps/editor/src/pages/admin.ts`; `packages/ui/src/admin/admin-feedback.ts`, `packages/ui/src/admin/admin-configurators.ts`, `packages/ui/src/configurator/configurator.ts`, `configurator-header.ts`, `configurator-attribution.ts`; the admin link in the browser page |
