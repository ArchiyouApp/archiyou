// Archiyou -> OpenSCAD  |  script: timberwallopenings  |  units: mm
// OpenSCAD has no units: coordinates are in mm.
// Parts: 31 CSG, 9 baked, 2 2D
//   baked: insulation1 (made by _separateSolids())
//   baked: insulation1_2 (made by _separateSolids())
//   baked: insulation2 (made by _separateSolids())
//   baked: insulation2_2 (made by _separateSolids())
//   baked: insulation3 (made by _separateSolids())
//   baked: insulation3_2 (made by _separateSolids())
//   baked: insulation3_3 (made by _separateSolids())
//   baked: insulation5 (made by _separateSolids())
//   baked: insulation5_2 (made by _separateSolids())
// Parameters at export, for reference only (nothing in this file is linked to them):
//   WIDTH = 4000
//   HEIGHT = 2500
//   DEPTH = "120"
//   OPENINGS = [{"name":"kitchen window","left":600,"sill":900,"width":1200,"height":1400},{"name":"door","left":2400,"sill":0,"width":900,"height":2100}]

$fn = 32;
PART = "";

// stud0  (layer wall/studs)
module stud0() {
    color([0, 0.502, 0]) translate([19, 0, 1250]) cube([38, 120, 2424], center = true);
}

// stud6  (layer wall/studs)
module stud6() {
    color([0, 0.502, 0]) translate([3660, 0, 1250]) cube([38, 120, 2424], center = true);
}

// endstud  (layer wall/studs)
module endstud() {
    color([0, 0.502, 0]) translate([3981, 0, 1250]) cube([38, 120, 2424], center = true);
}

// bottomplate  (layer wall/plates)
module bottomplate() {
    color([0, 0.502, 0]) translate([2000, 0, 19]) cube([4000, 120, 38], center = true);
}

// topplate  (layer wall/plates)
module topplate() {
    color([0, 0.502, 0]) translate([2000, 0, 2481]) cube([4000, 120, 38], center = true);
}

// crippleTop  (layer wall/cripplesTop)
module crippleTop() {
    color([0, 0.502, 0]) translate([1220, 0, 2399.5]) cube([38, 120, 125], center = true);
}

// crippleTop  (layer wall/cripplesTop)
module crippleTop_2() {
    color([0, 0.502, 0]) translate([1830, 0, 2399.5]) cube([38, 120, 125], center = true);
}

// crippleTop  (layer wall/cripplesTop)
module crippleTop_3() {
    color([0, 0.502, 0]) translate([3050, 0, 2318.5]) cube([38, 120, 287], center = true);
}

// crippleBottom  (layer wall/cripplesBottom)
module crippleBottom() {
    color([0, 0.502, 0]) translate([1220, 0, 450.5]) cube([38, 120, 825], center = true);
}

// crippleBottom  (layer wall/cripplesBottom)
module crippleBottom_2() {
    color([0, 0.502, 0]) translate([1830, 0, 450.5]) cube([38, 120, 825], center = true);
}

// openingHorizontal  (layer wall/openingFramesHorizontals)
module openingHorizontal() {
    color([1, 0, 0]) translate([1267, 0, 882]) cube([1274, 120, 38], center = true);
}

// openingHorizontal  (layer wall/openingFramesHorizontals)
module openingHorizontal_2() {
    color([1, 0, 0]) translate([1267, 0, 2318]) cube([1274, 120, 38], center = true);
}

// openingHorizontal  (layer wall/openingFramesHorizontals)
module openingHorizontal_3() {
    color([1, 0, 0]) translate([2947, 0, 2156]) cube([974, 120, 38], center = true);
}

// openingVertical  (layer wall/openingFramesVerticals)
module openingVertical() {
    color([1, 0, 0]) difference() {
        translate([649, 0, 1600]) cube([38, 120, 1398], center = true);
        translate([2000, 0, 19]) cube([4000, 120, 38], center = true);
        translate([2000, 0, 2481]) cube([4000, 120, 38], center = true);
    }
}

