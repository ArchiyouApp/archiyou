# One module make: from a shape with a product to weight, cost, time and order lists

| | |
|---|---|
| Dates | 2026-11-24 → (open) |
| Model | Claude, Claude Code agent (the exact model and version: to be added by the human) |
| Tool | Claude Code as agent; plan written and discussed in the conversation |
| Human | Mark van der Net: asked for one module make, decided the points below |
| Branch | `make-module`, on top of `material-flow` |

## Plan (agent, decided by the human)

### Data: the sheet is the source, the core reckons with a snapshot

- The core sheet (URBUILD_DATABASE_CORE) stays where people keep materials, products, operations,
  components and settings.
- A sync makes a snapshot of it: the computed values of its tables (`tables.*`) and settings
  (`settings.*`, `outputs.marges.*`, `outputs.opslagen.*`), checked against a schema, with a
  version (date and number) and its source (sheet id, title, time). The snapshot needs no
  formulas, so the core needs no cloudcalc to use it.
- The sync runs locally with the service account (the CLI: `archiyou makedb`), by hand at first.
  The server keeps no Google key (plans/PROTECTED_CONTENT.md §12.4): it stores the snapshots it is
  given (`pnpm admin:makedb add`) and hands them to runs. Not in git: the repository is public and
  the snapshot holds purchase prices.
- A run gets a snapshot as content (`kind: 'make-db'`), as it gets Google Sheets now. A script can
  pin one (`make.db('2026-11-24.1')`); else the latest. Every result says which one it used.
- At each sync the core recomputes the sheet's components and reports where its numbers differ
  from the sheet's formulas: the two ways of reckoning are checked, not trusted.

### Code: everything under `packages/core/src/make/`

- `db/` snapshot, schema, version, lookup (id, group, alias, fuzzy)
- `catalog/` materials, products (measured by their form), operations and recipes
- `shape.ts` `shape.product()`, `shape.component()` on both kernels
- `takeoff/` from shapes to lines: quantities, weight, CO2, time, cost; grouped any way
- `procure/` order list, cut list, sheet layout
- `components/` block(), variants (presets), rows for the sheet
- `build/` wall, fasten, ...: the geometry now in Make.ts
- No new dependencies. MaterialManager stays for how materials look and reads their properties
  from the snapshot. The old products API (`make.products().assign(...)`, `unassigned()`, ...)
  goes once the new one covers it.

### API: the product belongs to the shape

    stud = box(38, 235, 2624).product('SLS')        // group + size from the shape: sls-38x235
    take = make.takeoff(all())
    take.weight(); take.cost(); take.time(); take.by('component').table(); take.order(); take.check()

- A name becomes a product by: product id, group, alias, then fuzzy. Each product has one main
  term, international where it can be (English), and aliases: English and Dutch first.
- When in doubt nothing is chosen: an error names the candidates. Problems are warnings by
  default and collected in `take.check()`; `make.strict()` turns them into errors.
- Time is a quantity of its own: a column minutes per unit of work in `bewerkingen`; cost is time
  times the rate.

### Builders' prices

Left out for now (the human wants to think it over). Prices come in as one layer (the snapshot),
so a builder's layer can go over it later without changing the takeoff.

### Steps

1. `make/db`: snapshot format and schema, `MakeDb`, sync in the CLI, store and serve on the server,
   content `make-db` in a run, `make.db()`.
2. Move the code into `make/` without changing what it does.
3. `shape.product()`, `shape.component()`, lookup with aliases and fuzzy, `check()`, `strict()`.
4. `make.takeoff()`: weight, cost, time, grouping, order and cut lists.
5. `timberwall` and `ur_house_detailed` on the new API; publishing components as an admin command.
6. Remove the old API; cloudcalc only for offer templates.

## Decided by the human

- Time a column of its own: the sheet has it already (`bewerkingen`: `tijd (seconden)`; cost =
  time / 3600 x rate x labour factor). The core is to use the time, not cost back to time.
- Aliases are important, as more languages play a part: per product a main term, international
  (English) where it can be, and aliases with translations; English and Dutch first.
- Warnings by default; strict when asked.
- The old products API goes.
- Snapshots on the server only, not in git (public); something for that later.

## Done

Step 1, the make database:

- core `make/db`: the snapshot format (format 1, version `YYYY-MM-DD.n`, date, source, the four
  tables as records, settings by named range), `validateSnapshot()` (errors refuse, warnings are
  kept; a row without its table's key is a note, as the sheet's own explanation under
  `bewerkingen`), `snapshotFromTables()`, `nextVersion()`, `compareVersions()`, `MakeDb`.
