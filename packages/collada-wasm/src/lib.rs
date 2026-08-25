//! collada-wasm
//!
//! WebAssembly COLLADA (.dae) writer for Archiyou, built on a vendored + patched copy of
//! 5mattmatt1/collada_io (see `src/collada_io/mod.rs` for the patch log).
//!
//! The API is a stateful builder rather than the JSON-in/JSON-out shape used by
//! `packages/gdrr2bp-wasm`: geometry buffers as JSON would be enormous, whereas `&[f32]`
//! views onto JS typed arrays cross the boundary nearly for free.
//!
//! It is split the way COLLADA itself is split:
//!   - `library_geometries` is a FLAT pool  -> `add_*_geometry()`
//!   - `library_visual_scenes` is a TREE    -> `begin_node()` / `attach_geometry()` / `end_node()`
//!
//! Welding happens here rather than in meshup. meshup's Rust already has an equivalent
//! (`mesh/mod.rs get_vertices_and_indices`), but it is not exposed to WASM and exposing it
//! would mean rebuilding meshup's wasm binary — which in this repo is ahead of its csgrs
//! submodule pin, so rebuilding regresses rings/silhouette/reconstruct_ngons. Welding a
//! buffer we already have in hand is far cheaper than that risk.

use std::collections::{HashMap, HashSet};

use wasm_bindgen::prelude::*;

pub mod collada_io;

use crate::collada_io::collada::Collada;
use crate::collada_io::geometry::{Accessor, FloatArray, Geometry, Lines, Mesh, Polylist, Source, Triangles, Vertices};
use crate::collada_io::material::{Effect, Material};
use crate::collada_io::meta::{Asset, Contributor, Unit, UpAxis};
use crate::collada_io::scene::{BindMaterial, Instance, InstanceMaterial, Node, Scene, VisualScene};

/// Grid-quantized vertex welder.
///
/// Keys on `(v / tol).round()`, which is what meshup's own Rust welder does. Note the
/// classic caveat: two points closer than `tol` can still fall either side of a cell
/// boundary and stay unwelded. It never merges points it shouldn't, which is the direction
/// that matters — a missed merge costs bytes, a wrong merge corrupts geometry.
struct Welder
{
    map: HashMap<[i64; 3], u32>,
    data: Vec<f32>,
    tolerance: f32,
}

impl Welder
{
    fn new(tolerance: f32) -> Self
    {
        Welder {
            map: HashMap::new(),
            data: Vec::new(),
            tolerance,
        }
    }

    /// Returns the index of this xyz in the deduplicated buffer, appending it if new.
    fn add(&mut self, x: f32, y: f32, z: f32) -> u32
    {
        // tolerance <= 0 disables welding: every vertex gets its own slot
        if self.tolerance <= 0.0
        {
            let index = (self.data.len() / 3) as u32;
            self.data.extend_from_slice(&[x, y, z]);
            return index;
        }

        let inv = 1.0 / self.tolerance;
        let key = [
            (x as f64 * inv as f64).round() as i64,
            (y as f64 * inv as f64).round() as i64,
            (z as f64 * inv as f64).round() as i64,
        ];

        if let Some(index) = self.map.get(&key)
        {
            return *index;
        }

        let index = (self.data.len() / 3) as u32;
        self.data.extend_from_slice(&[x, y, z]);
        self.map.insert(key, index);
        index
    }
}

fn xyz_params() -> Vec<String>
{
    vec!["X".to_string(), "Y".to_string(), "Z".to_string()]
}

/// True when a welded face ring encloses no meaningful area.
///
/// Catches what a duplicate-vertex pass cannot: a non-adjacent repeat (`0 1 0 2`) or a ring
/// whose points are all collinear. The Newell normal's length is twice the polygon area, and
/// it is weighed against the ring's own bounding extent so the test carries no unit
/// assumption — a millimetre model and a metre model of the same thing get the same answer.
fn is_degenerate(ring: &[(u32, u32)], positions: &[f32]) -> bool
{
    let point = |i: usize| -> [f64; 3] {
        let p = ring[i].0 as usize * 3;
        [positions[p] as f64, positions[p + 1] as f64, positions[p + 2] as f64]
    };

    let (mut nx, mut ny, mut nz) = (0.0f64, 0.0f64, 0.0f64);
    let mut lo = [f64::MAX; 3];
    let mut hi = [f64::MIN; 3];

    for i in 0..ring.len()
    {
        let a = point(i);
        let b = point((i + 1) % ring.len());
        nx += (a[1] - b[1]) * (a[2] + b[2]);
        ny += (a[2] - b[2]) * (a[0] + b[0]);
        nz += (a[0] - b[0]) * (a[1] + b[1]);
        for k in 0..3 { lo[k] = lo[k].min(a[k]); hi[k] = hi[k].max(a[k]); }
    }

    let extent = (0..3).map(|k| hi[k] - lo[k]).fold(0.0f64, f64::max);
    // twice the area <= 1e-10 * extent^2; on a 1 m face that is an area under 1e-4 mm^2
    nx.hypot(ny).hypot(nz) <= 1e-10 * extent * extent
}