// openingVertical  (layer wall/openingFramesVerticals)
module openingVertical_2() {
    color([1, 0, 0]) difference() {
        translate([1885, 0, 1600]) cube([38, 120, 1398], center = true);
        translate([2000, 0, 19]) cube([4000, 120, 38], center = true);
        translate([2000, 0, 2481]) cube([4000, 120, 38], center = true);
    }
}

// openingVertical  (layer wall/openingFramesVerticals)
module openingVertical_3() {
    color([1, 0, 0]) difference() {
        translate([2479, 0, 1088]) cube([38, 120, 2098], center = true);
        translate([2000, 0, 19]) cube([4000, 120, 38], center = true);
        translate([2000, 0, 2481]) cube([4000, 120, 38], center = true);
    }
}

// openingVertical  (layer wall/openingFramesVerticals)
module openingVertical_4() {
    color([1, 0, 0]) difference() {
        translate([3415, 0, 1088]) cube([38, 120, 2098], center = true);
        translate([2000, 0, 19]) cube([4000, 120, 38], center = true);
        translate([2000, 0, 2481]) cube([4000, 120, 38], center = true);
    }
}

// openingKingStudLeft  (layer wall/openingKingStuds)
module openingKingStudLeft() {
    color([0.647, 0.165, 0.165]) translate([611, 0, 1250]) cube([38, 120, 2424], center = true);
}

// openingKingStudRight  (layer wall/openingKingStuds)
module openingKingStudRight() {
    color([0.647, 0.165, 0.165]) translate([1923, 0, 1250]) cube([38, 120, 2424], center = true);
}

// openingKingStudLeft  (layer wall/openingKingStuds)
module openingKingStudLeft_2() {
    color([0.647, 0.165, 0.165]) translate([2441, 0, 1250]) cube([38, 120, 2424], center = true);
}

// openingKingStudRight  (layer wall/openingKingStuds)
module openingKingStudRight_2() {
    color([0.647, 0.165, 0.165]) translate([3453, 0, 1250]) cube([38, 120, 2424], center = true);
}

// openingJackLeftBottom  (layer wall/openingJackStuds)
module openingJackLeftBottom() {
    color([0.647, 0.165, 0.165]) translate([649, 0, 450.5]) cube([38, 120, 825], center = true);
}

// openingJackRightBottom  (layer wall/openingJackStuds)
module openingJackRightBottom() {
    color([0.647, 0.165, 0.165]) translate([1885, 0, 450.5]) cube([38, 120, 825], center = true);
}

// openingJackLeftTop  (layer wall/openingJackStuds)
module openingJackLeftTop() {
    color([0.647, 0.165, 0.165]) translate([649, 0, 2399.5]) cube([38, 120, 125], center = true);
}

// openingJackRightTop  (layer wall/openingJackStuds)
module openingJackRightTop() {
    color([0.647, 0.165, 0.165]) translate([1885, 0, 2399.5]) cube([38, 120, 125], center = true);
}

// openingJackLeftTop  (layer wall/openingJackStuds)
module openingJackLeftTop_2() {
    color([0.647, 0.165, 0.165]) translate([2479, 0, 2318.5]) cube([38, 120, 287], center = true);
}

// openingJackRightTop  (layer wall/openingJackStuds)
module openingJackRightTop_2() {
    color([0.647, 0.165, 0.165]) translate([3415, 0, 2318.5]) cube([38, 120, 287], center = true);
}

