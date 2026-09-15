// Archiyou -> OpenSCAD  |  script: programmaticparams  |  units: mm
// OpenSCAD has no units: coordinates are in mm.
// Parts: 2 CSG, 0 baked, 0 2D
// Parameters at export, for reference only (nothing in this file is linked to them):
//   WIDTH = 200
//   DEPTH = 120
//   HEIGHT = 80
//   SHOW_LID = true

$fn = 32;
PART = "";

module base() {
    color([0, 0, 1]) cube([200, 120, 80], center = true);
}

// Mesh:Box
module Mesh_Box() {
    color([1, 0, 0]) translate([0, 0, 45]) cube([200, 120, 5], center = true);
}

// 3D parts
if (PART == "" || PART == "base") base();
if (PART == "" || PART == "Mesh_Box") Mesh_Box();
