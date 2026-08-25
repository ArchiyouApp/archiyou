// Native smoke tests for the COLLADA writer. The `#[wasm_bindgen]` API is plain Rust apart
// from the JS glue, so it can be exercised on the host target — same approach as
// packages/gdrr2bp-wasm/tests/smoke.rs.

use collada_wasm::ColladaWriter;

fn writer() -> ColladaWriter
{
    ColladaWriter::new("millimeter", 0.001, "Z_UP", "2026-07-27T00:00:00Z")
}

/// One unit quad, as four face-vertices with a shared +Z normal.
fn add_quad(w: &mut ColladaWriter, id: &str)
{
    let positions: Vec<f32> = vec![
        0.0, 0.0, 0.0,
        1.0, 0.0, 0.0,
        1.0, 1.0, 0.0,
        0.0, 1.0, 0.0,
    ];
    let normals: Vec<f32> = vec![
        0.0, 0.0, 1.0,
        0.0, 0.0, 1.0,
        0.0, 0.0, 1.0,
        0.0, 0.0, 1.0,
    ];
    w.add_polylist_geometry(id, id, &positions, &normals, &[4], 1e-5);
}

#[test]
fn writes_a_valid_looking_document()
{
    let mut w = writer();
    add_quad(&mut w, "quad");
    w.begin_node("node0", "Quad");
    w.attach_geometry("quad", None);
    w.end_node();

    let dae = w.to_string_dae().expect("write failed");

    assert!(dae.contains(r##"<?xml version="1.0" encoding="utf-8"?>"##), "missing xml decl");
    assert!(dae.contains(r##"<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1""##));

    // P1: the spec attribute is `name`, not upstream's `unit`
    assert!(dae.contains(r##"<unit name="millimeter" meter="0.001" />"##), "unit element wrong:\n{}", dae);
    // P2: xs:dateTime, not RFC2822
    assert!(dae.contains("<created>2026-07-27T00:00:00Z</created>"));
    assert!(!dae.contains("+0000"), "looks like an RFC2822 date leaked in");
    // meshup is Z-up and COLLADA can say so
    assert!(dae.contains("<up_axis>Z_UP</up_axis>"));

    assert!(dae.contains(r##"<geometry id="quad" name="quad">"##));
    assert!(dae.contains(r##"<instance_visual_scene url="#Scene" />"##));
}

#[test]
fn polylist_preserves_ngons_and_welds_vertices()
{
    // Two quads sharing an edge: 8 loose face-vertices, but only 6 distinct positions
    // and 1 distinct normal once welded.
    let positions: Vec<f32> = vec![
        // face 0
        0.0, 0.0, 0.0,
        1.0, 0.0, 0.0,
        1.0, 1.0, 0.0,
        0.0, 1.0, 0.0,
        // face 1, sharing the x=1 edge
        1.0, 0.0, 0.0,
        2.0, 0.0, 0.0,
        2.0, 1.0, 0.0,
        1.0, 1.0, 0.0,
    ];
    let normals: Vec<f32> = std::iter::repeat([0.0f32, 0.0, 1.0]).take(8).flatten().collect();

    let mut w = writer();
    w.add_polylist_geometry("plate", "Plate", &positions, &normals, &[4, 4], 1e-5);
    w.begin_node("n", "Plate");
    w.attach_geometry("plate", None);
    w.end_node();
    let dae = w.to_string_dae().expect("write failed");

    // n-gons survive: two faces of four vertices, NOT four triangles
    assert!(dae.contains(r##"<polylist material="material" count="2">"##), "expected 2 n-gon faces:\n{}", dae);
    assert!(dae.contains("<vcount>4 4</vcount>"), "expected quad vcounts:\n{}", dae);
    assert!(!dae.contains("<triangles"), "n-gon path must not emit triangles");

    // welding: 6 unique positions (18 floats), 1 unique normal (3 floats)
    assert!(dae.contains(r##"<float_array id="plate-positions-array" count="18">"##),
        "positions did not weld to 6:\n{}", dae);
    assert!(dae.contains(r##"<float_array id="plate-normals-array" count="3">"##),
        "normals did not weld to 1:\n{}", dae);

    // the <p> stream interleaves (vertex, normal) pairs — 8 face-vertices => 16 indices
    let p_start = dae.find("<p>").unwrap() + 3;
    let p_end = dae[p_start..].find("</p>").unwrap() + p_start;
    let indices: Vec<&str> = dae[p_start..p_end].split_whitespace().collect();
    assert_eq!(indices.len(), 16, "expected 16 interleaved indices, got {:?}", indices);
    // every normal index is 0 (only one distinct normal), and the shared edge reuses
    // position indices 1 and 2
    let vertex_indices: Vec<&str> = indices.iter().step_by(2).copied().collect();
    assert_eq!(vertex_indices, vec!["0", "1", "2", "3", "1", "4", "5", "2"]);
}

#[test]
fn weld_tolerance_zero_disables_welding()
{
    let positions: Vec<f32> = vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0];
    let normals: Vec<f32> = std::iter::repeat([0.0f32, 0.0, 1.0]).take(4).flatten().collect();

    let mut w = writer();
    w.add_polylist_geometry("q", "Q", &positions, &normals, &[4], 0.0);
    w.begin_node("n", "Q");
    w.attach_geometry("q", None);
    w.end_node();
    let dae = w.to_string_dae().expect("write failed");

    // all four normals kept as separate entries
    assert!(dae.contains(r##"<float_array id="q-normals-array" count="12">"##),
        "tolerance 0 should not weld:\n{}", dae);
}

#[test]
fn nodes_nest()
{
    let mut w = writer();
    add_quad(&mut w, "quad");

    w.begin_node("outer", "Outer");
    w.attach_geometry("quad", None);
    w.begin_node("inner", "Inner");
    w.attach_geometry("quad", None);
    w.end_node();
    w.end_node();

    let dae = w.to_string_dae().expect("write failed");

    let outer = dae.find(r##"<node id="outer""##).expect("no outer node");
    let inner = dae.find(r##"<node id="inner""##).expect("no inner node");
    let outer_instance = dae.find(r##"<instance_geometry url="#quad""##).expect("no instance");
    let outer_close = dae.rfind("</node>").expect("no node close");

    assert!(outer < inner, "inner node must be written inside outer");
    assert!(inner < outer_close, "inner node must close before outer");
    // P7: children come AFTER the instances, per the 1.4.1 content model
    assert!(outer_instance < inner, "instances must precede child nodes");
}

/// Welding collapses near-coincident face-vertices onto one index, which turns the sliver
/// faces of a mitred solid into pinched rings ('0 1 2 3 0' — a quad written as a 5-gon) and
/// outright degenerate ones ('0 0 4 4'). Both have to be repaired or dropped: an importer
/// that builds real faces can refuse the whole file over them.
#[test]
fn welding_repairs_pinched_rings_and_drops_degenerate_faces()
{
    let mut w = writer();

    // A unit quad whose 5th vertex sits a nanometre from the 1st (so it welds onto it),
    // followed by a face that is really just an edge — both corners doubled.
    let positions: Vec<f32> = vec![
        0.0, 0.0, 0.0,
        1.0, 0.0, 0.0,
        1.0, 1.0, 0.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1e-9,   // welds onto vertex 0

        0.0, 0.0, 0.0,    // the degenerate face: two distinct points, each twice
        0.0, 0.0, 0.0,
        1.0, 0.0, 0.0,
        1.0, 0.0, 0.0,
    ];
    let normals: Vec<f32> = vec![0.0, 0.0, 1.0].repeat(9);

    assert!(w.add_polylist_geometry("mesh", "mesh", &positions, &normals, &[5, 4], 1e-5));
    w.begin_node("node0", "Mesh");
    w.attach_geometry("mesh", None);
    w.end_node();

    let dae = w.to_string_dae().expect("write failed");

    // the 5-gon is back to a quad, and the edge-as-a-face is gone
    assert!(dae.contains("<vcount>4</vcount>"), "expected a single repaired quad:\n{}", dae);
    assert!(dae.contains(r##"<polylist material="material" count="1">"##), "{}", dae);
    assert!(dae.contains("<p>0 0 1 0 2 0 3 0</p>"), "unexpected index stream:\n{}", dae);
}

/// A mesh with nothing but degenerate faces must report that it wrote no geometry, so the
/// caller does not leave an `<instance_geometry>` pointing at an id that was never emitted.
#[test]
fn a_fully_degenerate_mesh_emits_no_geometry()
{
    let mut w = writer();

    let positions: Vec<f32> = vec![
        0.0, 0.0, 0.0,
        0.0, 0.0, 0.0,
        1.0, 0.0, 0.0,
        1.0, 0.0, 0.0,
    ];
    let normals: Vec<f32> = vec![0.0, 0.0, 1.0].repeat(4);

    assert!(!w.add_polylist_geometry("mesh", "mesh", &positions, &normals, &[4], 1e-5));

    let dae = w.to_string_dae().expect("write failed");
    assert!(!dae.contains("<geometry"), "no geometry should have been written:\n{}", dae);
}

/// Collinear points enclose no area either, and a duplicate-index pass alone cannot see it.
#[test]
fn collinear_faces_are_dropped()
{
    let mut w = writer();

    let positions: Vec<f32> = vec![
        0.0, 0.0, 0.0,
        1.0, 0.0, 0.0,
        2.0, 0.0, 0.0,
    ];
    let normals: Vec<f32> = vec![0.0, 0.0, 1.0].repeat(3);

    assert!(!w.add_polylist_geometry("mesh", "mesh", &positions, &normals, &[3], 1e-5));
}

/// The triangle path welds too, so it needs the same guard.
#[test]
fn triangle_path_drops_collapsed_triangles()
{
    let mut w = writer();

    let positions: Vec<f32> = vec![
        0.0, 0.0, 0.0,
        1.0, 0.0, 0.0,
        1.0, 1.0, 0.0,
        1.0, 0.0, 1e-9, // welds onto vertex 1
    ];
    let normals: Vec<f32> = vec![0.0, 0.0, 1.0].repeat(4);

    // triangle 0 is real; triangle 1 has two corners that weld together
    assert!(w.add_mesh_geometry("mesh", "mesh", &positions, &normals, &[0, 1, 2, 1, 3, 2], 1e-5));

    let dae = w.to_string_dae().expect("write failed");
    assert!(dae.contains(r##"<triangles material="material" count="1">"##), "{}", dae);
}

/// `<visual_scene>` and `<node>` share one xs:ID namespace, so the scene id has to give way
/// when a caller already claimed it — otherwise the document is schema-invalid and
/// `<instance_visual_scene url="#Scene">` resolves to the node instead of the scene.
#[test]
fn visual_scene_id_never_collides_with_a_node()
{
    let mut w = writer();
    add_quad(&mut w, "quad");
    w.begin_node("Scene", "root");
    w.attach_geometry("quad", None);
    w.end_node();

    let dae = w.to_string_dae().expect("write failed");

    assert!(dae.contains(r##"<node id="Scene""##), "the caller keeps its id:\n{}", dae);
    assert!(dae.contains(r##"<visual_scene id="Scene-1""##), "scene id must move aside:\n{}", dae);
    assert!(dae.contains(r##"<instance_visual_scene url="#Scene-1" />"##), "scene ref must follow:\n{}", dae);
    assert_eq!(dae.matches(r##"id="Scene""##).count(), 1, "duplicate xs:ID:\n{}", dae);
}

/// The uncontested case still uses the plain name every other exporter emits.
#[test]
fn visual_scene_keeps_its_default_id_when_free()
{
    let mut w = writer();
    add_quad(&mut w, "quad");
    w.begin_node("node0", "Quad");
    w.attach_geometry("quad", None);
    w.end_node();

    let dae = w.to_string_dae().expect("write failed");
    assert!(dae.contains(r##"<visual_scene id="Scene" name="Scene">"##), "{}", dae);
    assert!(dae.contains(r##"<instance_visual_scene url="#Scene" />"##), "{}", dae);
}

#[test]
fn materials_are_bound_by_symbol()
{
    let mut w = writer();
    w.add_material("mat_red", "Red", 1.0, 0.0, 0.0, 1.0);
    add_quad(&mut w, "quad");
    w.begin_node("n", "Quad");
    w.attach_geometry("quad", Some("mat_red".to_string()));
    w.end_node();

    let dae = w.to_string_dae().expect("write failed");

    assert!(dae.contains(r##"<effect id="mat_red-effect">"##));
    assert!(dae.contains("<color sid=\"diffuse\">1 0 0 1</color>"), "diffuse colour missing:\n{}", dae);
    assert!(dae.contains(r##"<material id="mat_red" name="Red">"##));
    assert!(dae.contains(r##"<instance_effect url="#mat_red-effect" />"##));
    // P5: upstream never emitted this at all
    assert!(dae.contains(r##"<instance_material symbol="material" target="#mat_red" />"##),
        "bind_material missing:\n{}", dae);
    // the symbol on the primitive must match the one bound above, or the bind dangles
    assert!(dae.contains(r##"<polylist material="material""##));

    // library_effects must precede library_materials, which precede library_geometries
    let fx = dae.find("<library_effects>").unwrap();
    let mats = dae.find("<library_materials>").unwrap();
    let geo = dae.find("<library_geometries>").unwrap();
    assert!(fx < mats && mats < geo, "library order is wrong");
}

#[test]
fn transparent_material_declares_transparency()
{
    let mut w = writer();
    w.add_material("glass", "Glass", 0.5, 0.5, 1.0, 0.25);
    let dae = w.to_string_dae().expect("write failed");

    assert!(dae.contains(r##"<transparent opaque="A_ONE">"##), "no transparency block:\n{}", dae);
    assert!(dae.contains("<transparency>"));
}

#[test]
fn lines_become_segments()
{
    // a 4-point polyline => 3 segments
    let positions: Vec<f32> = vec![
        0.0, 0.0, 0.0,
        1.0, 0.0, 0.0,
        1.0, 1.0, 0.0,
        0.0, 1.0, 0.0,
    ];

    let mut w = writer();
    w.add_lines_geometry("curve", "Curve", &positions);
    w.begin_node("n", "Curve");
    w.attach_geometry("curve", None);
    w.end_node();
    let dae = w.to_string_dae().expect("write failed");

    assert!(dae.contains(r##"count="3">"##), "expected 3 segments:\n{}", dae);
    assert!(dae.contains("<p>0 1 1 2 2 3</p>"), "segment index stream wrong:\n{}", dae);
    // a line geometry has positions but no normal source
    assert!(!dae.contains("curve-normals-array"), "lines should not emit normals");
}

#[test]
fn triangle_fallback_path_still_works()
{
    // two triangles forming a quad, indexed - the `ngons: false` path
    let positions: Vec<f32> = vec![
        0.0, 0.0, 0.0,
        1.0, 0.0, 0.0,
        1.0, 1.0, 0.0,
        0.0, 1.0, 0.0,
    ];
    let normals: Vec<f32> = std::iter::repeat([0.0f32, 0.0, 1.0]).take(4).flatten().collect();
    let indices: Vec<u32> = vec![0, 1, 2, 0, 2, 3];

    let mut w = writer();
    w.add_mesh_geometry("tri", "Tri", &positions, &normals, &indices, 1e-5);
    w.begin_node("n", "Tri");
    w.attach_geometry("tri", None);
    w.end_node();
    let dae = w.to_string_dae().expect("write failed");

    assert!(dae.contains(r##"count="2">"##), "expected 2 triangles:\n{}", dae);
    assert!(dae.contains("<triangles"));
    assert!(!dae.contains("<polylist"), "fallback path must not emit a polylist");
}

#[test]
fn unbalanced_nodes_are_an_error()
{
    let mut w = writer();
    w.begin_node("orphan", "Orphan");
    assert!(w.to_string_dae().is_err(), "an unclosed node should be rejected");
}

#[test]
fn empty_document_is_still_well_formed()
{
    let w = writer();
    let dae = w.to_string_dae().expect("write failed");
    assert!(dae.contains("</COLLADA>"));
    assert!(!dae.contains("<library_geometries>"), "no geometry => no library");
}
