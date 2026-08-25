//! collada_io — vendored from https://github.com/5mattmatt1/voxport
//! (crate `collada_io` 0.1.0, Matthew Henderson, MIT OR Apache-2.0).
//!
//! Upstream is unmaintained (last published 2020) and undocumented, and its writer is
//! missing several things we need. We vendor it rather than depend on it so the gaps can
//! be filled — the same approach `packages/gdrr2bp-wasm` takes with gdrr-2bp.
//!
//! Only the *writing* half is kept; nothing here parses COLLADA.
//!
//! Patches applied to the vendored source (all marked `// vendored:`):
//!   - P1  `meta::Unit` emitted `unit="…"`; the spec attribute is `name="…"`, and importers
//!         read the model scale from it, so a wrong name means a wrong-scale import.
//!   - P2  `meta::Asset::{created,modified}` were `chrono::DateTime<Utc>` written with
//!         `to_rfc2822()`. COLLADA wants `xs:dateTime`. Changed to a plain `String` supplied
//!         by the caller, which also drops the whole `chrono` dependency — otherwise
//!         `Utc::now()` on wasm32-unknown-unknown drags in the js-sys `wasmbind` path.
//!   - P3  Added `material` (library_materials + library_effects). Upstream has an `fx/`
//!         directory for this, but it is not referenced from `lib.rs` and does not compile
//!         (`;` instead of `,` between struct fields, a bare `Option<>`), so it is dropped
//!         and the module written from scratch.
//!   - P4  Added `geometry::Lines` (`<lines>`) — upstream can only emit triangles.
//!   - P4b Added `geometry::Polylist` (`<polylist>` + `<vcount>`) so n-gon faces survive
//!         instead of being flattened to a triangle soup.
//!   - P4c `geometry::Mesh` now holds `Option<Triangles>` / `Option<Polylist>` /
//!         `Option<Lines>` instead of exactly one `Triangles`.
//!   - P5  `scene::Instance::Geometry` ignored its `bind_material` field entirely (upstream
//!         `// TODO: Bind Material (fx)`); now emits `<bind_material><technique_common>`.
//!   - P7  `scene::Node` had no children, so only a flat node list was possible. Added
//!         `children: Vec<Node>` and recursion, emitted after the instances per the
//!         COLLADA 1.4.1 content model `(asset?, transform*, instance_*, node*, extra*)`.
//!   - P8  `#[derive(Clone)]` on the writer types. `ColladaWriter::to_string_dae()` takes
//!         `&self` so the builder stays usable after serializing, and none of these were
//!         Clone upstream.
//!   - P6  Dropped the unused/unfinished parts: `Vertex`, the empty `DataArray` enum,
//!         `ArrayType`, `Technique`, `Spline`, `ControlVertices`, `GeometricElement`,
//!         `BindVertexIndex`, the unused `sid`/`name` on `InstanceMaterial`, the five
//!         empty `TransformationElement` variants that only reached `unimplemented!()`,
//!         and the non-compiling `fx/` directory.

pub mod collada;
pub mod geometry;
pub mod io;
pub mod material;
pub mod meta;
pub mod scene;
pub mod util;
