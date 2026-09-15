// Archiyou -> OpenSCAD  |  script: sedia  |  units: mm
// OpenSCAD has no units: coordinates are in mm.
// Parts: 20 CSG, 0 baked, 0 2D
// Parameters at export, for reference only (nothing in this file is linked to them):
//   WIDTH_NUM_BOARDS = 4

$fn = 32;
PART = "";

// base front  (layer seat)
module base_front() {
    color([1, 0, 0]) translate([250, 12.5, 410]) cube([500, 25, 100], center = true);
}

// base front  (layer seat)
module base_front_2() {
    color([1, 0, 0]) translate([250, 12.5, 310]) cube([500, 25, 100], center = true);
}

// base back  (layer seat)
module base_back() {
    color([1, 0, 0]) translate([250, 507.5, 370]) cube([500, 25, 100], center = true);
}

// base back  (layer seat)
module base_back_2() {
    color([1, 0, 0]) translate([250, 507.5, 270]) cube([500, 25, 100], center = true);
}

// base left  (layer seat)
module base_left() {
    color([1, 0, 0]) translate([37.5, 260, 290]) cube([25, 470, 100], center = true);
}

// base left  (layer seat)
module base_left_2() {
    color([1, 0, 0]) translate([37.5, 260, 390]) cube([25, 470, 100], center = true);
}

// base right  (layer seat)
module base_right() {
    color([1, 0, 0]) multmatrix([[-1, 0, 0, 462.5], [0, 1, 0, 260], [0, 0, 1, 290], [0, 0, 0, 1]]) cube([25, 470, 100], center = true);
}

// base right  (layer seat)
module base_right_2() {
    color([1, 0, 0]) multmatrix([[-1, 0, 0, 462.5], [0, 1, 0, 260], [0, 0, 1, 390], [0, 0, 0, 1]]) cube([25, 470, 100], center = true);
}

// seat board  (layer seat)
module seat_board() {
    color([1, 0, 0]) multmatrix([[0, -1, 0, 50], [-0.997054485502, 0, -0.0766964988847, 520], [0.0766964988847, 0, -0.997054485502, 420], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [521.536192416, 0], [521.536192416, -100], [0, -100]]);
}

// seat board  (layer seat)
module seat_board_2() {
    color([1, 0, 0]) multmatrix([[0, -1, 0, 150], [-0.997054485502, 0, -0.0766964988847, 520], [0.0766964988847, 0, -0.997054485502, 420], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [521.536192416, 0], [521.536192416, -100], [0, -100]]);
}

// seat board  (layer seat)
module seat_board_3() {
    color([1, 0, 0]) multmatrix([[0, -1, 0, 250], [-0.997054485502, 0, -0.0766964988847, 520], [0.0766964988847, 0, -0.997054485502, 420], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [521.536192416, 0], [521.536192416, -100], [0, -100]]);
}

// seat board  (layer seat)
module seat_board_4() {
    color([1, 0, 0]) multmatrix([[0, -1, 0, 350], [-0.997054485502, 0, -0.0766964988847, 520], [0.0766964988847, 0, -0.997054485502, 420], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [521.536192416, 0], [521.536192416, -100], [0, -100]]);
}

// leg front left  (layer legs)
module leg_front_left() {
    color([0, 0, 1]) translate([12.5, 50, 220]) cube([25, 50, 440], center = true);
}

// leg front right  (layer legs)
module leg_front_right() {
    color([0, 0, 1]) translate([487.5, 50, 220]) cube([25, 50, 440], center = true);
}

// leg back left  (layer legs)
module leg_back_left() {
    color([0, 0, 1]) translate([12.5, 470, 220]) cube([25, 50, 440], center = true);
}

// leg back right  (layer legs)
module leg_back_right() {
    color([0, 0, 1]) translate([487.5, 470, 220]) cube([25, 50, 440], center = true);
}

// back rest diagonal  (layer back)
module back_rest_diagonal() {
    color([0, 0.502, 0]) multmatrix([[0, 1, 0, 25], [0.196116135138, 0, 0.980580675691, 405], [0.980580675691, 0, -0.196116135138, 240], [0, 0, 0, 1]]) linear_extrude(height = 50) polygon([[0, 0], [610, 0], [610, -25], [0, -25]]);
}

// back rest diagonal  (layer back)
module back_rest_diagonal_2() {
    color([0, 0.502, 0]) multmatrix([[0, -1, 0, 475], [0.196116135138, 0, 0.980580675691, 405], [0.980580675691, 0, -0.196116135138, 240], [0, 0, 0, 1]]) linear_extrude(height = 50) polygon([[0, 0], [610, 0], [610, -25], [0, -25]]);
}

// back rest plank  (layer back)
module back_rest_plank() {
    color([0, 0.502, 0]) multmatrix([[1, 0, 0, 0], [0, -0.196116135138, 0.980580675691, 524.630842434], [0, -0.980580675691, -0.196116135138, 838.154212171], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [475, 0], [475, 100], [0, 100]]);
}

// back rest plank  (layer back)
module back_rest_plank_2() {
    color([0, 0.502, 0]) multmatrix([[1, 0, 0, 0], [0, -0.196116135138, 0.980580675691, 505.01922892], [0, -0.980580675691, -0.196116135138, 740.096144602], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [475, 0], [475, 100], [0, 100]]);
}

// 3D parts
if (PART == "" || PART == "base_front") base_front();
if (PART == "" || PART == "base_front_2") base_front_2();
if (PART == "" || PART == "base_back") base_back();
if (PART == "" || PART == "base_back_2") base_back_2();
if (PART == "" || PART == "base_left") base_left();
if (PART == "" || PART == "base_left_2") base_left_2();
if (PART == "" || PART == "base_right") base_right();
if (PART == "" || PART == "base_right_2") base_right_2();
if (PART == "" || PART == "seat_board") seat_board();
if (PART == "" || PART == "seat_board_2") seat_board_2();
if (PART == "" || PART == "seat_board_3") seat_board_3();
if (PART == "" || PART == "seat_board_4") seat_board_4();
if (PART == "" || PART == "leg_front_left") leg_front_left();
if (PART == "" || PART == "leg_front_right") leg_front_right();
if (PART == "" || PART == "leg_back_left") leg_back_left();
if (PART == "" || PART == "leg_back_right") leg_back_right();
if (PART == "" || PART == "back_rest_diagonal") back_rest_diagonal();
if (PART == "" || PART == "back_rest_diagonal_2") back_rest_diagonal_2();
if (PART == "" || PART == "back_rest_plank") back_rest_plank();
if (PART == "" || PART == "back_rest_plank_2") back_rest_plank_2();
