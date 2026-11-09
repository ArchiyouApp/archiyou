# A fast project page, ordered around designs, and designs from a configurator

| | |
|---|---|
| Dates | 2026-10-30 → 2026-11-09 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent |
| Human | Mark van der Net: wrote the prompts, reported the slow Create → Project, designed the page order and the configurator picker, chose the rename to Design (labels only) and what the Shared tab lists, tested every flow in the browser on the production data, asked for the dossier, approved migrations 0003 and 0004 on production after a backup |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

```
2026-10-30 14:56 +0100  I want to work on projects a bit. Starting a project can be done from a configurator and from the editor. From the workspace when you start a new project, that flow does not really work. For one when you chose righttop button  Create => Project it takes a very long time to load. Why? Looks like the meshup kernel is loaded? Please fix that. It should be superfast. Then first order the page a bit. The header P-005 New Project etc. is ok. But I think the client information should always be on top in a collapsable. Client: No client <Add Client> - if set shevron to minimize/maximuze collapsable. Same for Notes and activities. This will keep maximimize real estate for the configurations and deliveries. First deliveries are always tied to configurations right? So, only show deliveries of selected configuration. I think we could rename "Configuration" to "Design" (What do you think?). In the section configurations/designs there should always be a button <From Configurator> which shows a popup menu with all published configurators. There are some tabs like "My Configurators", "Shared Configurations", "Public configurators". Then underneath just the configurator cards like in the main workspace site. If you click on a configurator you get shown that one, then the user can easily click "Save as project" (the app knows what project of course) and the user is returned to the project screen.
2026-10-30 15:05 +0100  1. ok, 2. yes
2026-10-30 17:47 +0100  still pretty ugly layout. Client, Notes and activity should be not rounded and just be rectangular with white background, belonging more to the section with title, action buttons ("Mark won"). Then the content should be rounded with padding etc. You can test in the browser under archiyou user (no problem for the production database). Please check the browser console, I see a lot of errors (around blocked request for thumbnails). It is also not really fast
2026-10-30 19:01 +0100  Im trying to start a project with a design with this configurator: http://localhost:5173/configurators/archiyou/ur_house_sketch:0.4?project=bac594a8-ea74-472d-bdae-fd3ad1856138 - It takes very long to load? Thats from my setup, but I dont see where?
2026-10-30 19:17 +0100  contnue
2026-10-30 19:25 +0100  If we have a version in the configurator url we can directly query that right? Why get all published versions?
2026-10-30 19:31 +0100  ok remove the button "add to project" below right (next to download button) in configurator. We have the top right buttin. Please make the text "Add to project {{name of project if given}}"
2026-10-30 19:38 +0100  Im testing the project flows. Some improvements: New delivery menu should have white background. The To* should not be there, do mention email adres of client. If no client given tell the user: "No client for this project yet. Please make one before you can send things!" All other popup screens should have white background to btw. I prepared a delivery with this link: http://localhost:5173/d/QyOxCTysfyaJNp3bCPC2iPZNutgSA1lcmtMYJJSnCl4 - But in the model I got a box (looks like subbox) through the back glass pane. Are we outputting invisible shapes too? Please check
2026-10-30 19:53 +0100  Can you visually check the project page: (for example: "http://localhost:5173/projects/396bdd10-2174-41ad-8871-39d07eb383d4?design=bb2aaafd-1e91-4460-a362-83025b9219c9") and see if that can be nicer. I feel that it can be more compact by making buttons smaller. But give buttons better texts. From configurator (main button) => "New design from configurator" - then buttons within designs should be smaller (text xs). I think the blue fill of selected design is ugly with the background fill of parameters. These parameters probably need to be smaller. For example the date the design is made is more important i feel. The thumbnail background grey is also very ugly with the blue selecterd background. Probably good to make these thumbnails black-white like in configurators. This is a setting in the Thumbnail component right? In the deliveries the buttons also need to be small (like in design boxes). I did not get a email btw for the delivery. Is the mailgun working?
2026-10-30 20:10 +0100  In New Delivery menu Design names have v1ur_house_sketch - so version and title with seperation. Please fix. Also make the menu a bit wider. 1/3vw. Can you remove border around thumbnails in design card?
2026-10-30 20:12 +0100  In New Delivery menu => design dropdown: Can you make the version grey? And more spacing between the version and title. It does not read well.
2026-10-30 20:18 +0100  Can you add a section "Dossier files" to the Client/Notes/Activity (place before activity) where the user can upload files that are related to the project. Could be any reasonable files. We can just save them in the asset management layer we already have right? In the the New Delivery menu I want to add also the option to upload a specific file. Rename "Included" to "Include fulfillment outputs". Then a new section: Attach extra file, then two options: from dossier files or upload a new one. /effort xhigh
2026-10-30 20:54 +0100  Ok looks pretty nice. Some tweaks. Make the dossier files in the list text xs. The same for the notes,and activity and client dossier content. In the New delivery menu please make the lists also xs. So Fulfullment outputs list items, the extea files.  Please move the title of the mail the second item under Design. Make a seperate subtitle Offer: ... this is an offer etc. The subinput fields of offers also xs.
2026-10-30 21:02 +0100  In browser: what is the reason the loading is slow? Takes more than 3 seconds? Also can you rename the tabs: Configurators => My Configurators, Shared Scripts => Shared Scripts by/with me, Projects => My Projects     --- also make sure the tabs give the right results. Maybe the Shared script now is only the script I own that are shared? The filter chips on Project tab (all, requests etc) should be smaller. If there are counts next to it make it less visible (lighter grey).
2026-11-02 20:42 +0100  Small esthetical changes: When in configurator and choose "Add to project", remove the Label (optional). The list of project names should be text extra small. On project detail page, remove "mark won", "mark lost" for now. Also in the browser: Shared script by/with me is too long, just make it Shared scripts. On menu left and tabs. On shared script card, can you add to whom / public. place that info under the title. There is also a bug when you go to create new project, from configurator, the button right top shows "Add to project "P-014 New project"". Please make the title "P-014 New Project" italic. Otherwise it reads weird.
2026-11-02 20:50 +0100  Kun je voor nu heel even de offerte functionaliteiten uitschakelen. Gewoon in commenten. Later wil ik dat wel weer toevoegen.
2026-11-03 10:12 +0100  Can you commit the work on projects to develop?
2026-11-03 10:31 +0100  commit
2026-11-03 11:47 +0100  Can you add the time in updated label for  cards of script in browser?
2026-11-03 11:57 +0100  the new time causes a next line, can you make the text a bit smaller so it fits on one line
2026-11-03 21:08 +0100  For fun, could you do a zoom in animation of a thumbnail in the script card on the browser? Zoom in pretty far so it fills the container
2026-11-03 21:11 +0100  Ok its pretty nice. But it is also clear that the thumbnails need to start off bigger. Please have them fill the container better to start. Then zoom in a little on mouse over
2026-11-03 21:12 +0100  make the thumbnail slightly smaller, not it is cut off too much
2026-11-05 14:54 +0100  In project management it also happens that the "delivery" (maybe call it DOCUMENTS? ) is for internal use, so it should be send to users own email. Can you add that. Probably good to have boolean pill <internal>/<client>. If no client is given internal should be automatic. Do show warning why client is blurred out (maybe with forbidden mouse cursor and message hover?)
2026-11-06 15:47 +0100  To balance the use of internal use a bit in the project page: There is now a text line with the files in the delivery: 'ur_house_sketch.glb, ur_house_spec.pdf' etc. Can you make this clickable. Also can you add small icons to the left? So 3D model icon, doc icon, calc/table for excels etc.
2026-11-06 15:51 +0100  In New project page you can chose Add client, there is bug when you chose a existing client (and press Add): as client is then shown <no name>. Please
                          replicate and fix. Also can you add a checkbox below "or a new one" (<== should be same text style as Existing client) that says "Add to client list" (on by
                          default)
2026-11-06 16:26 +0100  Commit this work on projects
2026-11-09 13:55 +0100  yes
2026-11-09 13:56 +0100  can you check what work is still not committed?
2026-11-09 13:57 +0100  close the projects indeed. and make a commit of the rest
```

