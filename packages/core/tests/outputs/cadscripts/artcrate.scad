// Archiyou -> OpenSCAD  |  script: artcrate  |  units: mm
// OpenSCAD has no units: coordinates are in mm.
// Parts: 17 CSG, 0 baked, 0 2D
// Skipped: Curve:Line (open curve)
// Parameters at export, for reference only (nothing in this file is linked to them):
//   WIDTH = 50
//   DEPTH = 100
//   HEIGHT = 50
//   BOARD_THICKNESS = 8
//   LAT_WIDTH = 36
//   LAT_HEIGHT = 18

$fn = 32;
PART = "";

// bottomPlate  (layer bottom)
module bottomPlate() {
    color([0, 0, 1]) translate([250, 526, 22]) cube([500, 1052, 8], center = true);
}

// bottomLatLeft  (layer bottom)
module bottomLatLeft() {
    color([0, 0, 1]) translate([18, 526, 9]) cube([36, 1052, 18], center = true);
}

// bottomLatRight  (layer bottom)
module bottomLatRight() {
    color([0, 0, 1]) translate([482, 526, 9]) cube([36, 1052, 18], center = true);
}

// sideFrontPlate  (layer sidefront)
module sideFrontPlate() {
    color([0.502, 0, 0.502]) translate([250, 22, 276]) cube([500, 8, 500], center = true);
}

// sideFrontLatLeft  (layer sidefront)
module sideFrontLatLeft() {
    color([0.502, 0, 0.502]) translate([18, 9, 276]) cube([36, 18, 500], center = true);
}

// sideFrontLatRight  (layer sidefront)
module sideFrontLatRight() {
    color([0.502, 0, 0.502]) multmatrix([[-1, 0, 0, 482], [0, 1, 0, 9], [0, 0, 1, 276], [0, 0, 0, 1]]) cube([36, 18, 500], center = true);
}

// sideFrontLatBottom  (layer sidefront)
module sideFrontLatBottom() {
    color([0.502, 0, 0.502]) translate([250, 9, 44]) cube([428, 18, 36], center = true);
}

// sideFrontLatTop  (layer sidefront)
module sideFrontLatTop() {
    color([0.502, 0, 0.502]) multmatrix([[1, 0, 0, 250], [0, 1, 0, 9], [0, 0, -1, 508], [0, 0, 0, 1]]) cube([428, 18, 36], center = true);
}

// sideFrontPlate  (layer sideback)
module sideFrontPlate_2() {
    multmatrix([[1, 0, 0, 250], [0, -1, 0, 1030], [0, 0, 1, 276], [0, 0, 0, 1]]) cube([500, 8, 500], center = true);
}

// sideFrontLatLeft  (layer sideback)
module sideFrontLatLeft_2() {
    multmatrix([[1, 0, 0, 18], [0, -1, 0, 1043], [0, 0, 1, 276], [0, 0, 0, 1]]) cube([36, 18, 500], center = true);
}

// sideFrontLatRight  (layer sideback)
module sideFrontLatRight_2() {
    multmatrix([[-1, 0, 0, 482], [0, -1, 0, 1043], [0, 0, 1, 276], [0, 0, 0, 1]]) cube([36, 18, 500], center = true);
}

// sideFrontLatBottom  (layer sideback)
module sideFrontLatBottom_2() {
    multmatrix([[1, 0, 0, 250], [0, -1, 0, 1043], [0, 0, 1, 44], [0, 0, 0, 1]]) cube([428, 18, 36], center = true);
}

// sideFrontLatTop  (layer sideback)
module sideFrontLatTop_2() {
    multmatrix([[1, 0, 0, 250], [0, -1, 0, 1043], [0, 0, -1, 508], [0, 0, 0, 1]]) cube([428, 18, 36], center = true);
}

// sideLeftPlate  (layer sideleft)
module sideLeftPlate() {
    color([0, 0.502, 0]) translate([-4, 526, 263]) cube([8, 1052, 526], center = true);
}

// sideLeftLat  (layer sideleft)
module sideLeftLat() {
    color([0, 0.502, 0]) translate([-17, 526, 508]) cube([18, 1052, 36], center = true);
}

// sideLeftPlate  (layer sideright)
module sideLeftPlate_2() {
    color([1, 0.647, 0]) multmatrix([[-1, 0, 0, 504], [0, 1, 0, 526], [0, 0, 1, 263], [0, 0, 0, 1]]) cube([8, 1052, 526], center = true);
}

// sideLeftLat  (layer sideright)
module sideLeftLat_2() {
    color([1, 0.647, 0]) multmatrix([[-1, 0, 0, 517], [0, 1, 0, 526], [0, 0, 1, 508], [0, 0, 0, 1]]) cube([18, 1052, 36], center = true);
}

// 3D parts
if (PART == "" || PART == "bottomPlate") bottomPlate();
if (PART == "" || PART == "bottomLatLeft") bottomLatLeft();
if (PART == "" || PART == "bottomLatRight") bottomLatRight();
if (PART == "" || PART == "sideFrontPlate") sideFrontPlate();
if (PART == "" || PART == "sideFrontLatLeft") sideFrontLatLeft();
if (PART == "" || PART == "sideFrontLatRight") sideFrontLatRight();
if (PART == "" || PART == "sideFrontLatBottom") sideFrontLatBottom();
if (PART == "" || PART == "sideFrontLatTop") sideFrontLatTop();
if (PART == "" || PART == "sideFrontPlate_2") sideFrontPlate_2();
if (PART == "" || PART == "sideFrontLatLeft_2") sideFrontLatLeft_2();
if (PART == "" || PART == "sideFrontLatRight_2") sideFrontLatRight_2();
if (PART == "" || PART == "sideFrontLatBottom_2") sideFrontLatBottom_2();
if (PART == "" || PART == "sideFrontLatTop_2") sideFrontLatTop_2();
if (PART == "" || PART == "sideLeftPlate") sideLeftPlate();
if (PART == "" || PART == "sideLeftLat") sideLeftLat();
if (PART == "" || PART == "sideLeftPlate_2") sideLeftPlate_2();
if (PART == "" || PART == "sideLeftLat_2") sideLeftLat_2();
