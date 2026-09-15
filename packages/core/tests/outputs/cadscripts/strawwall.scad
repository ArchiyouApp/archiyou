// Archiyou -> OpenSCAD  |  script: strawwall  |  units: mm
// OpenSCAD has no units: coordinates are in mm.
// Parts: 48 CSG, 0 baked, 0 2D
// Skipped: gridline (open curve), gridline11 (open curve), gridline21 (open curve), gridline31 (open curve), gridline41 (open curve), gridline51 (open curve), gridline61 (open curve), gridline71 (open curve)
// Parameters at export, for reference only (nothing in this file is linked to them):
//   LENGTH = 300
//   HEIGHT = 200
//   SYSTEM = "RFCP-2"
//   BALE_THICKNESS = 370
//   BALE_WIDTH = 470
//   BALE_LENGTH = 600
//   BEAM_SECTION_AUTO = true
//   BEAM_SECTION_WIDTH = 35
//   BEAM_SECTION_HEIGHT = 70
//   HIDE_BALES = false

$fn = 32;
PART = "";

// bottom board  (layer bottomplate)
module bottom_board() {
    color([0.647, 0.165, 0.165]) translate([1500, 185, 9]) cube([3000, 370, 18], center = true);
}

// bottom plate  (layer bottomplate)
module bottom_plate() {
    color([0, 0.502, 0]) translate([1500, 35, 33]) cube([2964, 70, 30], center = true);
}

// bottom plate back  (layer bottomplate)
module bottom_plate_back() {
    color([0, 0.502, 0]) translate([1500, 335, 33]) cube([2964, 70, 30], center = true);
}

// stud11  (layer studs)
module stud11() {
    color([0, 0, 1]) translate([33, 35, 1000]) cube([30, 70, 1904], center = true);
}

// stud21  (layer studs)
module stud21() {
    color([0, 0, 1]) translate([528, 35, 1000]) cube([30, 70, 1904], center = true);
}

// stud31  (layer studs)
module stud31() {
    color([0, 0, 1]) translate([1023, 35, 1000]) cube([30, 70, 1904], center = true);
}

// stud41  (layer studs)
module stud41() {
    color([0, 0, 1]) translate([1518, 35, 1000]) cube([30, 70, 1904], center = true);
}

// stud51  (layer studs)
module stud51() {
    color([0, 0, 1]) translate([2013, 35, 1000]) cube([30, 70, 1904], center = true);
}

// stud61  (layer studs)
module stud61() {
    color([0, 0, 1]) translate([2508, 35, 1000]) cube([30, 70, 1904], center = true);
}

// studBack  (layer studs)
module studBack() {
    color([0, 0, 1]) translate([33, 335, 1000]) cube([30, 70, 1904], center = true);
}

// stud11  (layer studs)
module stud11_2() {
    color([0, 0, 1]) translate([33, 335, 1000]) cube([30, 70, 1904], center = true);
}

// stud21  (layer studs)
module stud21_2() {
    color([0, 0, 1]) translate([528, 335, 1000]) cube([30, 70, 1904], center = true);
}

// stud31  (layer studs)
module stud31_2() {
    color([0, 0, 1]) translate([1023, 335, 1000]) cube([30, 70, 1904], center = true);
}

// stud41  (layer studs)
module stud41_2() {
    color([0, 0, 1]) translate([1518, 335, 1000]) cube([30, 70, 1904], center = true);
}

// stud51  (layer studs)
module stud51_2() {
    color([0, 0, 1]) translate([2013, 335, 1000]) cube([30, 70, 1904], center = true);
}

// stud61  (layer studs)
module stud61_2() {
    color([0, 0, 1]) translate([2508, 335, 1000]) cube([30, 70, 1904], center = true);
}

// lastStudFront  (layer studs)
module lastStudFront() {
    color([0.502, 0, 0.502]) translate([2967, 35, 1000]) cube([30, 70, 1904], center = true);
}

// lastStudBack  (layer studs)
module lastStudBack() {
    color([0.502, 0, 0.502]) translate([2967, 335, 1000]) cube([30, 70, 1904], center = true);
}

// side board  (layer sideboards)
module side_board() {
    color([0.647, 0.165, 0.165]) translate([9, 185, 1000]) cube([18, 370, 1964], center = true);
}

// side board  (layer sideboards)
module side_board_2() {
    color([0.647, 0.165, 0.165]) translate([2991, 185, 1000]) cube([18, 370, 1964], center = true);
}

