// Archiyou -> OpenSCAD  |  script: simplestep  |  units: mm
// OpenSCAD has no units: coordinates are in mm.
// Parts: 36 CSG, 4 baked, 0 2D
//   baked: Mesh (cutoffBy() kept one piece of a side that fell apart)
//   baked: beamDiagonal (cutoffBy() kept one piece of a side that fell apart)
//   baked: beamDiagonal_2 (cutoffBy() kept one piece of a side that fell apart)
//   baked: Mesh_12 (cutoffBy() kept one piece of a side that fell apart)
// Skipped: stepProfile (open curve), diagonal (open curve), verticalBack (open curve)
// Parameters at export, for reference only (nothing in this file is linked to them):
//   HEIGHT = 60
//   WIDTH = 50
//   BEAM_WIDTH = 50
//   BEAM_THICKNESS = 25
//   WITH_TREADS = true

$fn = 32;
PART = "";

// beamVertical  (layer diagram)
module beamVertical() {
    color([0, 0, 1]) multmatrix([[0, 0, -1, 600], [0, 1, 0, 0], [1, 0, 0, 0], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [650, 0], [650, 50], [0, 50]]);
}

// Mesh  (layer diagram): baked, cutoffBy() kept one piece of a side that fell apart
module Mesh() {
    color([0, 0, 1]) polyhedron(
        points = [[564.644660941, 0, 685.355339059], [600, 0, 650], [600, -25, 650], [564.644660941, -25, 685.355339059], [-85.3553390593, -25, 35.3553390593], [-85.3553390593, 0, 35.3553390593], [-50, 0, 0], [-50, -25, 0]],
        faces = [[0, 1, 2, 3], [3, 4, 5, 0], [5, 6, 1, 0], [6, 5, 4, 7], [7, 4, 3, 2], [2, 1, 6, 7]]
    );
}

// beamDiagonal  (layer side): baked, cutoffBy() kept one piece of a side that fell apart
module beamDiagonal() {
    color([1, 0, 0]) polyhedron(
        points = [[-85.3553390593, -25, 35.3553390593], [564.644660941, -25, 685.355339059], [600, -25, 650], [-50, -25, 0], [600, 0, 650], [-50, 0, 0], [564.644660941, 0, 685.355339059], [-85.3553390593, 0, 35.3553390593]],
        faces = [[0, 1, 2, 3], [3, 2, 4, 5], [2, 1, 6, 4], [4, 6, 7, 5], [7, 6, 1, 0], [0, 3, 5, 7]]
    );
}

// Mesh  (layer side)
module Mesh_2() {
    color([1, 0, 0]) multmatrix([[0, 0, 1, 0], [1, 0, 0, -25], [0, 1, 0, 250], [0, 0, 0, 1]]) linear_extrude(height = 50) polygon([[0, 0], [550, 0], [550, 25], [0, 25]]);
}

// Mesh  (layer side)
module Mesh_3() {
    color([1, 0, 0]) multmatrix([[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 250], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [600, 0], [600, -50], [0, -50]]);
}

// Mesh  (layer side)
module Mesh_4() {
    color([1, 0, 0]) multmatrix([[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 250], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [600, 0], [600, -50], [0, -50]]);
}

// Mesh  (layer side)
module Mesh_5() {
    color([1, 0, 0]) multmatrix([[0, 0, 1, 200], [1, 0, 0, -25], [0, 1, 0, 450], [0, 0, 0, 1]]) linear_extrude(height = 50) polygon([[0, 0], [550, 0], [550, 25], [0, 25]]);
}

// Mesh  (layer side)
module Mesh_6() {
    color([1, 0, 0]) multmatrix([[1, 0, 0, 200], [0, 0, -1, 0], [0, 1, 0, 450], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [400, 0], [400, -50], [0, -50]]);
}

// Mesh  (layer side)
module Mesh_7() {
    color([1, 0, 0]) multmatrix([[1, 0, 0, 200], [0, 0, -1, 0], [0, 1, 0, 450], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [400, 0], [400, -50], [0, -50]]);
}

// Mesh  (layer side)
module Mesh_8() {
    color([1, 0, 0]) multmatrix([[0, 0, 1, 400], [1, 0, 0, -25], [0, 1, 0, 650], [0, 0, 0, 1]]) linear_extrude(height = 50) polygon([[0, 0], [550, 0], [550, 25], [0, 25]]);
}