- `make.db(version?)`: reads the snapshot the run was given as content (`make-db`); without it the
  run stops and asks for it (`result.needs`). `scanContentNeeds()` names it where the code uses
  `make.db()`, `.product('…')`, `.component('…')` or `make.takeoff()`. The content kind is added in
  core and module-sdk alike.
- CLI: `archiyou makedb --sheet <url> [--out dir]` reads the sheet's tables and settings with the
  service account and writes `makedb-<version>.json`; no file on errors. `archiyou run --makedb
  <file>` gives a run its snapshot. First snapshot of the real core: 2026-11-24.1 (53 materials,
  362 products, 50 operations, 533 component rows, 27 settings; 7 warnings: the explanation rows
  under `bewerkingen`).
- Server: `MakeDbStore` keeps snapshots in `SERVER_MAKEDB_PATH` (default `data/makedb`, ignored
  by git), `pnpm admin:makedb add|list`, `GET /makedb` and `/makedb/:version` (signed in), and the
  execution worker gives runs theirs. It imports only core's `make/db` (plain TypeScript), so the
  API process does not load the whole core. No Google key on the server.
- Editor: `make-db-content.ts` fetches the snapshot a run needs from the server, with the sign-in;
  `secretManager.resolve()` includes it.
- Tests: core (schema, versions, needs, make.db() in a run with and without it), server
  (MakeDbStore), editor (fetching).

Step 2, one place:

- `git mv` (history kept): `modeler/Make.ts` → `make/Make.ts`; `modeler/fasten.ts`,
  `foldoutView.ts` → `make/build/`; `modeler/pack3d.ts`, `packChoice.ts` → `make/pack/`;
  `products/` (ProductManager, recipes, offer-html, apps-script) → `make/products/`; their tests to
  `tests/unit/make/`. `modeler/parts.ts` and `Layouter.ts` stay: the animator and the docs use them
  too. Imports rewritten by a script that resolves each from the file's old place and touches only
  what points at a moved file; the API and completion generators read the new paths. Make.ts itself
  is not split yet: its code is rewritten in steps 3 and 4 anyway.
- Nothing changed in what the code does: core 2032 tests pass, the 5 that fail failed before
  (version, IFC house fixture, two runner-help examples, a ProductManager error message);
  cadscripts, CLI, server and editor pass. The generated API reference and completions are
  regenerated; they had fallen behind the source.

Step 3, the product belongs to the shape:

- Sheet (trial copy only so far): `producten` has two new columns, `term` (one main term, English
  where it can be) and `aliassen` (English and Dutch, comma separated), filled for all 362
  products by the agent from the groups, types and uses; the human is to read them over. The real
  core does not have them yet.
- core `make/catalog/`: `products.ts` (the product model and size fit, taken out of
  ProductManager, which now imports it) and `Catalog.ts`: a name becomes products by id, group,
  alias, every word, then fuzzily (edit distance, none for names of three letters or fewer); the
  part's size chooses among them. It never guesses quietly: a fuzzy read, a tie or a misfit is a
  warning, no product or no way to choose an error with suggestions.
- `shape.product(name)` / `collection.product(name)` (per part), `shape.product()` to read it back
  (id, how it was found, size, material, the make database version), `shape.component(id)`,
  `make.check()`, `make.strict()`. The product sets the shape's material, and a copy keeps both.
  A product read back finds its database again by version, also when the run was given it as
  'latest'.
- Found and fixed: the script's `make` and the one shapes reach were different instances, so
  `check()` was empty; the Modeler keeps one Make now and resets what is per run.
- Tests: `tests/unit/make/catalog.test.ts` (lookup, size choice, shape.product in a run, check,
  strict). Core 2071 pass, the same 5 fail as before; CLI, server pass.

Step 4, the takeoff:

- One engine: `make.takeoff()` reckons with ProductManager, which now reads a snapshot as it read
  the sheet (`fromDb()`), and takes shapes that `shape.product()` already resolved (`place()`),
  so nothing is matched twice and the costs are those the sheet's components were checked
  against.
- Time from the sheet's time: per operation `tijd (seconden)` x the labour factor
  (`settings.labor_factor`), as the sheet's `arbeidstijd (uur)`; a component's hours are its rows'
  `arbeidstijd`. Checked on the trial copy: hours x rate is the labour cost, to the cent.