## Plan (agent output, reviewed by the human before implementation)

### Why Create → Project is slow

`layout-main` wraps `/browser`, `/projects/:id` and `/admin`, and calls `warmupWorker()` for
every one of them: the core library plus ~40 MB of CAD kernel (meshup binary, OpenCascade
wasm). The project page is ~0.57 MB of code and needs the kernel only to make a delivery's
files; the project request competes with the download, and on the Vite dev server importing
`@archiyou/core` on the main thread is hundreds of module requests.

Fix: no warmup in the layout (keep its server-target reset). The editor and the configurator
warm the kernel themselves and `RunnerWorker.run()` initialises on first use. The delivery
dialog warms it when it opens.

### Project page order

- Header unchanged (number, title, status, menu).
- Collapsible strips on top, full width: **Client** ("Client: No client [Add client]", or
  name and email; the chevron shows details and form), **Notes**, **Activity** (collapsed,
  with a one-line summary). No side column.
- **Designs** with a **[From configurator]** button; clicking a design selects it
  (`?design=…`, newest by default).
- **Deliveries** of the selected design only; "New delivery" makes one of that design
  (`deliveries.configuration_id` is required, so every delivery has one).

### "From configurator" picker

A dialog with tabs **My configurators**, **Shared with me** (others' published, not public,
visible to me) and **Public**, over the workspace's configurator cards (`browser-asset-grid`,
data from `/scripts/published`). A card opens the configurator with `?project=<id>`: its
"Save as project" becomes **"Add to P-005"**, which goes through `/projects/new` and adds a
design to that project instead of making one, then opens `/projects/<id>`. Sign-in and email
confirmation keep working. A "← Back to P-005" link, the configurator page having no nav bar.