// Mesh  (layer side)
module Mesh_9() {
    color([1, 0, 0]) multmatrix([[1, 0, 0, 400], [0, 0, -1, 0], [0, 1, 0, 650], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [200, 0], [200, -50], [0, -50]]);
}

// Mesh  (layer side)
module Mesh_10() {
    color([1, 0, 0]) multmatrix([[1, 0, 0, 400], [0, 0, -1, 0], [0, 1, 0, 650], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [200, 0], [200, -50], [0, -50]]);
}

// beamVerticalCrossed  (layer side)
module beamVerticalCrossed() {
    color([1, 0, 0]) multmatrix([[0, 0, -1, 600], [1, 0, 0, 0], [0, -1, 0, 0], [0, 0, 0, 1]]) linear_extrude(height = 600) polygon([[0, 0], [50, 0], [50, 25], [0, 25]]);
}

// Mesh  (layer side)
module Mesh_11() {
    color([1, 0, 0]) multmatrix([[0, 0, 1, 600], [0.482333958742, -0.875987415574, 0, 0], [0.875987415574, 0.482333958742, 0, 274.806946918], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [428.308725002, 0], [428.308725002, -50], [0, -50]]);
}

// beamDiagonalRight  (layer side)
module beamDiagonalRight() {
    color([1, 0, 0]) multmatrix([[0, 0, 1, 600], [0.482333958742, -0.875987415574, 0, 0], [0.875987415574, 0.482333958742, 0, 274.806946918], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [428.308725002, 0], [428.308725002, -50], [0, -50]]);
}

// beamDiagonal  (layer side): baked, cutoffBy() kept one piece of a side that fell apart
module beamDiagonal_2() {
    color([1, 0, 0]) polyhedron(
        points = [[-85.3553390593, 525, 35.3553390593], [-50, 525, 0], [600, 525, 650], [564.644660941, 525, 685.355339059], [564.644660941, 500, 685.355339059], [600, 500, 650], [-50, 500, 0], [-85.3553390593, 500, 35.3553390593]],
        faces = [[0, 1, 2, 3], [4, 3, 2, 5], [1, 6, 5, 2], [7, 0, 3, 4], [7, 4, 5, 6], [6, 1, 0, 7]]
    );
}

// beamVertical  (layer side)
module beamVertical_2() {
    color([1, 0, 0]) multmatrix([[0, 0, -1, 600], [0, -1, 0, 500], [1, 0, 0, 0], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [650, 0], [650, 50], [0, 50]]);
}

// Mesh  (layer side): baked, cutoffBy() kept one piece of a side that fell apart
module Mesh_12() {
    color([1, 0, 0]) polyhedron(
        points = [[0, 500, 50], [0, 450, 50], [-25, 450, 50], [-25, 500, 50], [-25, 450, 250], [-25, 500, 250], [0, 450, 250], [0, 500, 250]],
        faces = [[3, 2, 1, 0], [2, 3, 5, 4], [2, 4, 6, 1], [1, 6, 7, 0], [7, 6, 4, 5], [0, 7, 5, 3]]
    );
}

// Mesh  (layer side)
module Mesh_13() {
    color([1, 0, 0]) multmatrix([[0, 0, -1, 200], [0, -1, 0, 500], [1, 0, 0, 250], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [200, 0], [200, 50], [0, 50]]);
}

// Mesh  (layer side)
module Mesh_14() {
    color([1, 0, 0]) multmatrix([[0, 0, -1, 400], [0, -1, 0, 500], [1, 0, 0, 450], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [200, 0], [200, 50], [0, 50]]);
}

// Mesh  (layer side)
module Mesh_15() {
    color([1, 0, 0]) multmatrix([[1, 0, 0, 0], [0, 0, 1, 500], [0, 1, 0, 250], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [600, 0], [600, -50], [0, -50]]);
}

// Mesh  (layer side)
module Mesh_16() {
    color([1, 0, 0]) multmatrix([[1, 0, 0, 200], [0, 0, 1, 500], [0, 1, 0, 450], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [400, 0], [400, -50], [0, -50]]);
}

// Mesh  (layer side)
module Mesh_17() {
    color([1, 0, 0]) multmatrix([[1, 0, 0, 400], [0, 0, 1, 500], [0, 1, 0, 650], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [200, 0], [200, -50], [0, -50]]);
}

// beamVerticalCrossed  (layer side)
module beamVerticalCrossed_2() {
    color([1, 0, 0]) multmatrix([[0, 0, -1, 600], [-1, 0, 0, 500], [0, -1, 0, 0], [0, 0, 0, 1]]) linear_extrude(height = 600) polygon([[0, 0], [50, 0], [50, 25], [0, 25]]);
}