// insulation0  (layer wall/insulation)
module insulation0() {
    color([0.133, 0.133, 0.133]) difference() {
        translate([314.5, 0, 1250]) cube([553, 120, 2424], center = true);
        multmatrix([[1, 0, 0, 630], [0, 0, -1, 120], [0, 1, 0, 863], [0, 0, 0, 1]]) linear_extrude(height = 240) polygon([[0, 0], [1274, 0], [1274, 1474], [0, 1474]]);
        translate([630, 0, 1250]) cube([76, 132, 2500], center = true);
        translate([1904, 0, 1250]) cube([76, 132, 2500], center = true);
        multmatrix([[1, 0, 0, 2460], [0, 0, -1, 120], [0, 1, 0, 1], [0, 0, 0, 1]]) linear_extrude(height = 240) polygon([[0, 0], [974, 0], [974, 2174], [0, 2174]]);
        translate([2460, 0, 1250]) cube([76, 132, 2500], center = true);
        translate([3434, 0, 1250]) cube([76, 132, 2500], center = true);
    }
}

// insulation1  (layer wall/insulation): baked, made by _separateSolids()
module insulation1() {
    color([0.133, 0.133, 0.133]) polyhedron(
        points = [[668, -60, 2337], [668, -60, 2462], [668, 60, 2462], [668, 60, 2337], [1201, -60, 2337], [1201, -60, 2462], [1201, 60, 2462], [1201, 60, 2337]],
        faces = [[3, 2, 1, 0], [5, 4, 0, 1], [5, 1, 2, 6], [6, 7, 4, 5], [3, 7, 6, 2], [3, 0, 4, 7]]
    );
}

// insulation1  (layer wall/insulation): baked, made by _separateSolids()
module insulation1_2() {
    color([0.133, 0.133, 0.133]) polyhedron(
        points = [[1201, -60, 38], [668, -60, 38], [668, 60, 38], [1201, 60, 38], [1201, 60, 863], [1201, -60, 863], [668, -60, 863], [668, 60, 863]],
        faces = [[3, 2, 1, 0], [0, 5, 4, 3], [5, 0, 1, 6], [5, 6, 7, 4], [1, 2, 7, 6], [4, 7, 2, 3]]
    );
}

// insulation2  (layer wall/insulation): baked, made by _separateSolids()
module insulation2() {
    color([0.133, 0.133, 0.133]) polyhedron(
        points = [[1239, -60, 2462], [1239, -60, 2337], [1811, -60, 2337], [1811, -60, 2462], [1239, 60, 2462], [1811, 60, 2462], [1811, 60, 2337], [1239, 60, 2337]],
        faces = [[3, 2, 1, 0], [5, 3, 0, 4], [7, 1, 2, 6], [5, 4, 7, 6], [0, 1, 7, 4], [5, 6, 2, 3]]
    );
}

// insulation2  (layer wall/insulation): baked, made by _separateSolids()
module insulation2_2() {
    color([0.133, 0.133, 0.133]) polyhedron(
        points = [[1239, -60, 38], [1811, -60, 38], [1811, -60, 863], [1239, -60, 863], [1239, 60, 863], [1239, 60, 38], [1811, 60, 38], [1811, 60, 863]],
        faces = [[3, 2, 1, 0], [0, 5, 4, 3], [2, 7, 6, 1], [1, 6, 5, 0], [7, 4, 5, 6], [2, 3, 4, 7]]
    );
}

// insulation3  (layer wall/insulation): baked, made by _separateSolids()
module insulation3() {
    color([0.133, 0.133, 0.133]) polyhedron(
        points = [[1849, 60, 863], [1866, 60, 863], [1866, 60, 38], [1849, 60, 38], [1849, -60, 863], [1866, -60, 863], [1866, -60, 38], [1849, -60, 38]],
        faces = [[3, 2, 1, 0], [5, 4, 0, 1], [1, 2, 6, 5], [6, 7, 4, 5], [2, 3, 7, 6], [0, 4, 7, 3]]
    );
}

// insulation3  (layer wall/insulation): baked, made by _separateSolids()
module insulation3_2() {
    color([0.133, 0.133, 0.133]) polyhedron(
        points = [[2421, 60, 2462], [1942, 60, 2462], [1942, -60, 2462], [2421, -60, 2462], [2421, -60, 38], [2421, 60, 38], [1942, -60, 38], [1942, 60, 38]],
        faces = [[3, 2, 1, 0], [3, 0, 5, 4], [7, 1, 2, 6], [5, 7, 6, 4], [6, 2, 3, 4], [7, 5, 0, 1]]
    );
}

