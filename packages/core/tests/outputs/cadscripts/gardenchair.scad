// Archiyou -> OpenSCAD  |  script: gardenchair  |  units: mm
// OpenSCAD has no units: coordinates are in mm.
// Parts: 22 CSG, 1 baked, 1 2D
//   baked: Mesh (made by flatten())
// Skipped: sideSeatingCutoffLine (open curve)
// Parameters at export, for reference only (nothing in this file is linked to them):
//   WIDTH = 525
//   BEAM_WIDTH = 90
//   BEAM_THICKNESS = 13

$fn = 32;
PART = "";

// sideSeatingBeam  (layer side)
module sideSeatingBeam() {
    color([0, 0.502, 0]) multmatrix([[0, 0, 1, 0], [0.998629534755, 0.0523359562429, 0, -149.794430213], [-0.0523359562429, 0.998629534755, 0, 357.850393436], [0, 0, 0, 1]]) linear_extrude(height = 13) polygon([[0, 0], [788.851355522, 0], [837.971695137, -90], [154.716700135, -90], [0, -45]]);
}

// sideBackBeam  (layer side)
module sideBackBeam() {
    color([0, 0.502, 0]) multmatrix([[0, 0, 1, -26], [0.358367949545, -0.933580426497, 0, 315.607404645], [0.933580426497, 0.358367949545, 0, 243.336205657], [0, 0, 0, 1]]) linear_extrude(height = 13) polygon([[0, 0], [544.631600181, 0], [544.631600181, -45], [427.40259227, -90], [29.2427726609, -90]]);
}

// sideBackSupportBeam  (layer side)
module sideBackSupportBeam() {
    color([0, 0.502, 0]) difference() {
        multmatrix([[0, 0, -1, 0], [0.432477594418, -0.901644680751, 0, 430.153125812], [-0.901644680751, -0.432477594418, 0, 541.738011277], [0, 0, 0, 1]]) linear_extrude(height = 13) polygon([[0, 0], [600.833147294, 0], [644.002018945, -90], [-85.034716999, -90]]);
        multmatrix([[-1, 0, 0, 0], [0, -0.432477594418, 0.901644680751, 637.975831942], [0, 0.901644680751, 0.432477594418, 316.565103412], [0, 0, 0, 1]]) linear_extrude(height = 13) polygon([[0, 0], [499, 0], [499, -90], [0, -90]]);
    }
}

// sideBeamDepth  (layer side)
module sideBeamDepth() {
    color([0, 0.502, 0]) multmatrix([[0, 0, 1, 0], [1, 0, 0, 0], [0, 1, 0, 15], [0, 0, 0, 1]]) linear_extrude(height = 13) polygon([[0, 0], [782.622779091, 0], [739.453907441, 90], [0, 90]]);
}

// sideLegFront  (layer side)
module sideLegFront() {
    color([0, 0.502, 0]) difference() {
        multmatrix([[0, 0, -1, 0], [0, -1, 0, 0], [-1, 0, 0, 350], [0, 0, 0, 1]]) linear_extrude(height = 13) polygon([[0, 0], [350, 0], [350, -90], [4.71670013547, -90]]);
        multmatrix([[0, 0, -1, 0], [1, 0, 0, 0], [0, -1, 0, 156.87648886], [0, 0, 0, 1]]) linear_extrude(height = 499) polygon([[0, 0], [13, 0], [13, -90], [0, -90]]);
    }
}

// sideSeatingBeam  (layer side)
module sideSeatingBeam_2() {
    color([0, 0.502, 0]) intersection() {
        multmatrix([[0, 0, 1, -13], [0.998629534755, 0.0523359562429, 0, -149.794430213], [-0.0523359562429, 0.998629534755, 0, 357.850393436], [0, 0, 0, 1]]) linear_extrude(height = 13) polygon([[0, 0], [788.851355522, 0], [837.971695137, -90], [154.716700135, -90], [0, -45]]);
        multmatrix([[0, 0, 1, -13], [0.358367949545, -0.933580426497, 0, 315.607404645], [0.933580426497, 0.358367949545, 0, 243.336205657], [0, 0, 0, 1]]) linear_extrude(height = 13) polygon([[0, 0], [544.631600181, 0], [544.631600181, -45], [427.40259227, -90], [29.2427726609, -90]]);
    }
}

// longBeamFront  (layer longitudinal)
module longBeamFront() {
    color([1, 0, 0]) multmatrix([[0, 0, -1, 0], [1, 0, 0, 0], [0, -1, 0, 156.87648886], [0, 0, 0, 1]]) linear_extrude(height = 499) polygon([[0, 0], [13, 0], [13, -90], [0, -90]]);
}