- `take.weight()` (kg, net: volume x density, else the mass per piece of the sheet),
  `take.cost()` (incl. the margins), `take.time()` (hours by phase), `take.lines()` (excl. margins,
  as the component rows), `take.by('component' | 'product' | 'label' | 'material' | 'vorm' |
  'group' | 'phase')`, `take.order()`, `take.cuts()` (per length of stock the parts sawn from it),
  `take.check()`, `take.add()`, `take.complete()`, tables (`table()`, `orderTable()`,
  `cutTable()`). Screws drawn by `make.fasten()` are counted by their heads.
- `shape.product(name, { component })`: the component whose rows give the part's recipe and its
  group in `by('component')`.
- Problems (a shape without a product, no recipe, no price, no weight) go to `take.check()` and
  `make.check()`; `make.strict()` stops the run.
- Tests: `tests/unit/make/takeoff.test.ts`, on a sheet worked out by hand. Core 2075 pass, the
  same 5 fail as before.
- Not yet: CO2 in the takeoff (the sheet has it per product and per component row).

Step 5, the scripts on the new API:

- What a component script needs, added to core: `make.add()` and `make.complete()` (what the model
  does not draw; they go with the shapes the run gave a product, each a share, so a wall used
  twice brings them twice), `product([...names])` (the first that fits: SLS, else finger-jointed),
  `{ fit: false }` (by id, for parts drawn otherwise than sold: rafters cut at an angle),
  `shape.partOf(what)` (drawn but reckoned as part of something else: the roof's layers in the
  rows of `dak`, a head plate in its pile), `take.loose()`, `take.block()`.
- Without the make database (a run not signed in, a test) `.product()` keeps the name and the
  shape's size and the takeoff finds the product: a component needs nothing to run, as before.
- Found and fixed on the way:
  - a component run did not get its parent's content (sheets, the make database); it does now,
    the component cache key includes the content's versions, and a component that stops for
    content makes its parent ask for it;
  - a component's own problems stayed in its run; they reach the model's `make.check()`;
  - a piece of a beam shorter than its section (a 38 mm block cut from a 38x235) fit nothing: three
    studs under a window were never priced (the old API dropped them silently);
  - a second `complete()` of a component took what the first one added as modelled and left out
    the sheathing, gypsum and screws (the old `collect()` hid this by merging all completes into
    one, which counted a component used four times as one element in the table layout).
- `timberwall` (repo) on the new API. `archiyou blocks` reckons with a snapshot (`--makedb`) and
  `make.takeoff().block()`, writes to the sheet the snapshot came from: the same € per m2 as from
  the sheet (157.83 / 138.25; `hsbwand_esb` 153.48: the ESB recipe fix of material-flow).
- Publishing from the library: `pnpm admin:components versions|export author/name[:version]`
  (apps/server, reads only) writes a script with its version; `archiyou blocks <script.json>`
  writes its rows with bron `author/name@version` and bron-id the version's id. The server keeps
  no Google key: the export is on the server, the writing where the key is.