// insulation3  (layer wall/insulation): baked, made by _separateSolids()
module insulation3_3() {
    color([0.133, 0.133, 0.133]) polyhedron(
        points = [[1866, 60, 2462], [1866, 60, 2337], [1849, 60, 2337], [1849, 60, 2462], [1866, -60, 2462], [1866, -60, 2337], [1849, -60, 2337], [1849, -60, 2462]],
        faces = [[3, 2, 1, 0], [1, 5, 4, 0], [7, 6, 2, 3], [6, 7, 4, 5], [1, 2, 6, 5], [3, 0, 4, 7]]
    );
}

// insulation4  (layer wall/insulation)
module insulation4() {
    color([0.133, 0.133, 0.133]) difference() {
        translate([2745, 0, 1250]) cube([572, 120, 2424], center = true);
        multmatrix([[1, 0, 0, 630], [0, 0, -1, 120], [0, 1, 0, 863], [0, 0, 0, 1]]) linear_extrude(height = 240) polygon([[0, 0], [1274, 0], [1274, 1474], [0, 1474]]);
        translate([630, 0, 1250]) cube([76, 132, 2500], center = true);
        translate([1904, 0, 1250]) cube([76, 132, 2500], center = true);
        multmatrix([[1, 0, 0, 2460], [0, 0, -1, 120], [0, 1, 0, 1], [0, 0, 0, 1]]) linear_extrude(height = 240) polygon([[0, 0], [974, 0], [974, 2174], [0, 2174]]);
        translate([2460, 0, 1250]) cube([76, 132, 2500], center = true);
        translate([3434, 0, 1250]) cube([76, 132, 2500], center = true);
    }
}

// insulation5  (layer wall/insulation): baked, made by _separateSolids()
module insulation5() {
    color([0.133, 0.133, 0.133]) polyhedron(
        points = [[3641, -60, 38], [3641, 60, 38], [3641, 60, 2462], [3641, -60, 2462], [3472, -60, 38], [3472, 60, 38], [3472, -60, 2462], [3472, 60, 2462]],
        faces = [[3, 2, 1, 0], [1, 5, 4, 0], [6, 3, 0, 4], [7, 6, 4, 5], [7, 5, 1, 2], [7, 2, 3, 6]]
    );
}

// insulation5  (layer wall/insulation): baked, made by _separateSolids()
module insulation5_2() {
    color([0.133, 0.133, 0.133]) polyhedron(
        points = [[3069, -60, 2175], [3069, 60, 2175], [3396, 60, 2175], [3396, -60, 2175], [3069, 60, 2462], [3396, 60, 2462], [3069, -60, 2462], [3396, -60, 2462]],
        faces = [[3, 2, 1, 0], [5, 4, 1, 2], [7, 3, 0, 6], [4, 5, 7, 6], [5, 2, 3, 7], [6, 0, 1, 4]]
    );
}

// insulation6  (layer wall/insulation)
module insulation6() {
    color([0.133, 0.133, 0.133]) difference() {
        translate([3820.5, 0, 1250]) cube([283, 120, 2424], center = true);
        multmatrix([[1, 0, 0, 630], [0, 0, -1, 120], [0, 1, 0, 863], [0, 0, 0, 1]]) linear_extrude(height = 240) polygon([[0, 0], [1274, 0], [1274, 1474], [0, 1474]]);
        translate([630, 0, 1250]) cube([76, 132, 2500], center = true);
        translate([1904, 0, 1250]) cube([76, 132, 2500], center = true);
        multmatrix([[1, 0, 0, 2460], [0, 0, -1, 120], [0, 1, 0, 1], [0, 0, 0, 1]]) linear_extrude(height = 240) polygon([[0, 0], [974, 0], [974, 2174], [0, 2174]]);
        translate([2460, 0, 1250]) cube([76, 132, 2500], center = true);
        translate([3434, 0, 1250]) cube([76, 132, 2500], center = true);
    }
}