// longBeamBack  (layer longitudinal)
module longBeamBack() {
    color([1, 0, 0]) multmatrix([[-1, 0, 0, 0], [0, -0.432477594418, 0.901644680751, 637.975831942], [0, 0.901644680751, 0.432477594418, 316.565103412], [0, 0, 0, 1]]) linear_extrude(height = 13) polygon([[0, 0], [499, 0], [499, -90], [0, -90]]);
}

// Mesh  (layer longitudinal): baked, made by flatten()
module Mesh() {
    color([1, 0, 0]) polyhedron(
        points = [[0, 0, 350], [0, 0, 0], [0, 90, 0], [0, 90, 345.283299865]],
        faces = [[3, 2, 1, 0], [1, 2, 3, 0]]
    );
}

// Mesh  (layer longitudinal): 2D, a surface without volume, drawn in its own plane: origin [0, 789.817591033, 0], x [0, -0.432477594418, 0.901644680751], y [0, -0.901644680751, -0.432477594418]
module Mesh_2() {
    color([1, 0, 0]) polygon([[0, 0], [729.036735944, 0], [644.002018945, 90], [43.1688716504, 90]]);
}

// Mesh:Box  (layer seat)
module Mesh_Box() {
    color([0, 0, 1]) multmatrix([[1, 0, 0, -249.5], [0, 0.998629534755, 0.0523359562429, -117.444702073], [0, -0.0523359562429, 0.998629534755, 363.345237404], [0, 0, 0, 1]]) cube([525, 90, 13], center = true);
}

// Mesh:Box  (layer seat)
module Mesh_Box_2() {
    color([0, 0, 1]) multmatrix([[1, 0, 0, -249.5], [0, 0.998629534755, 0.0523359562429, -22.5748962718], [0, -0.0523359562429, 0.998629534755, 358.373321561], [0, 0, 0, 1]]) cube([525, 90, 13], center = true);
}

// Mesh:Box  (layer seat)
module Mesh_Box_3() {
    color([0, 0, 1]) multmatrix([[1, 0, 0, -249.5], [0, 0.998629534755, 0.0523359562429, 72.2949095299], [0, -0.0523359562429, 0.998629534755, 353.401405718], [0, 0, 0, 1]]) cube([525, 90, 13], center = true);
}

// Mesh:Box  (layer seat)
module Mesh_Box_4() {
    color([0, 0, 1]) multmatrix([[1, 0, 0, -249.5], [0, 0.998629534755, 0.0523359562429, 167.164715332], [0, -0.0523359562429, 0.998629534755, 348.429489875], [0, 0, 0, 1]]) cube([525, 90, 13], center = true);
}

// Mesh:Box  (layer seat)
module Mesh_Box_5() {
    color([0, 0, 1]) multmatrix([[1, 0, 0, -249.5], [0, 0.998629534755, 0.0523359562429, 262.034521133], [0, -0.0523359562429, 0.998629534755, 343.457574032], [0, 0, 0, 1]]) cube([525, 90, 13], center = true);
}

// Mesh:Box  (layer seat)
module Mesh_Box_6() {
    color([0, 0, 1]) multmatrix([[1, 0, 0, -249.5], [0, 0.358367949545, -0.933580426497, 391.115001681], [0, 0.933580426497, 0.358367949545, 458.178003711], [0, 0, 0, 1]]) cube([525, 90, 13], center = true);
}

// Mesh:Box  (layer seat)
module Mesh_Box_7() {
    color([0, 0, 1]) multmatrix([[1, 0, 0, -249.5], [0, 0.358367949545, -0.933580426497, 425.159956888], [0, 0.933580426497, 0.358367949545, 546.868144228], [0, 0, 0, 1]]) cube([525, 90, 13], center = true);
}

// Mesh:Box  (layer seat)
module Mesh_Box_8() {
    color([0, 0, 1]) multmatrix([[1, 0, 0, -249.5], [0, 0.358367949545, -0.933580426497, 459.204912095], [0, 0.933580426497, 0.358367949545, 635.558284746], [0, 0, 0, 1]]) cube([525, 90, 13], center = true);
}

// Mesh:Box  (layer seat)
module Mesh_Box_9() {
    color([0, 0, 1]) multmatrix([[1, 0, 0, -249.5], [0, 0.358367949545, -0.933580426497, 493.249867302], [0, 0.933580426497, 0.358367949545, 724.248425263], [0, 0, 0, 1]]) cube([525, 90, 13], center = true);
}

