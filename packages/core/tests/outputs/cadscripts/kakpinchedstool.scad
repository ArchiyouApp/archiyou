// Archiyou -> OpenSCAD  |  script: kakpinchedstool  |  units: mm
// OpenSCAD has no units: coordinates are in mm.
// Parts: 7 CSG, 0 baked, 1 2D
// Skipped: horizontalSideEdge (open curve), Curve:Line (open curve)
// Parameters at export, for reference only (nothing in this file is linked to them):
//   HEIGHT = 480
//   DEPTH = 270
//   LEG_WIDTH = 45
//   LEG_THICKNESS = 13

$fn = 32;
PART = "";

// Mesh  (layer leg): 2D, a surface without volume, drawn in its own plane: origin [-169.359944411, 0, 195], x [0.139937016816, 0, 0.990160406866], y [0, 1, 0]
module Mesh() {
    color([0, 0.502, 0]) polygon([[0, 0], [274.702965412, 0], [274.702965412, 13], [0, 13], [-196.937787704, 6.5], [-196.937787704, -6.5]]);
}

// horizontalMiddle  (layer horizontals)
module horizontalMiddle() {
    color([1, 0, 0]) difference() {
        multmatrix([[1, 0, 0, -169.359944411], [0, 0, -1, 6.5], [0, 1, 0, 195], [0, 0, 0, 1]]) linear_extrude(height = 13) polygon([[0, 0], [338.719888821, 0], [332.360145781, 45], [6.35974304069, 45]]);
        translate([0, 0, 240]) cube([13, 100, 45], center = true);
    }
}

// horizontalMiddleCrossed  (layer horizontals)
module horizontalMiddleCrossed() {
    color([1, 0, 0]) difference() {
        multmatrix([[0, 0, 1, -6.5], [1, 0, 0, -169.359944411], [0, 1, 0, 195], [0, 0, 0, 1]]) linear_extrude(height = 13) polygon([[0, 0], [338.719888821, 0], [332.360145781, 45], [6.35974304069, 45]]);
        multmatrix([[0, -1, 0, 0], [1, 0, 0, 0], [0, 0, 1, 195], [0, 0, 0, 1]]) cube([13, 100, 45], center = true);
    }
}

// horizontalSeat  (layer horizontals)
module horizontalSeat() {
    color([1, 0, 0]) difference() {
        multmatrix([[0.139937016816, 0.990160406866, 0, -137.278573961], [0, 0, 1, -6.5], [0.990160406866, -0.139937016816, 0, 422], [0, 0, 0, 1]]) linear_extrude(height = 13) polygon([[0, 0], [45.4471817778, 0], [82.0879630659, 259.261285781], [38.4207082258, 271.855617294]]);
        translate([0, 0, 466.822153116]) cube([13, 100, 45], center = true);
    }
}

// horizontalSeatCrossed  (layer horizontals)
module horizontalSeatCrossed() {
    color([1, 0, 0]) difference() {
        multmatrix([[0, 0, -1, 6.5], [0.139937016816, 0.990160406866, 0, -137.278573961], [0.990160406866, -0.139937016816, 0, 422], [0, 0, 0, 1]]) linear_extrude(height = 13) polygon([[0, 0], [45.4471817778, 0], [82.0879630659, 259.261285781], [38.4207082258, 271.855617294]]);
        multmatrix([[0, -1, 0, 0], [1, 0, 0, 0], [0, 0, 1, 421.53823681], [0, 0, 0, 1]]) cube([13, 100, 45], center = true);
    }
}

// Mesh:Box  (layer seat)
module Mesh_Box() {
    color([0, 0, 1]) multmatrix([[0.707106781187, -0.707106781187, 0, -63.6396103068], [0.707106781187, 0.707106781187, 0, -63.6396103068], [0, 0, 1, 473.5], [0, 0, 0, 1]]) cube([90, 270, 13], center = true);
}

// Mesh:Box  (layer seat)
module Mesh_Box_2() {
    color([0, 0, 1]) multmatrix([[0.707106781187, -0.707106781187, 0, 0], [0.707106781187, 0.707106781187, 0, 0], [0, 0, 1, 473.5], [0, 0, 0, 1]]) cube([90, 270, 13], center = true);
}

// Mesh:Box  (layer seat)
module Mesh_Box_3() {
    color([0, 0, 1]) multmatrix([[0.707106781187, -0.707106781187, 0, 63.6396103068], [0.707106781187, 0.707106781187, 0, 63.6396103068], [0, 0, 1, 473.5], [0, 0, 0, 1]]) cube([90, 270, 13], center = true);
}

// 3D parts
if (PART == "" || PART == "horizontalMiddle") horizontalMiddle();
if (PART == "" || PART == "horizontalMiddleCrossed") horizontalMiddleCrossed();
if (PART == "" || PART == "horizontalSeat") horizontalSeat();
if (PART == "" || PART == "horizontalSeatCrossed") horizontalSeatCrossed();
if (PART == "" || PART == "Mesh_Box") Mesh_Box();
if (PART == "" || PART == "Mesh_Box_2") Mesh_Box_2();
if (PART == "" || PART == "Mesh_Box_3") Mesh_Box_3();
// 2D parts: select one with PART (OpenSCAD cannot render 2D and 3D together)
if (PART == "Mesh") Mesh();
