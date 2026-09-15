// Archiyou -> OpenSCAD  |  script: boxpubtest  |  units: mm
// OpenSCAD has no units: coordinates are in mm.
// Parts: 1 CSG, 0 baked, 0 2D
// Parameters at export, for reference only (nothing in this file is linked to them):
//   SIZE = 50

$fn = 32;
PART = "";

// Mesh:Box
module Mesh_Box() {
    cube([50, 50, 50], center = true);
}

// 3D parts
if (PART == "" || PART == "Mesh_Box") Mesh_Box();
