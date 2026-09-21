// Archiyou -> OpenSCAD  |  script: maritavolo  |  units: mm
// OpenSCAD has no units: coordinates are in mm.
// Parts: 45 CSG, 0 baked, 0 2D
// Skipped: diagLine (open curve), diagLine (open curve)
// Parameters at export, for reference only (nothing in this file is linked to them):
//   DEPTH = 80
//   LENGTH = 200
//   HEIGHT = 70
//   BEAM_WIDTH = 50
//   BEAM_THICKNESS = 25

$fn = 32;
PART = "";

// sideV  (layer sides)
module sideV() {
    color([1, 0, 0]) translate([25, 12.5, 350]) cube([50, 25, 700], center = true);
}

// sideH  (layer sides)
module sideH() {
    color([1, 0, 0]) translate([400, -12.5, 325]) cube([800, 25, 50], center = true);
}

// sideH  (layer sides)
module sideH_2() {
    color([1, 0, 0]) translate([400, 37.5, 325]) cube([800, 25, 50], center = true);
}

// sideH  (layer sides)
module sideH_3() {
    color([1, 0, 0]) translate([400, -12.5, 675]) cube([800, 25, 50], center = true);
}

// sideH  (layer sides)
module sideH_4() {
    color([1, 0, 0]) translate([400, 37.5, 675]) cube([800, 25, 50], center = true);
}

// sideV  (layer sides)
module sideV_2() {
    color([1, 0, 0]) multmatrix([[-1, 0, 0, 775], [0, 1, 0, 12.5], [0, 0, 1, 350], [0, 0, 0, 1]]) cube([50, 25, 700], center = true);
}

// sideD  (layer diagonalLeft)
module sideD() {
    color([1, 0, 0]) multmatrix([[0.496138938357, 0.868243142124, 0, 56.5878428938], [0, 0, 1, 0], [0.868243142124, -0.496138938357, 0, 324.806946918], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [432.129014188, 0], [432.129014188, 50], [0, 50]]);
}

// sideD  (layer diagonalLeft)
module sideD_2() {
    color([1, 0, 0]) multmatrix([[-0.496138938357, -0.868243142124, 0, 743.412157106], [0, 0, 1, 0], [0.868243142124, -0.496138938357, 0, 324.806946918], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [432.129014188, 0], [432.129014188, 50], [0, 50]]);
}

// sideV  (layer diagonalLeft)
module sideV_3() {
    color([1, 0, 0]) translate([25, 1337.5, 350]) cube([50, 25, 700], center = true);
}

// sideH  (layer diagonalLeft)
module sideH_5() {
    color([1, 0, 0]) translate([400, 1312.5, 325]) cube([800, 25, 50], center = true);
}

// sideH  (layer diagonalLeft)
module sideH_6() {
    color([1, 0, 0]) translate([400, 1362.5, 325]) cube([800, 25, 50], center = true);
}

// sideH  (layer diagonalLeft)
module sideH_7() {
    color([1, 0, 0]) translate([400, 1312.5, 675]) cube([800, 25, 50], center = true);
}

// sideH  (layer diagonalLeft)
module sideH_8() {
    color([1, 0, 0]) translate([400, 1362.5, 675]) cube([800, 25, 50], center = true);
}

// sideV  (layer diagonalLeft)
module sideV_4() {
    color([1, 0, 0]) multmatrix([[-1, 0, 0, 775], [0, 1, 0, 1337.5], [0, 0, 1, 350], [0, 0, 0, 1]]) cube([50, 25, 700], center = true);
}

// sideD  (layer diagonalLeft)
module sideD_3() {
    color([1, 0, 0]) multmatrix([[0.496138938357, 0.868243142124, 0, 56.5878428938], [0, 0, 1, 1325], [0.868243142124, -0.496138938357, 0, 324.806946918], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [432.129014188, 0], [432.129014188, 50], [0, 50]]);
}

// sideD  (layer diagonalLeft)
module sideD_4() {
    color([1, 0, 0]) multmatrix([[-0.496138938357, -0.868243142124, 0, 743.412157106], [0, 0, 1, 1325], [0.868243142124, -0.496138938357, 0, 324.806946918], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [432.129014188, 0], [432.129014188, 50], [0, 50]]);
}

// strut V mid  (layer spine)
module strut_V_mid() {
    color([0, 0.502, 0]) multmatrix([[0, 0, 1, 400], [1, 0, 0, 362.5], [0, 1, 0, 487.5], [0, 0, 0, 1]]) cube([25, 275, 50], center = true);
}

// strut V mid  (layer spine)
module strut_V_mid_2() {
    color([0, 0.502, 0]) multmatrix([[0, 0, 1, 400], [1, 0, 0, 687.5], [0, 1, 0, 487.5], [0, 0, 0, 1]]) cube([25, 275, 50], center = true);
}

