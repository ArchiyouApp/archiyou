// Archiyou -> OpenSCAD  |  script: workbench  |  units: mm
// OpenSCAD has no units: coordinates are in mm.
// Parts: 23 CSG, 0 baked, 0 2D
// Parameters at export, for reference only (nothing in this file is linked to them):
//   LENGTH = 1000
//   DEPTH = 610
//   HEIGHT = 840
//   BEAM_WIDTH = 89
//   BEAM_THICKNESS = 38
//   BOARD_THICKNESS = 18

$fn = 32;
PART = "";

// top length  (layer top)
module top_length() {
    color([0, 0.502, 0]) translate([500, 19, 777.5]) cube([1000, 38, 89], center = true);
}

// tableTopLatBeamBack  (layer top)
module tableTopLatBeamBack() {
    color([0, 0.502, 0]) translate([500, 591, 777.5]) cube([1000, 38, 89], center = true);
}

// top depth  (layer top)
module top_depth() {
    color([0, 0.502, 0]) translate([19, 305, 777.5]) cube([38, 534, 89], center = true);
}

// tableTopLatBeamRight  (layer top)
module tableTopLatBeamRight() {
    color([0, 0.502, 0]) translate([981, 305, 777.5]) cube([38, 534, 89], center = true);
}

// top depth  (layer top)
module top_depth_2() {
    color([0, 0.502, 0]) translate([500, 305, 777.5]) cube([38, 534, 89], center = true);
}

// leg long  (layer legs)
module leg_long() {
    color([1, 0, 0]) translate([82.5, 57, 411]) cube([89, 38, 822], center = true);
}

// leg mid  (layer legs)
module leg_mid() {
    color([1, 0, 0]) translate([82.5, 19, 507.5]) cube([89, 38, 451], center = true);
}

// leg bottom  (layer legs)
module leg_bottom() {
    color([1, 0, 0]) translate([82.5, 19, 96.5]) cube([89, 38, 193], center = true);
}

// leg long  (layer legs)
module leg_long_2() {
    color([1, 0, 0]) translate([917.5, 57, 411]) cube([89, 38, 822], center = true);
}

// leg mid  (layer legs)
module leg_mid_2() {
    color([1, 0, 0]) translate([917.5, 19, 507.5]) cube([89, 38, 451], center = true);
}

// leg bottom  (layer legs)
module leg_bottom_2() {
    color([1, 0, 0]) translate([917.5, 19, 96.5]) cube([89, 38, 193], center = true);
}

// leg long  (layer legs)
module leg_long_3() {
    color([1, 0, 0]) multmatrix([[1, 0, 0, 82.5], [0, -1, 0, 553], [0, 0, 1, 411], [0, 0, 0, 1]]) cube([89, 38, 822], center = true);
}

// leg mid  (layer legs)
module leg_mid_3() {
    color([1, 0, 0]) multmatrix([[1, 0, 0, 82.5], [0, -1, 0, 591], [0, 0, 1, 507.5], [0, 0, 0, 1]]) cube([89, 38, 451], center = true);
}

// leg bottom  (layer legs)
module leg_bottom_3() {
    color([1, 0, 0]) multmatrix([[1, 0, 0, 82.5], [0, -1, 0, 591], [0, 0, 1, 96.5], [0, 0, 0, 1]]) cube([89, 38, 193], center = true);
}

// leg long  (layer legs)
module leg_long_4() {
    color([1, 0, 0]) multmatrix([[1, 0, 0, 917.5], [0, -1, 0, 553], [0, 0, 1, 411], [0, 0, 0, 1]]) cube([89, 38, 822], center = true);
}

// leg mid  (layer legs)
module leg_mid_4() {
    color([1, 0, 0]) multmatrix([[1, 0, 0, 917.5], [0, -1, 0, 591], [0, 0, 1, 507.5], [0, 0, 0, 1]]) cube([89, 38, 451], center = true);
}

// leg bottom  (layer legs)
module leg_bottom_4() {
    color([1, 0, 0]) multmatrix([[1, 0, 0, 917.5], [0, -1, 0, 591], [0, 0, 1, 96.5], [0, 0, 0, 1]]) cube([89, 38, 193], center = true);
}

// along length  (layer laterals)
module along_length() {
    color([0.502, 0, 0.502]) translate([500, 19, 237.5]) cube([924, 38, 89], center = true);
}

// lateralLengthBack  (layer laterals)
module lateralLengthBack() {
    color([0.502, 0, 0.502]) translate([500, 591, 237.5]) cube([924, 38, 89], center = true);
}

// along depth  (layer laterals)
module along_depth() {
    color([0.502, 0, 0.502]) translate([146, 305, 237.5]) cube([38, 534, 89], center = true);
}

// lateralDepthRight  (layer laterals)
module lateralDepthRight() {
    color([0.502, 0, 0.502]) translate([854, 305, 237.5]) cube([38, 534, 89], center = true);
}

// tableTopBoard  (layer boards)
module tableTopBoard() {
    color([0, 0, 1]) translate([500, 305, 831]) cube([1000, 610, 18], center = true);
}

// bottomBoard  (layer boards)
module bottomBoard() {
    color([0, 0, 1]) translate([500, 305, 291]) cube([746, 610, 18], center = true);
}

// 3D parts
if (PART == "" || PART == "top_length") top_length();
if (PART == "" || PART == "tableTopLatBeamBack") tableTopLatBeamBack();
if (PART == "" || PART == "top_depth") top_depth();
if (PART == "" || PART == "tableTopLatBeamRight") tableTopLatBeamRight();
if (PART == "" || PART == "top_depth_2") top_depth_2();
if (PART == "" || PART == "leg_long") leg_long();
if (PART == "" || PART == "leg_mid") leg_mid();
if (PART == "" || PART == "leg_bottom") leg_bottom();
if (PART == "" || PART == "leg_long_2") leg_long_2();
if (PART == "" || PART == "leg_mid_2") leg_mid_2();
if (PART == "" || PART == "leg_bottom_2") leg_bottom_2();
if (PART == "" || PART == "leg_long_3") leg_long_3();
if (PART == "" || PART == "leg_mid_3") leg_mid_3();
if (PART == "" || PART == "leg_bottom_3") leg_bottom_3();
if (PART == "" || PART == "leg_long_4") leg_long_4();
if (PART == "" || PART == "leg_mid_4") leg_mid_4();
if (PART == "" || PART == "leg_bottom_4") leg_bottom_4();
if (PART == "" || PART == "along_length") along_length();
if (PART == "" || PART == "lateralLengthBack") lateralLengthBack();
if (PART == "" || PART == "along_depth") along_depth();
if (PART == "" || PART == "lateralDepthRight") lateralDepthRight();
if (PART == "" || PART == "tableTopBoard") tableTopBoard();
if (PART == "" || PART == "bottomBoard") bottomBoard();