// bottom board  (layer topplate)
module bottom_board_2() {
    color([0.647, 0.165, 0.165]) multmatrix([[1, 0, 0, 1500], [0, 1, 0, 185], [0, 0, -1, 1991], [0, 0, 0, 1]]) cube([3000, 370, 18], center = true);
}

// bottom plate  (layer topplate)
module bottom_plate_2() {
    multmatrix([[1, 0, 0, 1500], [0, 1, 0, 35], [0, 0, -1, 1967], [0, 0, 0, 1]]) cube([2964, 70, 30], center = true);
}

// bottom plate back  (layer topplate)
module bottom_plate_back_2() {
    multmatrix([[1, 0, 0, 1500], [0, 1, 0, 335], [0, 0, -1, 1967], [0, 0, 0, 1]]) cube([2964, 70, 30], center = true);
}

// stud brace11  (layer braces)
module stud_brace11() {
    color([0, 0, 0.392]) translate([33, 185, 53]) cube([30, 230, 70], center = true);
}

// stud brace21  (layer braces)
module stud_brace21() {
    color([0, 0, 0.392]) translate([528, 185, 53]) cube([30, 230, 70], center = true);
}

// stud brace31  (layer braces)
module stud_brace31() {
    color([0, 0, 0.392]) translate([1023, 185, 53]) cube([30, 230, 70], center = true);
}

// stud brace41  (layer braces)
module stud_brace41() {
    color([0, 0, 0.392]) translate([1518, 185, 53]) cube([30, 230, 70], center = true);
}

// stud brace51  (layer braces)
module stud_brace51() {
    color([0, 0, 0.392]) translate([2013, 185, 53]) cube([30, 230, 70], center = true);
}

// stud brace61  (layer braces)
module stud_brace61() {
    color([0, 0, 0.392]) translate([2508, 185, 53]) cube([30, 230, 70], center = true);
}

// lastBraceBottom  (layer braces)
module lastBraceBottom() {
    color([0, 0, 0.392]) translate([2967, 185, 53]) cube([30, 230, 70], center = true);
}

// stud brace11  (layer braces)
module stud_brace11_2() {
    color([0, 0, 0.392]) translate([33, 185, 1005]) cube([30, 230, 70], center = true);
}

// stud brace21  (layer braces)
module stud_brace21_2() {
    color([0, 0, 0.392]) translate([528, 185, 1005]) cube([30, 230, 70], center = true);
}

// stud brace31  (layer braces)
module stud_brace31_2() {
    color([0, 0, 0.392]) translate([1023, 185, 1005]) cube([30, 230, 70], center = true);
}

// stud brace41  (layer braces)
module stud_brace41_2() {
    color([0, 0, 0.392]) translate([1518, 185, 1005]) cube([30, 230, 70], center = true);
}

// stud brace51  (layer braces)
module stud_brace51_2() {
    color([0, 0, 0.392]) translate([2013, 185, 1005]) cube([30, 230, 70], center = true);
}

// stud brace61  (layer braces)
module stud_brace61_2() {
    color([0, 0, 0.392]) translate([2508, 185, 1005]) cube([30, 230, 70], center = true);
}

// lastBraceBottom  (layer braces)
module lastBraceBottom_2() {
    color([0, 0, 0.392]) translate([2967, 185, 1005]) cube([30, 230, 70], center = true);
}

// stud brace11  (layer braces)
module stud_brace11_3() {
    color([0, 0, 0.392]) multmatrix([[1, 0, 0, 33], [0, 1, 0, 185], [0, 0, -1, 1947], [0, 0, 0, 1]]) cube([30, 230, 70], center = true);
}

// stud brace21  (layer braces)
module stud_brace21_3() {
    color([0, 0, 0.392]) multmatrix([[1, 0, 0, 528], [0, 1, 0, 185], [0, 0, -1, 1947], [0, 0, 0, 1]]) cube([30, 230, 70], center = true);
}

// stud brace31  (layer braces)
module stud_brace31_3() {
    color([0, 0, 0.392]) multmatrix([[1, 0, 0, 1023], [0, 1, 0, 185], [0, 0, -1, 1947], [0, 0, 0, 1]]) cube([30, 230, 70], center = true);
}

// stud brace41  (layer braces)
module stud_brace41_3() {
    color([0, 0, 0.392]) multmatrix([[1, 0, 0, 1518], [0, 1, 0, 185], [0, 0, -1, 1947], [0, 0, 0, 1]]) cube([30, 230, 70], center = true);
}

// stud brace51  (layer braces)
module stud_brace51_3() {
    color([0, 0, 0.392]) multmatrix([[1, 0, 0, 2013], [0, 1, 0, 185], [0, 0, -1, 1947], [0, 0, 0, 1]]) cube([30, 230, 70], center = true);
}