// beamDiagonalLeft  (layer side)
module beamDiagonalLeft() {
    color([1, 0, 0]) multmatrix([[0, 0, 1, 600], [-0.482333958742, 0.875987415574, 0, 500], [0.875987415574, 0.482333958742, 0, 274.806946918], [0, 0, 0, 1]]) linear_extrude(height = 25) polygon([[0, 0], [428.308725002, 0], [428.308725002, -50], [0, -50]]);
}

// beamLateralBottomFront  (layer side)
module beamLateralBottomFront() {
    color([1, 0, 0]) multmatrix([[0, 1, 0, 575], [1, 0, 0, -25], [0, 0, -1, 250], [0, 0, 0, 1]]) linear_extrude(height = 50) polygon([[0, 0], [500, 0], [500, -25], [0, -25]]);
}

// beamLateralBottomBack  (layer side)
module beamLateralBottomBack() {
    color([1, 0, 0]) multmatrix([[0, 1, 0, 625], [1, 0, 0, 0], [0, 0, -1, 250], [0, 0, 0, 1]]) linear_extrude(height = 50) polygon([[0, 0], [450, 0], [450, -25], [0, -25]]);
}

// threadPlank21  (layer threads)
module threadPlank21() {
    color([0, 0.502, 0]) multmatrix([[1, 0, 0, 42.5], [0, 0, -1, -25], [0, 1, 0, 275], [0, 0, 0, 1]]) linear_extrude(height = 550) polygon([[0, 0], [50, 0], [50, 25], [0, 25]]);
}

// threadPlank31  (layer threads)
module threadPlank31() {
    color([0, 0.502, 0]) multmatrix([[1, 0, 0, 97.5], [0, 0, -1, -25], [0, 1, 0, 275], [0, 0, 0, 1]]) linear_extrude(height = 550) polygon([[0, 0], [50, 0], [50, 25], [0, 25]]);
}

// threadPlank41  (layer threads)
module threadPlank41() {
    color([0, 0.502, 0]) multmatrix([[1, 0, 0, 152.5], [0, 0, -1, -25], [0, 1, 0, 275], [0, 0, 0, 1]]) linear_extrude(height = 550) polygon([[0, 0], [50, 0], [50, 25], [0, 25]]);
}

// threadPlank11  (layer threads)
module threadPlank11() {
    color([0, 0.502, 0]) multmatrix([[1, 0, 0, 187.5], [0, 0, -1, -25], [0, 1, 0, 475], [0, 0, 0, 1]]) linear_extrude(height = 550) polygon([[0, 0], [50, 0], [50, 25], [0, 25]]);
}

// threadPlank21  (layer threads)
module threadPlank21_2() {
    color([0, 0.502, 0]) multmatrix([[1, 0, 0, 242.5], [0, 0, -1, -25], [0, 1, 0, 475], [0, 0, 0, 1]]) linear_extrude(height = 550) polygon([[0, 0], [50, 0], [50, 25], [0, 25]]);
}

// threadPlank31  (layer threads)
module threadPlank31_2() {
    color([0, 0.502, 0]) multmatrix([[1, 0, 0, 297.5], [0, 0, -1, -25], [0, 1, 0, 475], [0, 0, 0, 1]]) linear_extrude(height = 550) polygon([[0, 0], [50, 0], [50, 25], [0, 25]]);
}

// threadPlank41  (layer threads)
module threadPlank41_2() {
    color([0, 0.502, 0]) multmatrix([[1, 0, 0, 352.5], [0, 0, -1, -25], [0, 1, 0, 475], [0, 0, 0, 1]]) linear_extrude(height = 550) polygon([[0, 0], [50, 0], [50, 25], [0, 25]]);
}

// topThreadPlank11  (layer threads)
module topThreadPlank11() {
    color([0, 0.502, 0]) multmatrix([[1, 0, 0, 387.5], [0, 0, -1, -25], [0, 1, 0, 675], [0, 0, 0, 1]]) linear_extrude(height = 550) polygon([[0, 0], [50, 0], [50, 25], [0, 25]]);
}

// topThreadPlank21  (layer threads)
module topThreadPlank21() {
    color([0, 0.502, 0]) multmatrix([[1, 0, 0, 442.5], [0, 0, -1, -25], [0, 1, 0, 675], [0, 0, 0, 1]]) linear_extrude(height = 550) polygon([[0, 0], [50, 0], [50, 25], [0, 25]]);
}