### Configuration → Design

Visible labels only; tables, API and types keep `configuration`, so no migration.

## Review and decisions by the human

- Rename: labels only. Shared tab: others' non-public published configurators I can see.
- Layout, after testing in the browser: Client, Notes and Activity as square white strips
  belonging to the header, content in rounded cards; smaller buttons ("New design from
  configurator"), a selected design outlined instead of filled, the date over the
  parameters, thumbnails without background or border, xs text in strips and dialogs.
- Configurator: one "Add to project <name>" button at the top (the bottom one removed), the
  project's name in italics; the dialog without the label field.
- Reported the slow configurator and workspace loads; the agent traced both to list
  endpoints reading every version with its code and fixed them in ScriptStore.
- New delivery: white dialogs, the client's address instead of To/Name and a message when
  there is no client, "Include fulfillment outputs", "Attach extra files", Title second,
  a separate Offer section; later asked to comment out the offer for now.
- Dossier files: asked for them; approved migration 0003 on production after a backup
  (`~/db-backups/archiyou-20261030-194052-pre-0003.dump`).
- Reported a hidden helper box in a delivery's model; the viewer now hides nodes marked
  hidden in a GLB without a scenegraph. Left open: leaving hidden shapes out of exports.
- Tabs renamed (Shared Scripts, My Configurators, My Projects) and checked against their
  contents; the agent found and fixed restricted shares listed with their code to anyone
  by `/scripts/shared/:author`. Mark won / Mark lost taken out for now.
- Workspace cards: asked for the time with the last change, the dates on one line, and a
  thumbnail zoom on hover; then tuned the thumbnail's size twice (bigger, then a little
  smaller: 1.15, 1.35 on hover).
- Internal deliveries: asked for an Internal / Client choice, sent to the professional's own
  address, Internal automatic without a client, Client greyed out with the reason on hover.
  Suggested renaming deliveries to "Documents"; left as is for now (it would clash with the
  "Documents (PDF)" output).
- Asked for the delivery files on the project page as links with icons.
- Reported that choosing an existing client gave "(no name)"; the agent reproduced it (Web
  Awesome's select reports a pick before its value is set, so Save made an empty client) and
  fixed it, also in the delivery's Design list. Asked for "Add to client list"; approved
  migration 0004 on production after a backup (`archiyou-20261106-151900-pre-0004.dump`).
- Two empty clients made by that bug are still in the production database.
- Translations of the new project, delivery and dossier texts are still to do.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| 6498455 | Projects: dossier files, configurator designs, a compact project page | 2026-10-30 14:56 and the tweaks after it; committed on 2026-11-03 10:12 |
| b66371c | Projects: internal deliveries, clickable files, one-project clients | 2026-11-03 11:47 to 2026-11-06 15:51; committed on 2026-11-09 13:55 |
| (the commit after a58829e) | Projects test: listed clients as a verified user | 2026-11-09 14:16: the test of b66371c, run once vitest was back, used an unverified user |
