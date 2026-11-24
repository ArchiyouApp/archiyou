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

## Next

Step 3: `shape.product()` with the aliases (a column in `producten`: main term in English,
aliases in English and Dutch), `shape.component()`, `check()`, `strict()`.