// topThreadPlank31  (layer threads)
module topThreadPlank31() {
    color([0, 0.502, 0]) multmatrix([[1, 0, 0, 497.5], [0, 0, -1, -25], [0, 1, 0, 675], [0, 0, 0, 1]]) linear_extrude(height = 550) polygon([[0, 0], [50, 0], [50, 25], [0, 25]]);
}

// topThreadPlank41  (layer threads)
module topThreadPlank41() {
    color([0, 0.502, 0]) multmatrix([[1, 0, 0, 552.5], [0, 0, -1, -25], [0, 1, 0, 675], [0, 0, 0, 1]]) linear_extrude(height = 550) polygon([[0, 0], [50, 0], [50, 25], [0, 25]]);
}

// topThreadPlank51  (layer threads)
module topThreadPlank51() {
    color([0, 0.502, 0]) multmatrix([[1, 0, 0, 607.5], [0, 0, -1, -25], [0, 1, 0, 675], [0, 0, 0, 1]]) linear_extrude(height = 550) polygon([[0, 0], [50, 0], [50, 25], [0, 25]]);
}

// topThreadPlank61  (layer threads)
module topThreadPlank61() {
    color([0, 0.502, 0]) multmatrix([[1, 0, 0, 662.5], [0, 0, -1, -25], [0, 1, 0, 675], [0, 0, 0, 1]]) linear_extrude(height = 550) polygon([[0, 0], [50, 0], [50, 25], [0, 25]]);
}

// 3D parts
if (PART == "" || PART == "beamVertical") beamVertical();
if (PART == "" || PART == "Mesh") Mesh();
if (PART == "" || PART == "beamDiagonal") beamDiagonal();
if (PART == "" || PART == "Mesh_2") Mesh_2();
if (PART == "" || PART == "Mesh_3") Mesh_3();
if (PART == "" || PART == "Mesh_4") Mesh_4();
if (PART == "" || PART == "Mesh_5") Mesh_5();
if (PART == "" || PART == "Mesh_6") Mesh_6();
if (PART == "" || PART == "Mesh_7") Mesh_7();
if (PART == "" || PART == "Mesh_8") Mesh_8();
if (PART == "" || PART == "Mesh_9") Mesh_9();
if (PART == "" || PART == "Mesh_10") Mesh_10();
if (PART == "" || PART == "beamVerticalCrossed") beamVerticalCrossed();
if (PART == "" || PART == "Mesh_11") Mesh_11();
if (PART == "" || PART == "beamDiagonalRight") beamDiagonalRight();
if (PART == "" || PART == "beamDiagonal_2") beamDiagonal_2();
if (PART == "" || PART == "beamVertical_2") beamVertical_2();
if (PART == "" || PART == "Mesh_12") Mesh_12();
if (PART == "" || PART == "Mesh_13") Mesh_13();
if (PART == "" || PART == "Mesh_14") Mesh_14();
if (PART == "" || PART == "Mesh_15") Mesh_15();
if (PART == "" || PART == "Mesh_16") Mesh_16();
if (PART == "" || PART == "Mesh_17") Mesh_17();
if (PART == "" || PART == "beamVerticalCrossed_2") beamVerticalCrossed_2();
if (PART == "" || PART == "beamDiagonalLeft") beamDiagonalLeft();
if (PART == "" || PART == "beamLateralBottomFront") beamLateralBottomFront();
if (PART == "" || PART == "beamLateralBottomBack") beamLateralBottomBack();
if (PART == "" || PART == "threadPlank21") threadPlank21();
if (PART == "" || PART == "threadPlank31") threadPlank31();
if (PART == "" || PART == "threadPlank41") threadPlank41();
if (PART == "" || PART == "threadPlank11") threadPlank11();
if (PART == "" || PART == "threadPlank21_2") threadPlank21_2();
if (PART == "" || PART == "threadPlank31_2") threadPlank31_2();
if (PART == "" || PART == "threadPlank41_2") threadPlank41_2();
if (PART == "" || PART == "topThreadPlank11") topThreadPlank11();
if (PART == "" || PART == "topThreadPlank21") topThreadPlank21();
if (PART == "" || PART == "topThreadPlank31") topThreadPlank31();
if (PART == "" || PART == "topThreadPlank41") topThreadPlank41();
if (PART == "" || PART == "topThreadPlank51") topThreadPlank51();
if (PART == "" || PART == "topThreadPlank61") topThreadPlank61();