/// The material symbol every primitive declares.
///
/// In COLLADA the symbol is scoped to the geometry and only resolved to a real material at
/// instance time, via `<instance_material symbol=… target=…>`. That is what lets one
/// geometry be instanced twice with different materials — and it is why the primitive needs
/// a symbol even though the geometry itself has no idea which material it will get.
const MATERIAL_SYMBOL: &str = "material";

/// Preferred id for the single `<visual_scene>`, uniquified at serialization time.
///
/// Every `id` in COLLADA is an `xs:ID`, so `<visual_scene>`, `<node>`, `<geometry>` and
/// `<material>` all share ONE document-wide namespace. A caller whose root node is also
/// called "Scene" would otherwise emit the id twice, which both fails schema validation and
/// makes `<instance_visual_scene url="#Scene">` ambiguous — a strict importer can resolve it
/// to the `<node>` and find no scene at all. SketchUp validates against the 1.4.1 schema on
/// import, so this was fatal there while lenient web viewers happily ignored it.
const VISUAL_SCENE_ID: &str = "Scene";

/// Builds one COLLADA document. See the module docs for the two-phase usage.
#[wasm_bindgen]
pub struct ColladaWriter
{
    asset: Asset,
    effects: Vec<Effect>,
    materials: Vec<Material>,
    geometries: Vec<Geometry>,
    /// Finished top-level nodes.
    roots: Vec<Node>,
    /// Open nodes, innermost last. `end_node()` pops into the parent's children.
    stack: Vec<Node>,
}

#[wasm_bindgen]
impl ColladaWriter
{
    /// `unit_name` is the COLLADA unit name (e.g. "millimeter"), `meter` how many metres one
    /// model unit is (mm -> 0.001). `up_axis` is one of "X_UP" / "Y_UP" / "Z_UP" — Archiyou
    /// passes "Z_UP", since meshup is natively Z-up and COLLADA can say so (unlike glTF).
    /// `created_iso` is an ISO-8601 timestamp; the caller supplies it so this crate needs no
    /// clock (and therefore no chrono).
    #[wasm_bindgen(constructor)]
    pub fn new(unit_name: &str, meter: f64, up_axis: &str, created_iso: &str) -> ColladaWriter
    {
        #[cfg(feature = "console_error_panic_hook")]
        console_error_panic_hook::set_once();

        let up = match up_axis
        {
            "X_UP" => UpAxis::XUp,
            "Y_UP" => UpAxis::YUp,
            _ => UpAxis::ZUp,
        };

        let asset = Asset {
            contributors: vec![Contributor::default()],
            created: created_iso.to_string(),
            keywords: None,
            modified: created_iso.to_string(),
            revision: None,
            subject: None,
            title: None,
            unit: Unit {
                name: unit_name.to_string(),
                meter,
            },
            up_axis: Some(up),
        };

        ColladaWriter {
            asset,
            effects: Vec::new(),
            materials: Vec::new(),
            geometries: Vec::new(),
            roots: Vec::new(),
            stack: Vec::new(),
        }
    }

    //// MATERIALS ////

    /// Register a material. `id` is what `attach_geometry()` references. RGBA is 0..1.
    #[wasm_bindgen(js_name = addMaterial)]
    pub fn add_material(&mut self, id: &str, name: &str, r: f32, g: f32, b: f32, a: f32)
    {
        let effect_id = format!("{}-effect", id);
        self.effects.push(Effect {
            id: effect_id.clone(),
            diffuse: [r, g, b, a],
        });
        self.materials.push(Material {
            id: id.to_string(),
            name: name.to_string(),
            effect_id,
        });
    }

    //// GEOMETRY (flat library_geometries) ////

