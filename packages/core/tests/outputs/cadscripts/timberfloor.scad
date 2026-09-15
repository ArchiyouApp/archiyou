// Archiyou -> OpenSCAD  |  script: timberfloor  |  units: mm
// OpenSCAD has no units: coordinates are in mm.
// Parts: 10 CSG, 0 baked, 0 2D
// Parameters at export, for reference only (nothing in this file is linked to them):
//   WIDTH = 300
//   DEPTH = 300
//   BEAM_CTC = 60
//   BEAM_AUTO = true
//   BEAM_WIDTH = 38
//   BEAM_HEIGHT = 140
//   JOIST_HEADER = true
//   HIDE_BOARDS = true

$fn = 32;
PART = "";

// beam11  (layer model)
module beam11() {
    color([1, 0, 0]) translate([0, 19, 285]) cube([2924, 38, 170], center = true);
}

// joistHeaderLeft  (layer model)
module joistHeaderLeft() {
    color([0, 0, 1]) translate([-1481, 1500, 285]) cube([38, 3000, 170], center = true);
}

// joistHeaderRight  (layer model)
module joistHeaderRight() {
    color([0, 0, 1]) translate([1481, 1500, 285]) cube([38, 3000, 170], center = true);
}

// beam12  (layer model)
module beam12() {
    color([1, 0, 0]) translate([0, 619, 285]) cube([2924, 38, 170], center = true);
}

// beam13  (layer model)
module beam13() {
    color([1, 0, 0]) translate([0, 1219, 285]) cube([2924, 38, 170], center = true);
}

// beam14  (layer model)
module beam14() {
    color([1, 0, 0]) translate([0, 1819, 285]) cube([2924, 38, 170], center = true);
}

// beam15  (layer model)
module beam15() {
    color([1, 0, 0]) translate([0, 2419, 285]) cube([2924, 38, 170], center = true);
}

// lastBeam  (layer model)
module lastBeam() {
    color([1, 0, 0]) translate([0, 2981, 285]) cube([2924, 38, 170], center = true);
}

// supportLeft  (layer model)
module supportLeft() {
    color([0.502, 0.502, 0.502]) translate([-1450, 1500, 100]) cube([100, 3000, 200], center = true);
}

// supportRight  (layer model)
module supportRight() {
    color([0.502, 0.502, 0.502]) translate([1450, 1500, 100]) cube([100, 3000, 200], center = true);
}

// 3D parts
if (PART == "" || PART == "beam11") beam11();
if (PART == "" || PART == "joistHeaderLeft") joistHeaderLeft();
if (PART == "" || PART == "joistHeaderRight") joistHeaderRight();
if (PART == "" || PART == "beam12") beam12();
if (PART == "" || PART == "beam13") beam13();
if (PART == "" || PART == "beam14") beam14();
if (PART == "" || PART == "beam15") beam15();
if (PART == "" || PART == "lastBeam") lastBeam();
if (PART == "" || PART == "supportLeft") supportLeft();
if (PART == "" || PART == "supportRight") supportRight();