// Polygon: 2D, drawn in its own plane: origin [600, 0, 900], x [1, 0, 0], y [0, 0, 1]
module Polygon() {
    polygon([[0, 0], [1200, 0], [1200, 1400], [0, 1400]]);
}

// Polygon: 2D, drawn in its own plane: origin [2400, 0, 38], x [1, 0, 0], y [0, 0, 1]
module Polygon_2() {
    polygon([[0, 0], [900, 0], [900, 2100], [0, 2100]]);
}

// frameBottom  (layer Frame)
module frameBottom() {
    translate([2947, 0, 20]) cube([974, 120, 38], center = true);
}

// 3D parts
if (PART == "" || PART == "stud0") stud0();
if (PART == "" || PART == "stud6") stud6();
if (PART == "" || PART == "endstud") endstud();
if (PART == "" || PART == "bottomplate") bottomplate();
if (PART == "" || PART == "topplate") topplate();
if (PART == "" || PART == "crippleTop") crippleTop();
if (PART == "" || PART == "crippleTop_2") crippleTop_2();
if (PART == "" || PART == "crippleTop_3") crippleTop_3();
if (PART == "" || PART == "crippleBottom") crippleBottom();
if (PART == "" || PART == "crippleBottom_2") crippleBottom_2();
if (PART == "" || PART == "openingHorizontal") openingHorizontal();
if (PART == "" || PART == "openingHorizontal_2") openingHorizontal_2();
if (PART == "" || PART == "openingHorizontal_3") openingHorizontal_3();
if (PART == "" || PART == "openingVertical") openingVertical();
if (PART == "" || PART == "openingVertical_2") openingVertical_2();
if (PART == "" || PART == "openingVertical_3") openingVertical_3();
if (PART == "" || PART == "openingVertical_4") openingVertical_4();
if (PART == "" || PART == "openingKingStudLeft") openingKingStudLeft();
if (PART == "" || PART == "openingKingStudRight") openingKingStudRight();
if (PART == "" || PART == "openingKingStudLeft_2") openingKingStudLeft_2();
if (PART == "" || PART == "openingKingStudRight_2") openingKingStudRight_2();
if (PART == "" || PART == "openingJackLeftBottom") openingJackLeftBottom();
if (PART == "" || PART == "openingJackRightBottom") openingJackRightBottom();
if (PART == "" || PART == "openingJackLeftTop") openingJackLeftTop();
if (PART == "" || PART == "openingJackRightTop") openingJackRightTop();
if (PART == "" || PART == "openingJackLeftTop_2") openingJackLeftTop_2();
if (PART == "" || PART == "openingJackRightTop_2") openingJackRightTop_2();
if (PART == "" || PART == "insulation0") insulation0();
if (PART == "" || PART == "insulation1") insulation1();
if (PART == "" || PART == "insulation1_2") insulation1_2();
if (PART == "" || PART == "insulation2") insulation2();
if (PART == "" || PART == "insulation2_2") insulation2_2();
if (PART == "" || PART == "insulation3") insulation3();
if (PART == "" || PART == "insulation3_2") insulation3_2();
if (PART == "" || PART == "insulation3_3") insulation3_3();
if (PART == "" || PART == "insulation4") insulation4();
if (PART == "" || PART == "insulation5") insulation5();
if (PART == "" || PART == "insulation5_2") insulation5_2();
if (PART == "" || PART == "insulation6") insulation6();
if (PART == "" || PART == "frameBottom") frameBottom();
// 2D parts: select one with PART (OpenSCAD cannot render 2D and 3D together)
if (PART == "Polygon") Polygon();
if (PART == "Polygon_2") Polygon_2();