    /// N-gon faces -> `<polylist>`. `positions`/`normals` are per face-vertex (interleaved
    /// xyz, unwelded, in face order); `vcount[i]` is the vertex count of face i.
    ///
    /// This is the default mesh path: it preserves meshup's n-gon topology, where
    /// `Mesh.toBuffer()` would have flattened it into a triangle soup.
    ///
    /// Returns false when nothing survived and no `<geometry>` was emitted, so the caller
    /// knows not to reference it.
    #[wasm_bindgen(js_name = addPolylistGeometry)]
    pub fn add_polylist_geometry(
        &mut self,
        id: &str,
        name: &str,
        positions: &[f32],
        normals: &[f32],
        vcount: &[u32],
        weld_tolerance: f32,
    ) -> bool
    {
        let face_vertex_count: u32 = vcount.iter().sum();
        let has_normals = normals.len() >= (face_vertex_count as usize) * 3;

        // Positions and normals weld independently into separate sources with separate
        // <input offset>s — the standard COLLADA layout, and where most of the size win is:
        // a cube collapses from 36 loose vertices to 8 positions and 6 normals.
        let mut pos_welder = Welder::new(weld_tolerance);
        let mut norm_welder = Welder::new(weld_tolerance);
        let mut primitive: Vec<u32> = Vec::with_capacity(face_vertex_count as usize * 2);
        let mut out_vcount: Vec<u32> = Vec::with_capacity(vcount.len());

        let mut cursor = 0usize;
        for &n in vcount
        {
            // Weld the whole ring first: the duplicate test below has to see POST-weld
            // identity, since that is what collapses two near-coincident vertices onto one
            // index (as does the f32 conversion on the way in — at metre-scale coordinates
            // an f32 only resolves ~0.2 µm).
            let mut ring: Vec<(u32, u32)> = Vec::with_capacity(n as usize);
            for k in 0..(n as usize)
            {
                let p = (cursor + k) * 3;
                if p + 2 >= positions.len() { break; }
                let pos = pos_welder.add(positions[p], positions[p + 1], positions[p + 2]);
                let nor = if has_normals
                    { norm_welder.add(normals[p], normals[p + 1], normals[p + 2]) } else { 0 };
                ring.push((pos, nor));
            }
            cursor += n as usize;

            // Drop face-vertices that repeat their predecessor, cyclically. Welding a mitred
            // solid turns its sliver faces into pinched rings like `0 1 2 3 0` (a quad
            // written as a 5-gon) or outright degenerate ones like `0 0 4 4`. Both are
            // meaningless, and an importer that builds real faces — SketchUp does — can
            // refuse the whole file over them.
            ring.dedup_by(|a, b| a.0 == b.0);
            if ring.len() > 1 && ring[0].0 == ring[ring.len() - 1].0 { ring.pop(); }

            if ring.len() < 3 { continue; }
            if is_degenerate(&ring, &pos_welder.data) { continue; }

            out_vcount.push(ring.len() as u32);
            for (pos, nor) in ring
            {
                primitive.push(pos);
                if has_normals { primitive.push(nor); }
            }
        }

        // Every face was degenerate — emitting an empty <polylist> would leave the caller
        // pointing at a geometry with nothing in it.
        if out_vcount.is_empty() { return false; }

        let polylist = Polylist {
            vertices: format!("#{}-vertices", id),
            normals: if has_normals { Some(format!("#{}-normals", id)) } else { None },
            vcount: out_vcount,
            primitive,
            material: Some(MATERIAL_SYMBOL.to_string()),
        };

        self.push_geometry(id, name, pos_welder, norm_welder, has_normals, Some(polylist), None, None);
        true
    }