// sideSeatingBeam  (layer assembly)
module sideSeatingBeam_3() {
    color([0, 0.502, 0]) multmatrix([[0, 0, -1, -499], [0.998629534755, 0.0523359562429, 0, -149.794430213], [-0.0523359562429, 0.998629534755, 0, 357.850393436], [0, 0, 0, 1]]) linear_extrude(height = 13) polygon([[0, 0], [788.851355522, 0], [837.971695137, -90], [154.716700135, -90], [0, -45]]);
}

// sideBackBeam  (layer assembly)
module sideBackBeam_2() {
    color([0, 0.502, 0]) multmatrix([[0, 0, -1, -473], [0.358367949545, -0.933580426497, 0, 315.607404645], [0.933580426497, 0.358367949545, 0, 243.336205657], [0, 0, 0, 1]]) linear_extrude(height = 13) polygon([[0, 0], [544.631600181, 0], [544.631600181, -45], [427.40259227, -90], [29.2427726609, -90]]);
}

// sideBackSupportBeam  (layer assembly)
module sideBackSupportBeam_2() {
    color([0, 0.502, 0]) difference() {
        multmatrix([[0, 0, 1, -499], [0.432477594418, -0.901644680751, 0, 430.153125812], [-0.901644680751, -0.432477594418, 0, 541.738011277], [0, 0, 0, 1]]) linear_extrude(height = 13) polygon([[0, 0], [600.833147294, 0], [644.002018945, -90], [-85.034716999, -90]]);
        multmatrix([[1, 0, 0, -499], [0, -0.432477594418, 0.901644680751, 637.975831942], [0, 0.901644680751, 0.432477594418, 316.565103412], [0, 0, 0, 1]]) linear_extrude(height = 13) polygon([[0, 0], [499, 0], [499, -90], [0, -90]]);
    }
}

// sideBeamDepth  (layer assembly)
module sideBeamDepth_2() {
    color([0, 0.502, 0]) multmatrix([[0, 0, -1, -499], [1, 0, 0, 0], [0, 1, 0, 15], [0, 0, 0, 1]]) linear_extrude(height = 13) polygon([[0, 0], [782.622779091, 0], [739.453907441, 90], [0, 90]]);
}

// sideLegFront  (layer assembly)
module sideLegFront_2() {
    color([0, 0.502, 0]) difference() {
        multmatrix([[0, 0, 1, -499], [0, -1, 0, 0], [-1, 0, 0, 350], [0, 0, 0, 1]]) linear_extrude(height = 13) polygon([[0, 0], [350, 0], [350, -90], [4.71670013547, -90]]);
        multmatrix([[0, 0, 1, -499], [1, 0, 0, 0], [0, -1, 0, 156.87648886], [0, 0, 0, 1]]) linear_extrude(height = 499) polygon([[0, 0], [13, 0], [13, -90], [0, -90]]);
    }
}

// 3D parts
if (PART == "" || PART == "sideSeatingBeam") sideSeatingBeam();
if (PART == "" || PART == "sideBackBeam") sideBackBeam();
if (PART == "" || PART == "sideBackSupportBeam") sideBackSupportBeam();
if (PART == "" || PART == "sideBeamDepth") sideBeamDepth();
if (PART == "" || PART == "sideLegFront") sideLegFront();
if (PART == "" || PART == "sideSeatingBeam_2") sideSeatingBeam_2();
if (PART == "" || PART == "longBeamFront") longBeamFront();
if (PART == "" || PART == "longBeamBack") longBeamBack();
if (PART == "" || PART == "Mesh") Mesh();
if (PART == "" || PART == "Mesh_Box") Mesh_Box();
if (PART == "" || PART == "Mesh_Box_2") Mesh_Box_2();
if (PART == "" || PART == "Mesh_Box_3") Mesh_Box_3();
if (PART == "" || PART == "Mesh_Box_4") Mesh_Box_4();
if (PART == "" || PART == "Mesh_Box_5") Mesh_Box_5();
if (PART == "" || PART == "Mesh_Box_6") Mesh_Box_6();
if (PART == "" || PART == "Mesh_Box_7") Mesh_Box_7();
if (PART == "" || PART == "Mesh_Box_8") Mesh_Box_8();
if (PART == "" || PART == "Mesh_Box_9") Mesh_Box_9();
if (PART == "" || PART == "sideSeatingBeam_3") sideSeatingBeam_3();
if (PART == "" || PART == "sideBackBeam_2") sideBackBeam_2();
if (PART == "" || PART == "sideBackSupportBeam_2") sideBackSupportBeam_2();
if (PART == "" || PART == "sideBeamDepth_2") sideBeamDepth_2();
if (PART == "" || PART == "sideLegFront_2") sideLegFront_2();
// 2D parts: select one with PART (OpenSCAD cannot render 2D and 3D together)
if (PART == "Mesh_2") Mesh_2();