// stud brace61  (layer braces)
module stud_brace61_3() {
    color([0, 0, 0.392]) multmatrix([[1, 0, 0, 2508], [0, 1, 0, 185], [0, 0, -1, 1947], [0, 0, 0, 1]]) cube([30, 230, 70], center = true);
}

// lastBraceBottom  (layer braces)
module lastBraceBottom_3() {
    color([0, 0, 0.392]) multmatrix([[1, 0, 0, 2967], [0, 1, 0, 185], [0, 0, -1, 1947], [0, 0, 0, 1]]) cube([30, 230, 70], center = true);
}

// bale111  (layer bales)
module bale111() {
    color([1, 1, 0]) translate([280.5, 185, 348]) cube([465, 370, 600], center = true);
}

// bale112  (layer bales)
module bale112() {
    color([1, 1, 0]) translate([280.5, 185, 948]) cube([465, 370, 600], center = true);
}

// bale113  (layer bales)
module bale113() {
    color([1, 1, 0]) translate([280.5, 185, 1548]) cube([465, 370, 600], center = true);
}

// bale cut  (layer bales)
module bale_cut() {
    color([1, 1, 0]) translate([280.5, 185, 1900]) cube([465, 370, 104], center = true);
}

// 3D parts
if (PART == "" || PART == "bottom_board") bottom_board();
if (PART == "" || PART == "bottom_plate") bottom_plate();
if (PART == "" || PART == "bottom_plate_back") bottom_plate_back();
if (PART == "" || PART == "stud11") stud11();
if (PART == "" || PART == "stud21") stud21();
if (PART == "" || PART == "stud31") stud31();
if (PART == "" || PART == "stud41") stud41();
if (PART == "" || PART == "stud51") stud51();
if (PART == "" || PART == "stud61") stud61();
if (PART == "" || PART == "studBack") studBack();
if (PART == "" || PART == "stud11_2") stud11_2();
if (PART == "" || PART == "stud21_2") stud21_2();
if (PART == "" || PART == "stud31_2") stud31_2();
if (PART == "" || PART == "stud41_2") stud41_2();
if (PART == "" || PART == "stud51_2") stud51_2();
if (PART == "" || PART == "stud61_2") stud61_2();
if (PART == "" || PART == "lastStudFront") lastStudFront();
if (PART == "" || PART == "lastStudBack") lastStudBack();
if (PART == "" || PART == "side_board") side_board();
if (PART == "" || PART == "side_board_2") side_board_2();
if (PART == "" || PART == "bottom_board_2") bottom_board_2();
if (PART == "" || PART == "bottom_plate_2") bottom_plate_2();
if (PART == "" || PART == "bottom_plate_back_2") bottom_plate_back_2();
if (PART == "" || PART == "stud_brace11") stud_brace11();
if (PART == "" || PART == "stud_brace21") stud_brace21();
if (PART == "" || PART == "stud_brace31") stud_brace31();
if (PART == "" || PART == "stud_brace41") stud_brace41();
if (PART == "" || PART == "stud_brace51") stud_brace51();
if (PART == "" || PART == "stud_brace61") stud_brace61();
if (PART == "" || PART == "lastBraceBottom") lastBraceBottom();
if (PART == "" || PART == "stud_brace11_2") stud_brace11_2();
if (PART == "" || PART == "stud_brace21_2") stud_brace21_2();
if (PART == "" || PART == "stud_brace31_2") stud_brace31_2();
if (PART == "" || PART == "stud_brace41_2") stud_brace41_2();
if (PART == "" || PART == "stud_brace51_2") stud_brace51_2();
if (PART == "" || PART == "stud_brace61_2") stud_brace61_2();
if (PART == "" || PART == "lastBraceBottom_2") lastBraceBottom_2();
if (PART == "" || PART == "stud_brace11_3") stud_brace11_3();
if (PART == "" || PART == "stud_brace21_3") stud_brace21_3();
if (PART == "" || PART == "stud_brace31_3") stud_brace31_3();
if (PART == "" || PART == "stud_brace41_3") stud_brace41_3();
if (PART == "" || PART == "stud_brace51_3") stud_brace51_3();
if (PART == "" || PART == "stud_brace61_3") stud_brace61_3();
if (PART == "" || PART == "lastBraceBottom_3") lastBraceBottom_3();
if (PART == "" || PART == "bale111") bale111();
if (PART == "" || PART == "bale112") bale112();
if (PART == "" || PART == "bale113") bale113();
if (PART == "" || PART == "bale_cut") bale_cut();