    /// Raw indexed triangles -> `<triangles>`. The `ngons: false` fallback path, fed
    /// straight from meshup's `Mesh.toBuffer()`.
    ///
    /// Returns false when nothing survived and no `<geometry>` was emitted.
    #[wasm_bindgen(js_name = addMeshGeometry)]
    pub fn add_mesh_geometry(
        &mut self,
        id: &str,
        name: &str,
        positions: &[f32],
        normals: &[f32],
        indices: &[u32],
        weld_tolerance: f32,
    ) -> bool
    {
        let has_normals = normals.len() >= positions.len();

        let mut pos_welder = Welder::new(weld_tolerance);
        let mut norm_welder = Welder::new(weld_tolerance);
        let mut primitive: Vec<usize> = Vec::with_capacity(indices.len() * 2);

        // Triangle at a time, so a corner collapsed by welding takes only its own triangle
        // out rather than shifting every index after it.
        for triangle in indices.chunks_exact(3)
        {
            let mut corners: Vec<(u32, u32)> = Vec::with_capacity(3);
            for index in triangle
            {
                let p = (*index as usize) * 3;
                if p + 2 >= positions.len() { break; }
                let pos = pos_welder.add(positions[p], positions[p + 1], positions[p + 2]);
                let nor = if has_normals
                    { norm_welder.add(normals[p], normals[p + 1], normals[p + 2]) } else { 0 };
                corners.push((pos, nor));
            }

            if corners.len() < 3 { continue; }
            // two corners welded together leaves a line, not a triangle
            if corners[0].0 == corners[1].0 || corners[1].0 == corners[2].0 || corners[0].0 == corners[2].0
            {
                continue;
            }

            for (pos, nor) in corners
            {
                primitive.push(pos as usize);
                if has_normals { primitive.push(nor as usize); }
            }
        }

        if primitive.is_empty() { return false; }

        let triangles = Triangles {
            vertices: format!("#{}-vertices", id),
            tex_vertices: None,
            normals: if has_normals { Some(format!("#{}-normals", id)) } else { None },
            primitive: Some(primitive),
            material: Some(MATERIAL_SYMBOL.to_string()),
        };

        self.push_geometry(id, name, pos_welder, norm_welder, has_normals, None, Some(triangles), None);
        true
    }

    /// A tessellated polyline -> `<lines>`. `positions` is a flat xyz point run; it is
    /// expanded into (n-1) two-index segments.
    ///
    /// Returns false when there was no polyline to write and no `<geometry>` was emitted.
    #[wasm_bindgen(js_name = addLinesGeometry)]
    pub fn add_lines_geometry(&mut self, id: &str, name: &str, positions: &[f32]) -> bool
    {
        let point_count = positions.len() / 3;
        if point_count < 2 { return false; }

        // Curves are welded losslessly (tolerance 0) — collapsing near-coincident points on
        // a polyline would silently drop segments.
        let mut pos_welder = Welder::new(0.0);
        let mut indices: Vec<u32> = Vec::with_capacity(point_count);
        for i in 0..point_count
        {
            let p = i * 3;
            indices.push(pos_welder.add(positions[p], positions[p + 1], positions[p + 2]));
        }

        let mut primitive: Vec<u32> = Vec::with_capacity((point_count - 1) * 2);
        for i in 0..(point_count - 1)
        {
            primitive.push(indices[i]);
            primitive.push(indices[i + 1]);
        }

        let lines = Lines {
            vertices: format!("#{}-vertices", id),
            primitive,
            material: Some(MATERIAL_SYMBOL.to_string()),
        };

        let norm_welder = Welder::new(0.0);
        self.push_geometry(id, name, pos_welder, norm_welder, false, None, None, Some(lines));
        true
    }

    //// SCENE TREE (library_visual_scenes) ////

    /// Open a `<node>`. Nodes nest: every `begin_node` must be matched by an `end_node`.
    #[wasm_bindgen(js_name = beginNode)]
    pub fn begin_node(&mut self, id: &str, name: &str)
    {
        self.stack.push(Node {
            id: id.to_string(),
            name: name.to_string(),
            // meshup bakes all transforms into the geometry, so every node is identity and
            // the positions are already world-space.
            transformation_elements: Vec::new(),
            instances: Vec::new(),
            children: Vec::new(),
        });
    }

    /// Attach an `<instance_geometry>` (optionally material-bound) to the open node.
    #[wasm_bindgen(js_name = attachGeometry)]
    pub fn attach_geometry(&mut self, geom_id: &str, material_id: Option<String>)
    {
        let bind_material = material_id.map(|mat| BindMaterial {
            instance_materials: vec![InstanceMaterial {
                symbol: MATERIAL_SYMBOL.to_string(),
                target: format!("#{}", mat),
            }],
        });

        if let Some(node) = self.stack.last_mut()
        {
            node.instances.push(Instance::Geometry {
                url: format!("#{}", geom_id),
                name: None,
                sid: None,
                bind_material,
            });
        }
    }

    /// Close the open `<node>`, appending it to its parent (or to the scene roots).
    #[wasm_bindgen(js_name = endNode)]
    pub fn end_node(&mut self)
    {
        if let Some(node) = self.stack.pop()
        {
            match self.stack.last_mut()
            {
                Some(parent) => parent.children.push(node),
                None => self.roots.push(node),
            }
        }
    }