// strut V mid  (layer spine)
module strut_V_mid_3() {
    color([0, 0.502, 0]) multmatrix([[0, 0, 1, 400], [1, 0, 0, 1012.5], [0, 1, 0, 487.5], [0, 0, 0, 1]]) cube([25, 275, 50], center = true);
}

// strutD  (layer spine)
module strutD() {
    color([0, 0.502, 0]) multmatrix([[0, 0, 1, 375], [0.770303524451, -0.637677410779, 0, 40.9732726305], [0.637677410779, 0.770303524451, 0, 349.973971939], [0, 0, 0, 1]]) linear_extrude(height = 50) polygon([[0, 0], [401.134592015, 0], [401.134592015, 25], [0, 25]]);
}

// strutD  (layer spine)
module strutD_2() {
    color([0, 0.502, 0]) multmatrix([[0, 0, 1, 375], [-0.741160470842, -0.671327905319, 0, 658.199991259], [0.671327905319, -0.741160470842, 0, 349.984745032], [0, 0, 0, 1]]) linear_extrude(height = 50) polygon([[0, 0], [382.080792609, 0], [382.080792609, -25], [0, -25]]);
}

// strutD  (layer spine)
module strutD_3() {
    color([0, 0.502, 0]) multmatrix([[0, 0, 1, 375], [0.741160470842, -0.671327905319, 0, 716.800008741], [0.671327905319, 0.741160470842, 0, 349.984745032], [0, 0, 0, 1]]) linear_extrude(height = 50) polygon([[0, 0], [382.080792609, 0], [382.080792609, 25], [0, 25]]);
}

// strutD  (layer spine)
module strutD_4() {
    color([0, 0.502, 0]) multmatrix([[0, 0, 1, 375], [-0.741160470842, -0.671327905319, 0, 1308.19999126], [0.671327905319, -0.741160470842, 0, 349.984745032], [0, 0, 0, 1]]) linear_extrude(height = 50) polygon([[0, 0], [382.080792609, 0], [382.080792609, -25], [0, -25]]);
}

// strutV ends  (layer spine)
module strutV_ends() {
    color([0, 0.502, 0]) multmatrix([[0, 0, 1, 400], [1, 0, 0, 12.5], [0, 1, 0, 500], [0, 0, 0, 1]]) cube([25, 400, 50], center = true);
}

// strutV ends  (layer spine)
module strutV_ends_2() {
    color([0, 0.502, 0]) multmatrix([[0, 0, 1, 400], [-1, 0, 0, 1337.5], [0, 1, 0, 500], [0, 0, 0, 1]]) cube([25, 400, 50], center = true);
}

// strutH  (layer spine)
module strutH() {
    color([0, 0.502, 0]) multmatrix([[0, 0, 1, 437.5], [1, 0, 0, 675], [0, 1, 0, 375], [0, 0, 0, 1]]) cube([1400, 50, 25], center = true);
}

// strutH  (layer spine)
module strutH_2() {
    color([0, 0.502, 0]) multmatrix([[0, 0, -1, 362.5], [1, 0, 0, 675], [0, 1, 0, 375], [0, 0, 0, 1]]) cube([1400, 50, 25], center = true);
}

// strutH  (layer spine)
module strutH_3() {
    color([0, 0.502, 0]) multmatrix([[0, 0, 1, 437.5], [1, 0, 0, 675], [0, -1, 0, 600], [0, 0, 0, 1]]) cube([1400, 50, 25], center = true);
}

// strutH  (layer spine)
module strutH_4() {
    color([0, 0.502, 0]) multmatrix([[0, 0, -1, 362.5], [1, 0, 0, 675], [0, -1, 0, 600], [0, 0, 0, 1]]) cube([1400, 50, 25], center = true);
}

// topPlank11  (layer tabletop)
module topPlank11() {
    color([0.647, 0.165, 0.165]) translate([25, 675, 712.5]) cube([50, 2000, 25], center = true);
}

// topPlank21  (layer tabletop)
module topPlank21() {
    color([0.647, 0.165, 0.165]) translate([75, 675, 712.5]) cube([50, 2000, 25], center = true);
}

// topPlank31  (layer tabletop)
module topPlank31() {
    color([0.647, 0.165, 0.165]) translate([125, 675, 712.5]) cube([50, 2000, 25], center = true);
}

// topPlank41  (layer tabletop)
module topPlank41() {
    color([0.647, 0.165, 0.165]) translate([175, 675, 712.5]) cube([50, 2000, 25], center = true);
}

// topPlank51  (layer tabletop)
module topPlank51() {
    color([0.647, 0.165, 0.165]) translate([225, 675, 712.5]) cube([50, 2000, 25], center = true);
}

// topPlank61  (layer tabletop)
module topPlank61() {
    color([0.647, 0.165, 0.165]) translate([275, 675, 712.5]) cube([50, 2000, 25], center = true);
}

