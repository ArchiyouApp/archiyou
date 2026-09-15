// Archiyou -> OpenSCAD  |  script: table 0.1.0  |  units: mm
// OpenSCAD has no units: coordinates are in mm.
// Parts: 6 CSG, 0 baked, 0 2D
// Parameters at export, for reference only (nothing in this file is linked to them):
//   WIDTH = 600

$fn = 32;
PART = "";

module leg0() {
    translate([20, 20, 350]) cube([40, 40, 700], center = true);
}

module leg1() {
    translate([580, 20, 350]) cube([40, 40, 700], center = true);
}

module leg2() {
    translate([20, 380, 350]) cube([40, 40, 700], center = true);
}

module leg3() {
    translate([580, 380, 350]) cube([40, 40, 700], center = true);
}

module top() {
    color([0.69, 0.502, 0.314]) difference() {
        translate([-20, -20, 700]) linear_extrude(height = 25) polygon([[0, 0], [640, 0], [640, 440], [0, 440]]);
        translate([300, 200, 650]) cylinder(h = 100, r = 15);
    }
}

module brace() {
    multmatrix([[0.720833064902, 0, -0.693108716252, 40], [0, 1, 0, 20], [0.693108716252, 0, 0.720833064902, 100], [0, 0, 0, 1]]) linear_extrude(height = 20) polygon([[0, 0], [721.387551875, 0], [721.387551875, 20], [0, 20]]);
}

// 3D parts
if (PART == "" || PART == "leg0") leg0();
if (PART == "" || PART == "leg1") leg1();
if (PART == "" || PART == "leg2") leg2();
if (PART == "" || PART == "leg3") leg3();
if (PART == "" || PART == "top") top();
if (PART == "" || PART == "brace") brace();