- CLI: `archiyou run --components <dir>` (and the script's own folder): `.js` files, or `.json`
  scripts with params and presets as the server keeps them.
- The production scripts of the house (`ur_house_detailed`, `timberwall`, `ur_roof`, `ur_bent`,
  `ur_floor_foundation`, `foundation_screw`) read from the database (read only) and changed by the
  agent in their product sections only, run locally against the old API as a baseline: the same
  € 23,192 and all 31 lines alike, then € 23,217 with the three studs; and now 266 hours, 8.1 t.
  They are for the human to save once this core is deployed. `ur_floor_foundation` calls
  `.autoScale()` on a document view, which no branch of this core has; left as it is.
- Tests: core `takeoff.test.ts` (components used twice, names, short pieces, partOf, without the
  database, content and problems through components). Core: the same 5 fail as before, and the
  round-trip table of the random `ur_house_sketch` (as before); CLI, server, editor pass.

Renamed after step 5 (asked by the human, who found "block" vague: it named the old layout of the
componenten tab, of blocks of rows with totals, which the table replaced): the CLI command
`archiyou blocks` is `archiyou components`; `take.block()` and `ProductManager.block()` are
`componentRows()`; `readBlocks()` / `Block` are `readComponents()` / `ComponentSpec` (with
`ComponentSpecProduct`, `ComponentSpecInfo`, `ComponentRows`, `ComponentRowLine`,
`ComponentRowStep`); the CLI files `blocks.ts` / `sheetBlocks.ts` are `components.ts` /
`sheetComponents.ts`. "Block layout" stays the name of the old layout of the tab, which is still read.
Then `make.takeoff()` became `make.estimate()` (asked by the human: "takeoff", the estimator's
term for measuring quantities from drawings, is little known, and it reckons more than quantities:
cost, hours, weight, the order and cut lists): the class `Estimate` in `make/estimate/`, its types
`EstimateOptions`, `EstimateLine`, `EstimateGroup`, `EstimateIssue`, `EstimateKey`. The old API's
internal `TakeOff` record in ProductManager keeps its name; it goes with that API in step 6.
Above, the names are those of when the step was done.

Step 6, the old API removed:

- `make.products()` is gone, and with it `fromSheet()`, `assign()`, `collect()`, `unassigned()`,
  `toTable()`, `find()`, the "only mapped" mode with its TakeOff record, and the matching it had
  of its own (the Catalog does it). ProductManager is the engine of `make.estimate()` and
  `make.offer()`, not a script API: `fromDb()`, `fromWorkbook()` (what `fromSheet()` did with a
  workbook, for `fromDb()` and the tests), `fromOffer()`, `place()` (now also with `waste`, and it
  refuses a component the sheet does not have), `add()`, `complete()`, `compute()`, the order
  list, the component rows and the offer. 1977 lines became 1564.
- `make.offer(template)` (make/offer/Offer.ts): the offer template, the only sheet a run still
  opens with cloudcalc (it is live: the builders' prices). `add(component, quantities | shapes)`,
  `compute()`, `outputs()`, `page()`, `html()`, `scenarios()`, `scenarioTable()`. The run loads
  cloudcalc for `make.offer(` (STANDARD_MODULE_USES), no longer for `fromSheet(`/`fromOffer(`.
- `materials.fromSheet(url)` is kept: the materials API, not the products one; a shape given a
  product loads its material from the make database anyway. For the human to decide.
- `archiyou run` takes a `.json` script (code with its params, as the server keeps it).
- Tests: the engine's tests use an adapter that gives shapes a product as `shape.product()` does
  (the Catalog) and places them; the old tests of matching keep their cases, with the Catalog's
  messages: a tie is taken and said (a warning) where `assign()` refused it, and a group of one
  product misfits as its id does. Tests of what is gone (collect, the sheet by URL, toTable, the
  materials of fromSheet) went; the offer has a test of opening the template with cloudcalc.
  Core: 2 fail, both from before (version, IFC house fixture); the 3 of the products API that
  failed before are gone with it. CLI, server, editor, UI pass.
- The production scripts still on the old API, read from the database (read only) and changed by
  the agent: `ur_house_sketch` (`make.offer()`), `ur_floor`, `ur_house_detailed_storeys`,
  `wall_time_cost`, `products_abstract`, `products_test`. Each run against the old API as a
  baseline, the same: the offer € 47,674.05 (excl. BTW € 39,400.04), the storeys house € 29,681
  (material € 14,404), wall_time_cost € 1,256.16 incl. margins with the same minutes per part,
  products_test € 1,297.47, products_abstract € 1,123.06. `ur_floor` calls `.autoScale()` too.
  For the human to save once this core is deployed, with the step 5 scripts.

After step 6 (asked by the human: a snapshot is the whole core sheet; materials only from it):

- `archiyou makedb` reads the whole sheet: every tab as a table (its named range tables.<name>,
  else the tab from its first row with data, a column without a heading by its letter) and every
  other named range as a value. Not the builders' tabs (`bouwers`, `bouwersprijzen`): their own
  prices, which every signed-in user could read in a snapshot; a layer of their own later, as
  decided. The snapshot says which tabs it read and which it left out. The four tables the core
  reckons with are checked as before; the others come as they are. `make.db().tables()`,
  `.settings()`, `.table('instellingen')`. The real core: 2026-11-25.1, five tables, 333 named
  values (the settings and the components' outputs); the house gives the same as on 2026-11-24.1.
- `materials.fromSheet()` and `fromWorkbook()` are gone: the materials come from the run's make
  database, loaded the first time a material is asked for; without it (not signed in, a test) a
  material has its look and no properties, and the run goes on. A script that uses material
  properties (`.material('…')`, `.weight()`, `.carbon()`, `materials.rc()`) asks for the make
  database, as `.product()` does. `materials/fromSheet.ts` is `fromRows.ts`. cloudcalc is now only
  for the offer template.

## Next

- The real core sheet: the `term`/`aliassen` columns (now in the trial copy only), then a snapshot
  of it on the server (`archiyou makedb`, `pnpm admin:makedb add`).
- Deploy, then save the migrated scripts in the editor.
- CO2 in the estimate; builders' own prices as a layer over the snapshot.