// topPlank71  (layer tabletop)
module topPlank71() {
    color([0.647, 0.165, 0.165]) translate([325, 675, 712.5]) cube([50, 2000, 25], center = true);
}

// topPlank81  (layer tabletop)
module topPlank81() {
    color([0.647, 0.165, 0.165]) translate([375, 675, 712.5]) cube([50, 2000, 25], center = true);
}

// topPlank91  (layer tabletop)
module topPlank91() {
    color([0.647, 0.165, 0.165]) translate([425, 675, 712.5]) cube([50, 2000, 25], center = true);
}

// topPlank101  (layer tabletop)
module topPlank101() {
    color([0.647, 0.165, 0.165]) translate([475, 675, 712.5]) cube([50, 2000, 25], center = true);
}

// topPlank111  (layer tabletop)
module topPlank111() {
    color([0.647, 0.165, 0.165]) translate([525, 675, 712.5]) cube([50, 2000, 25], center = true);
}

// topPlank121  (layer tabletop)
module topPlank121() {
    color([0.647, 0.165, 0.165]) translate([575, 675, 712.5]) cube([50, 2000, 25], center = true);
}

// topPlank131  (layer tabletop)
module topPlank131() {
    color([0.647, 0.165, 0.165]) translate([625, 675, 712.5]) cube([50, 2000, 25], center = true);
}

// topPlank141  (layer tabletop)
module topPlank141() {
    color([0.647, 0.165, 0.165]) translate([675, 675, 712.5]) cube([50, 2000, 25], center = true);
}

// topPlank151  (layer tabletop)
module topPlank151() {
    color([0.647, 0.165, 0.165]) translate([725, 675, 712.5]) cube([50, 2000, 25], center = true);
}

// topPlank161  (layer tabletop)
module topPlank161() {
    color([0.647, 0.165, 0.165]) translate([775, 675, 712.5]) cube([50, 2000, 25], center = true);
}

// 3D parts
if (PART == "" || PART == "sideV") sideV();
if (PART == "" || PART == "sideH") sideH();
if (PART == "" || PART == "sideH_2") sideH_2();
if (PART == "" || PART == "sideH_3") sideH_3();
if (PART == "" || PART == "sideH_4") sideH_4();
if (PART == "" || PART == "sideV_2") sideV_2();
if (PART == "" || PART == "sideD") sideD();
if (PART == "" || PART == "sideD_2") sideD_2();
if (PART == "" || PART == "sideV_3") sideV_3();
if (PART == "" || PART == "sideH_5") sideH_5();
if (PART == "" || PART == "sideH_6") sideH_6();
if (PART == "" || PART == "sideH_7") sideH_7();
if (PART == "" || PART == "sideH_8") sideH_8();
if (PART == "" || PART == "sideV_4") sideV_4();
if (PART == "" || PART == "sideD_3") sideD_3();
if (PART == "" || PART == "sideD_4") sideD_4();
if (PART == "" || PART == "strut_V_mid") strut_V_mid();
if (PART == "" || PART == "strut_V_mid_2") strut_V_mid_2();
if (PART == "" || PART == "strut_V_mid_3") strut_V_mid_3();
if (PART == "" || PART == "strutD") strutD();
if (PART == "" || PART == "strutD_2") strutD_2();
if (PART == "" || PART == "strutD_3") strutD_3();
if (PART == "" || PART == "strutD_4") strutD_4();
if (PART == "" || PART == "strutV_ends") strutV_ends();
if (PART == "" || PART == "strutV_ends_2") strutV_ends_2();
if (PART == "" || PART == "strutH") strutH();
if (PART == "" || PART == "strutH_2") strutH_2();
if (PART == "" || PART == "strutH_3") strutH_3();
if (PART == "" || PART == "strutH_4") strutH_4();
if (PART == "" || PART == "topPlank11") topPlank11();
if (PART == "" || PART == "topPlank21") topPlank21();
if (PART == "" || PART == "topPlank31") topPlank31();
if (PART == "" || PART == "topPlank41") topPlank41();
if (PART == "" || PART == "topPlank51") topPlank51();
if (PART == "" || PART == "topPlank61") topPlank61();
if (PART == "" || PART == "topPlank71") topPlank71();
if (PART == "" || PART == "topPlank81") topPlank81();
if (PART == "" || PART == "topPlank91") topPlank91();
if (PART == "" || PART == "topPlank101") topPlank101();
if (PART == "" || PART == "topPlank111") topPlank111();
if (PART == "" || PART == "topPlank121") topPlank121();
if (PART == "" || PART == "topPlank131") topPlank131();
if (PART == "" || PART == "topPlank141") topPlank141();
if (PART == "" || PART == "topPlank151") topPlank151();
if (PART == "" || PART == "topPlank161") topPlank161();
