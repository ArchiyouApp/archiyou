// Archiyou -> OpenSCAD  |  script: timberwall  |  units: mm
// OpenSCAD has no units: coordinates are in mm.
// Parts: 13 CSG, 0 baked, 0 2D
// Parameters at export, for reference only (nothing in this file is linked to them):
//   WIDTH = 3000
//   HEIGHT = 2500
//   DEPTH = "120"
//   OPENING = false
//   OPENING_START = 1000
//   OPENING_SILL = 1000
//   OPENING_WIDTH = 1000
//   OPENING_HEIGHT = 1000
//   BOARDS = "none"
//   INSULATION = "hempflax"
//   TOP_CONNECT = false

$fn = 32;
PART = "";

// stud0  (layer wall/studs)
module stud0() {
    color([0, 0.502, 0]) translate([19, 0, 1250]) cube([38, 120, 2424], center = true);
}

// stud1  (layer wall/studs)
module stud1() {
    color([0, 0.502, 0]) translate([610, 0, 1250]) cube([38, 120, 2424], center = true);
}

// stud2  (layer wall/studs)
module stud2() {
    color([0, 0.502, 0]) translate([1220, 0, 1250]) cube([38, 120, 2424], center = true);
}

// stud3  (layer wall/studs)
module stud3() {
    color([0, 0.502, 0]) translate([1830, 0, 1250]) cube([38, 120, 2424], center = true);
}

// stud4  (layer wall/studs)
module stud4() {
    color([0, 0.502, 0]) translate([2440, 0, 1250]) cube([38, 120, 2424], center = true);
}

// endstud  (layer wall/studs)
module endstud() {
    color([0, 0.502, 0]) translate([2981, 0, 1250]) cube([38, 120, 2424], center = true);
}

// bottomplate  (layer wall/plates)
module bottomplate() {
    color([0, 0.502, 0]) translate([1500, 0, 19]) cube([3000, 120, 38], center = true);
}

// topplate  (layer wall/plates)
module topplate() {
    color([0, 0.502, 0]) translate([1500, 0, 2481]) cube([3000, 120, 38], center = true);
}

// insulation0  (layer wall/insulation)
module insulation0() {
    color([0.133, 0.133, 0.133]) translate([314.5, 0, 1250]) cube([553, 120, 2424], center = true);
}

// insulation1  (layer wall/insulation)
module insulation1() {
    color([0.133, 0.133, 0.133]) translate([915, 0, 1250]) cube([572, 120, 2424], center = true);
}

// insulation2  (layer wall/insulation)
module insulation2() {
    color([0.133, 0.133, 0.133]) translate([1525, 0, 1250]) cube([572, 120, 2424], center = true);
}

// insulation3  (layer wall/insulation)
module insulation3() {
    color([0.133, 0.133, 0.133]) translate([2135, 0, 1250]) cube([572, 120, 2424], center = true);
}

// insulation4  (layer wall/insulation)
module insulation4() {
    color([0.133, 0.133, 0.133]) translate([2710.5, 0, 1250]) cube([503, 120, 2424], center = true);
}

// 3D parts
if (PART == "" || PART == "stud0") stud0();
if (PART == "" || PART == "stud1") stud1();
if (PART == "" || PART == "stud2") stud2();
if (PART == "" || PART == "stud3") stud3();
if (PART == "" || PART == "stud4") stud4();
if (PART == "" || PART == "endstud") endstud();
if (PART == "" || PART == "bottomplate") bottomplate();
if (PART == "" || PART == "topplate") topplate();
if (PART == "" || PART == "insulation0") insulation0();
if (PART == "" || PART == "insulation1") insulation1();
if (PART == "" || PART == "insulation2") insulation2();
if (PART == "" || PART == "insulation3") insulation3();
if (PART == "" || PART == "insulation4") insulation4();