    //// OUTPUT ////

    /// Serialize the document. Errors on unbalanced `begin_node`/`end_node`.
    ///
    /// The error is a plain `String` rather than a `JsError` so this stays callable from
    /// native `cargo test` — constructing a `JsError` panics off-wasm. `ColladaWriter.ts`
    /// turns it back into a real `Error` on the JS side.
    #[wasm_bindgen(js_name = toStringDae)]
    pub fn to_string_dae(&self) -> std::result::Result<String, String>
    {
        if !self.stack.is_empty()
        {
            return Err(format!(
                "ColladaWriter: {} node(s) left open — every beginNode() needs a matching endNode()",
                self.stack.len()
            ));
        }

        let scene_id = self.unique_visual_scene_id();

        let doc = Collada {
            asset: self.asset.clone(),
            effects: if self.effects.is_empty() { None } else { Some(self.effects.clone()) },
            materials: if self.materials.is_empty() { None } else { Some(self.materials.clone()) },
            geometries: if self.geometries.is_empty() { None } else { Some(self.geometries.clone()) },
            visual_scenes: Some(vec![VisualScene {
                id: scene_id.clone(),
                name: VISUAL_SCENE_ID.to_string(),
                nodes: self.roots.clone(),
            }]),
            scene: Some(Scene {
                visual_scenes: vec![format!("#{}", scene_id)],
            }),
        };

        let mut buffer: Vec<u8> = Vec::new();
        doc.write_to(&mut buffer)
            .map_err(|e| format!("ColladaWriter: XML write failed: {}", e))?;

        String::from_utf8(buffer)
            .map_err(|e| format!("ColladaWriter: output was not valid UTF-8: {}", e))
    }
}

// Helpers kept out of the #[wasm_bindgen] impl block: wasm-bindgen only exports methods whose
// signatures it can map to JS, and these take/return vendored Rust types.
impl ColladaWriter
{
    /// `VISUAL_SCENE_ID`, or the first `Scene-1`, `Scene-2`, … that no other element in the
    /// document has already claimed. See `VISUAL_SCENE_ID` for why this matters.
    fn unique_visual_scene_id(&self) -> String
    {
        fn collect_node_ids(nodes: &[Node], out: &mut HashSet<String>)
        {
            for node in nodes
            {
                out.insert(node.id.clone());
                collect_node_ids(&node.children, out);
            }
        }

        let mut used: HashSet<String> = HashSet::new();
        collect_node_ids(&self.roots, &mut used);
        for effect in &self.effects { used.insert(effect.id.clone()); }
        for material in &self.materials { used.insert(material.id.clone()); }
        for geometry in &self.geometries
        {
            if let Some(id) = &geometry.id { used.insert(id.clone()); }
            used.insert(geometry.mesh.vertices.id.clone());
            for source in &geometry.mesh.sources
            {
                used.insert(source.id.clone());
                used.insert(source.float_array.id.clone());
            }
        }

        if !used.contains(VISUAL_SCENE_ID) { return VISUAL_SCENE_ID.to_string(); }

        let mut n = 1;
        loop
        {
            let candidate = format!("{}-{}", VISUAL_SCENE_ID, n);
            if !used.contains(&candidate) { return candidate; }
            n += 1;
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn push_geometry(
        &mut self,
        id: &str,
        name: &str,
        pos_welder: Welder,
        norm_welder: Welder,
        has_normals: bool,
        polylist: Option<Polylist>,
        triangles: Option<Triangles>,
        lines: Option<Lines>,
    )
    {
        let mut sources = vec![Source {
            id: format!("{}-positions", id),
            float_array: FloatArray {
                id: format!("{}-positions-array", id),
                data: pos_welder.data,
            },
            accessor: Accessor { params: xyz_params() },
        }];

        if has_normals
        {
            sources.push(Source {
                id: format!("{}-normals", id),
                float_array: FloatArray {
                    id: format!("{}-normals-array", id),
                    data: norm_welder.data,
                },
                accessor: Accessor { params: xyz_params() },
            });
        }

        self.geometries.push(Geometry {
            id: Some(id.to_string()),
            name: Some(name.to_string()),
            mesh: Mesh {
                sources,
                vertices: Vertices {
                    id: format!("{}-vertices", id),
                    name: None,
                    source: format!("#{}-positions", id),
                },
                triangles,
                polylist,
                lines,
            },
        });
    }
}
