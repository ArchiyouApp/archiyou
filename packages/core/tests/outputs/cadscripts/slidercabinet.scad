// Archiyou -> OpenSCAD  |  script: slidercabinet  |  units: mm
// OpenSCAD has no units: coordinates are in mm.
// Parts: 18 CSG, 0 baked, 0 2D
// Skipped: gridVLineStart1 (open curve), gridVLineStart2 (open curve), gridVLineStart3 (open curve), gridVLineStart4 (open curve)
// Parameters at export, for reference only (nothing in this file is linked to them):
//   WIDTH = 900
//   HEIGHT = 800
//   DIVIDERS = 2
//   SLIDER_DOOR_OPEN = 0

$fn = 32;
PART = "";

// pleft  (layer frame)
module pleft() {
    color([1, 0, 0]) difference() {
        multmatrix([[0, 0, 1, 0], [0, 1, 0, 0], [-1, 0, 0, 400], [0, 0, 0, 1]]) cube([800, 400, 18], center = true);
        translate([-4.5, 0, 4.5]) cube([9, 400, 9], center = true);
        translate([-4.5, 0, 795.5]) cube([9, 400, 9], center = true);
        translate([441, 186.5, 400]) cube([882, 9, 800], center = true);
    }
}

// pright  (layer frame)
module pright() {
    color([1, 0, 0]) difference() {
        multmatrix([[0, 0, -1, 882], [0, 1, 0, 0], [-1, 0, 0, 400], [0, 0, 0, 1]]) cube([800, 400, 18], center = true);
        multmatrix([[-1, 0, 0, 886.5], [0, 1, 0, 0], [0, 0, 1, 4.5], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
        multmatrix([[-1, 0, 0, 886.5], [0, 1, 0, 0], [0, 0, 1, 795.5], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
        translate([441, 186.5, 400]) cube([882, 9, 800], center = true);
    }
}

// pbottom  (layer frame)
module pbottom() {
    color([1, 0, 0]) difference() {
        translate([441, 0, 0]) cube([900, 400, 18], center = true);
        translate([4.5, 0, 4.5]) cube([9, 400, 9], center = true);
        multmatrix([[-1, 0, 0, 877.5], [0, 1, 0, 0], [0, 0, 1, 4.5], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
        translate([294, 9, 400]) cube([18, 346, 800], center = true);
        translate([588, 9, 400]) cube([18, 346, 800], center = true);
        translate([441, 186.5, 400]) cube([882, 9, 800], center = true);
        translate([441, -186.5, 400]) cube([864, 9, 800], center = true);
        translate([441, -168.5, 400]) cube([864, 9, 800], center = true);
    }
}

// ptop  (layer frame)
module ptop() {
    color([1, 0, 0]) difference() {
        multmatrix([[1, 0, 0, 441], [0, 1, 0, 0], [0, 0, -1, 800], [0, 0, 0, 1]]) cube([900, 400, 18], center = true);
        multmatrix([[1, 0, 0, 4.5], [0, 1, 0, 0], [0, 0, -1, 795.5], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
        multmatrix([[-1, 0, 0, 877.5], [0, 1, 0, 0], [0, 0, -1, 795.5], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
        translate([294, 9, 400]) cube([18, 346, 800], center = true);
        translate([588, 9, 400]) cube([18, 346, 800], center = true);
        translate([441, 186.5, 400]) cube([882, 9, 800], center = true);
        translate([441, -186.5, 400]) cube([864, 9, 800], center = true);
        translate([441, -204.5, 400]) cube([864, 9, 800], center = true);
    }
}

// vDivider1  (layer dividers)
module vDivider1() {
    color([0, 0.502, 0]) translate([294, 9, 400]) cube([18, 346, 800], center = true);
}

// vDivider2  (layer dividers)
module vDivider2() {
    color([0, 0.502, 0]) translate([588, 9, 400]) cube([18, 346, 800], center = true);
}

// backplate  (layer backplate)
module backplate() {
    color([0.647, 0.165, 0.165]) difference() {
        translate([441, 191, 400]) cube([882, 18, 800], center = true);
        difference() {
            multmatrix([[0, 0, 1, 0], [0, 1, 0, 0], [-1, 0, 0, 400], [0, 0, 0, 1]]) cube([800, 400, 18], center = true);
            translate([-4.5, 0, 4.5]) cube([9, 400, 9], center = true);
            translate([-4.5, 0, 795.5]) cube([9, 400, 9], center = true);
            translate([441, 186.5, 400]) cube([882, 9, 800], center = true);
        }
        difference() {
            multmatrix([[1, 0, 0, 441], [0, 1, 0, 0], [0, 0, -1, 800], [0, 0, 0, 1]]) cube([900, 400, 18], center = true);
            multmatrix([[1, 0, 0, 4.5], [0, 1, 0, 0], [0, 0, -1, 795.5], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            multmatrix([[-1, 0, 0, 877.5], [0, 1, 0, 0], [0, 0, -1, 795.5], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            translate([294, 9, 400]) cube([18, 346, 800], center = true);
            translate([588, 9, 400]) cube([18, 346, 800], center = true);
            translate([441, 186.5, 400]) cube([882, 9, 800], center = true);
        }
        difference() {
            multmatrix([[0, 0, -1, 882], [0, 1, 0, 0], [-1, 0, 0, 400], [0, 0, 0, 1]]) cube([800, 400, 18], center = true);
            multmatrix([[-1, 0, 0, 886.5], [0, 1, 0, 0], [0, 0, 1, 4.5], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            multmatrix([[-1, 0, 0, 886.5], [0, 1, 0, 0], [0, 0, 1, 795.5], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            translate([441, 186.5, 400]) cube([882, 9, 800], center = true);
        }
        difference() {
            translate([441, 0, 0]) cube([900, 400, 18], center = true);
            translate([4.5, 0, 4.5]) cube([9, 400, 9], center = true);
            multmatrix([[-1, 0, 0, 877.5], [0, 1, 0, 0], [0, 0, 1, 4.5], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            translate([294, 9, 400]) cube([18, 346, 800], center = true);
            translate([588, 9, 400]) cube([18, 346, 800], center = true);
            translate([441, 186.5, 400]) cube([882, 9, 800], center = true);
        }
    }
}

// sliderDoorLeft  (layer sliderdoors)
module sliderDoorLeft() {
    color([0.502, 0, 0.502]) difference() {
        translate([225, -191, 400]) cube([432, 18, 800], center = true);
        difference() {
            translate([441, 0, 0]) cube([900, 400, 18], center = true);
            translate([4.5, 0, 4.5]) cube([9, 400, 9], center = true);
            multmatrix([[-1, 0, 0, 877.5], [0, 1, 0, 0], [0, 0, 1, 4.5], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            translate([294, 9, 400]) cube([18, 346, 800], center = true);
            translate([588, 9, 400]) cube([18, 346, 800], center = true);
            translate([441, 186.5, 400]) cube([882, 9, 800], center = true);
            translate([441, -186.5, 400]) cube([864, 9, 800], center = true);
            translate([441, -168.5, 400]) cube([864, 9, 800], center = true);
        }
        difference() {
            multmatrix([[1, 0, 0, 441], [0, 1, 0, 0], [0, 0, -1, 800], [0, 0, 0, 1]]) cube([900, 400, 18], center = true);
            multmatrix([[1, 0, 0, 4.5], [0, 1, 0, 0], [0, 0, -1, 795.5], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            multmatrix([[-1, 0, 0, 877.5], [0, 1, 0, 0], [0, 0, -1, 795.5], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            translate([294, 9, 400]) cube([18, 346, 800], center = true);
            translate([588, 9, 400]) cube([18, 346, 800], center = true);
            translate([441, 186.5, 400]) cube([882, 9, 800], center = true);
            translate([441, -186.5, 400]) cube([864, 9, 800], center = true);
            translate([441, -204.5, 400]) cube([864, 9, 800], center = true);
        }
        multmatrix([[1, 0, 0, 30], [0, 0, -1, -150], [0, 1, 0, 400], [0, 0, 0, 1]]) cylinder(h = 100, r = 10);
    }
}

// sliderDoorRight  (layer sliderdoors)
module sliderDoorRight() {
    color([0.502, 0, 0.502]) difference() {
        multmatrix([[-1, 0, 0, 657], [0, 1, 0, -173], [0, 0, 1, 400], [0, 0, 0, 1]]) cube([432, 18, 800], center = true);
        difference() {
            multmatrix([[-1, 0, 0, 441], [0, 1, 0, 18], [0, 0, 1, 0], [0, 0, 0, 1]]) cube([900, 400, 18], center = true);
            multmatrix([[-1, 0, 0, 877.5], [0, 1, 0, 18], [0, 0, 1, 4.5], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            translate([4.5, 18, 4.5]) cube([9, 400, 9], center = true);
            multmatrix([[-1, 0, 0, 588], [0, 1, 0, 27], [0, 0, 1, 400], [0, 0, 0, 1]]) cube([18, 346, 800], center = true);
            multmatrix([[-1, 0, 0, 294], [0, 1, 0, 27], [0, 0, 1, 400], [0, 0, 0, 1]]) cube([18, 346, 800], center = true);
            multmatrix([[-1, 0, 0, 441], [0, 1, 0, 204.5], [0, 0, 1, 400], [0, 0, 0, 1]]) cube([882, 9, 800], center = true);
            multmatrix([[-1, 0, 0, 441], [0, 1, 0, -168.5], [0, 0, 1, 400], [0, 0, 0, 1]]) cube([864, 9, 800], center = true);
            multmatrix([[-1, 0, 0, 441], [0, 1, 0, -150.5], [0, 0, 1, 400], [0, 0, 0, 1]]) cube([864, 9, 800], center = true);
        }
        difference() {
            multmatrix([[-1, 0, 0, 441], [0, 1, 0, 18], [0, 0, -1, 800], [0, 0, 0, 1]]) cube([900, 400, 18], center = true);
            multmatrix([[-1, 0, 0, 877.5], [0, 1, 0, 18], [0, 0, -1, 795.5], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            multmatrix([[1, 0, 0, 4.5], [0, 1, 0, 18], [0, 0, -1, 795.5], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            multmatrix([[-1, 0, 0, 588], [0, 1, 0, 27], [0, 0, 1, 400], [0, 0, 0, 1]]) cube([18, 346, 800], center = true);
            multmatrix([[-1, 0, 0, 294], [0, 1, 0, 27], [0, 0, 1, 400], [0, 0, 0, 1]]) cube([18, 346, 800], center = true);
            multmatrix([[-1, 0, 0, 441], [0, 1, 0, 204.5], [0, 0, 1, 400], [0, 0, 0, 1]]) cube([882, 9, 800], center = true);
            multmatrix([[-1, 0, 0, 441], [0, 1, 0, -168.5], [0, 0, 1, 400], [0, 0, 0, 1]]) cube([864, 9, 800], center = true);
            multmatrix([[-1, 0, 0, 441], [0, 1, 0, -186.5], [0, 0, 1, 400], [0, 0, 0, 1]]) cube([864, 9, 800], center = true);
        }
        multmatrix([[-1, 0, 0, 852], [0, 0, -1, -132], [0, 1, 0, 400], [0, 0, 0, 1]]) cylinder(h = 100, r = 10);
    }
}

// pleft  (layer sliderdoors)
module pleft_2() {
    color([0.502, 0, 0.502]) difference() {
        translate([0, -3000, 9]) cube([800, 400, 18], center = true);
        multmatrix([[0, 0, -1, 395.5], [0, 1, 0, -3000], [1, 0, 0, 4.5], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
        multmatrix([[0, 0, -1, -395.5], [0, 1, 0, -3000], [1, 0, 0, 4.5], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
        multmatrix([[0, 0, -1, 0], [0, 1, 0, -2813.5], [1, 0, 0, 450], [0, 0, 0, 1]]) cube([882, 9, 800], center = true);
    }
}

// pright  (layer sliderdoors)
module pright_2() {
    color([0.502, 0, 0.502]) difference() {
        multmatrix([[1, 0, 0, 882], [0, 1, 0, -3000], [0, 0, -1, 9], [0, 0, 0, 1]]) cube([800, 400, 18], center = true);
        multmatrix([[0, 0, -1, 1277.5], [0, 1, 0, -3000], [-1, 0, 0, 13.5], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
        multmatrix([[0, 0, -1, 486.5], [0, 1, 0, -3000], [-1, 0, 0, 13.5], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
        multmatrix([[0, 0, -1, 882], [0, 1, 0, -2813.5], [1, 0, 0, -432], [0, 0, 0, 1]]) cube([882, 9, 800], center = true);
    }
}

// pbottom  (layer sliderdoors)
module pbottom_2() {
    color([0.502, 0, 0.502]) difference() {
        translate([441, -3000, 9]) cube([900, 400, 18], center = true);
        translate([4.5, -3000, 13.5]) cube([9, 400, 9], center = true);
        multmatrix([[-1, 0, 0, 877.5], [0, 1, 0, -3000], [0, 0, 1, 13.5], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
        translate([294, -2991, 409]) cube([18, 346, 800], center = true);
        translate([588, -2991, 409]) cube([18, 346, 800], center = true);
        translate([441, -2813.5, 409]) cube([882, 9, 800], center = true);
        translate([441, -3186.5, 409]) cube([864, 9, 800], center = true);
        translate([441, -3168.5, 409]) cube([864, 9, 800], center = true);
    }
}

// ptop  (layer sliderdoors)
module ptop_2() {
    color([0.502, 0, 0.502]) difference() {
        multmatrix([[1, 0, 0, 441], [0, 1, 0, -3000], [0, 0, -1, 9], [0, 0, 0, 1]]) cube([900, 400, 18], center = true);
        multmatrix([[1, 0, 0, 4.5], [0, 1, 0, -3000], [0, 0, -1, 4.5], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
        multmatrix([[-1, 0, 0, 877.5], [0, 1, 0, -3000], [0, 0, -1, 4.5], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
        translate([294, -2991, -391]) cube([18, 346, 800], center = true);
        translate([588, -2991, -391]) cube([18, 346, 800], center = true);
        translate([441, -2813.5, -391]) cube([882, 9, 800], center = true);
        translate([441, -3186.5, -391]) cube([864, 9, 800], center = true);
        translate([441, -3204.5, -391]) cube([864, 9, 800], center = true);
    }
}

// vDivider1  (layer sliderdoors)
module vDivider1_2() {
    color([0.502, 0, 0.502]) multmatrix([[0, 0, -1, 294], [0, 1, 0, -2991], [1, 0, 0, 9], [0, 0, 0, 1]]) cube([18, 346, 800], center = true);
}

// vDivider2  (layer sliderdoors)
module vDivider2_2() {
    color([0.502, 0, 0.502]) multmatrix([[0, 0, -1, 588], [0, 1, 0, -2991], [1, 0, 0, 9], [0, 0, 0, 1]]) cube([18, 346, 800], center = true);
}

// backplate  (layer sliderdoors)
module backplate_2() {
    color([0.502, 0, 0.502]) difference() {
        multmatrix([[1, 0, 0, 441], [0, 0, -1, -2809.09758132], [0, 1, 0, 9], [0, 0, 0, 1]]) cube([882, 18, 800], center = true);
        difference() {
            multmatrix([[0, 0, 1, 0], [1, 0, 0, -2809.09758132], [0, 1, 0, -182], [0, 0, 0, 1]]) cube([800, 400, 18], center = true);
            multmatrix([[1, 0, 0, -4.5], [0, 0, -1, -2413.59758132], [0, 1, 0, -182], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            multmatrix([[1, 0, 0, -4.5], [0, 0, -1, -3204.59758132], [0, 1, 0, -182], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            multmatrix([[1, 0, 0, 441], [0, 0, -1, -2809.09758132], [0, 1, 0, 4.5], [0, 0, 0, 1]]) cube([882, 9, 800], center = true);
        }
        difference() {
            multmatrix([[1, 0, 0, 441], [0, 0, 1, -3209.09758132], [0, 1, 0, -182], [0, 0, 0, 1]]) cube([900, 400, 18], center = true);
            multmatrix([[1, 0, 0, 4.5], [0, 0, 1, -3204.59758132], [0, 1, 0, -182], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            multmatrix([[-1, 0, 0, 877.5], [0, 0, 1, -3204.59758132], [0, 1, 0, -182], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            multmatrix([[1, 0, 0, 294], [0, 0, -1, -2809.09758132], [0, 1, 0, -173], [0, 0, 0, 1]]) cube([18, 346, 800], center = true);
            multmatrix([[1, 0, 0, 588], [0, 0, -1, -2809.09758132], [0, 1, 0, -173], [0, 0, 0, 1]]) cube([18, 346, 800], center = true);
            multmatrix([[1, 0, 0, 441], [0, 0, -1, -2809.09758132], [0, 1, 0, 4.5], [0, 0, 0, 1]]) cube([882, 9, 800], center = true);
        }
        difference() {
            multmatrix([[0, 0, -1, 882], [1, 0, 0, -2809.09758132], [0, 1, 0, -182], [0, 0, 0, 1]]) cube([800, 400, 18], center = true);
            multmatrix([[-1, 0, 0, 886.5], [0, 0, -1, -2413.59758132], [0, 1, 0, -182], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            multmatrix([[-1, 0, 0, 886.5], [0, 0, -1, -3204.59758132], [0, 1, 0, -182], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            multmatrix([[1, 0, 0, 441], [0, 0, -1, -2809.09758132], [0, 1, 0, 4.5], [0, 0, 0, 1]]) cube([882, 9, 800], center = true);
        }
        difference() {
            multmatrix([[1, 0, 0, 441], [0, 0, -1, -2409.09758132], [0, 1, 0, -182], [0, 0, 0, 1]]) cube([900, 400, 18], center = true);
            multmatrix([[1, 0, 0, 4.5], [0, 0, -1, -2413.59758132], [0, 1, 0, -182], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            multmatrix([[-1, 0, 0, 877.5], [0, 0, -1, -2413.59758132], [0, 1, 0, -182], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            multmatrix([[1, 0, 0, 294], [0, 0, -1, -2809.09758132], [0, 1, 0, -173], [0, 0, 0, 1]]) cube([18, 346, 800], center = true);
            multmatrix([[1, 0, 0, 588], [0, 0, -1, -2809.09758132], [0, 1, 0, -173], [0, 0, 0, 1]]) cube([18, 346, 800], center = true);
            multmatrix([[1, 0, 0, 441], [0, 0, -1, -2809.09758132], [0, 1, 0, 4.5], [0, 0, 0, 1]]) cube([882, 9, 800], center = true);
        }
    }
}

// sliderDoorLeft  (layer sliderdoors)
module sliderDoorLeft_2() {
    color([0.502, 0, 0.502]) difference() {
        multmatrix([[1, 0, 0, 225], [0, 0, -1, -3190.94875218], [0, 1, 0, 9], [0, 0, 0, 1]]) cube([432, 18, 800], center = true);
        difference() {
            multmatrix([[1, 0, 0, 441], [0, 0, -1, -2790.94875218], [0, 1, 0, 200], [0, 0, 0, 1]]) cube([900, 400, 18], center = true);
            multmatrix([[1, 0, 0, 4.5], [0, 0, -1, -2795.44875218], [0, 1, 0, 200], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            multmatrix([[-1, 0, 0, 877.5], [0, 0, -1, -2795.44875218], [0, 1, 0, 200], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            multmatrix([[1, 0, 0, 294], [0, 0, -1, -3190.94875218], [0, 1, 0, 209], [0, 0, 0, 1]]) cube([18, 346, 800], center = true);
            multmatrix([[1, 0, 0, 588], [0, 0, -1, -3190.94875218], [0, 1, 0, 209], [0, 0, 0, 1]]) cube([18, 346, 800], center = true);
            multmatrix([[1, 0, 0, 441], [0, 0, -1, -3190.94875218], [0, 1, 0, 386.5], [0, 0, 0, 1]]) cube([882, 9, 800], center = true);
            multmatrix([[1, 0, 0, 441], [0, 0, -1, -3190.94875218], [0, 1, 0, 13.5], [0, 0, 0, 1]]) cube([864, 9, 800], center = true);
            multmatrix([[1, 0, 0, 441], [0, 0, -1, -3190.94875218], [0, 1, 0, 31.5], [0, 0, 0, 1]]) cube([864, 9, 800], center = true);
        }
        difference() {
            multmatrix([[1, 0, 0, 441], [0, 0, 1, -3590.94875218], [0, 1, 0, 200], [0, 0, 0, 1]]) cube([900, 400, 18], center = true);
            multmatrix([[1, 0, 0, 4.5], [0, 0, 1, -3586.44875218], [0, 1, 0, 200], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            multmatrix([[-1, 0, 0, 877.5], [0, 0, 1, -3586.44875218], [0, 1, 0, 200], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            multmatrix([[1, 0, 0, 294], [0, 0, -1, -3190.94875218], [0, 1, 0, 209], [0, 0, 0, 1]]) cube([18, 346, 800], center = true);
            multmatrix([[1, 0, 0, 588], [0, 0, -1, -3190.94875218], [0, 1, 0, 209], [0, 0, 0, 1]]) cube([18, 346, 800], center = true);
            multmatrix([[1, 0, 0, 441], [0, 0, -1, -3190.94875218], [0, 1, 0, 386.5], [0, 0, 0, 1]]) cube([882, 9, 800], center = true);
            multmatrix([[1, 0, 0, 441], [0, 0, -1, -3190.94875218], [0, 1, 0, 13.5], [0, 0, 0, 1]]) cube([864, 9, 800], center = true);
            multmatrix([[1, 0, 0, 441], [0, 0, -1, -3190.94875218], [0, 1, 0, -4.5], [0, 0, 0, 1]]) cube([864, 9, 800], center = true);
        }
        multmatrix([[1, 0, 0, 30], [0, -1, 0, -3190.94875218], [0, 0, -1, 50], [0, 0, 0, 1]]) cylinder(h = 100, r = 10);
    }
}

// sliderDoorRight  (layer sliderdoors)
module sliderDoorRight_2() {
    color([0.502, 0, 0.502]) difference() {
        multmatrix([[-1, 0, 0, 657], [0, 0, -1, -3172.94875218], [0, 1, 0, 9], [0, 0, 0, 1]]) cube([432, 18, 800], center = true);
        difference() {
            multmatrix([[-1, 0, 0, 441], [0, 0, -1, -2772.94875218], [0, 1, 0, 200], [0, 0, 0, 1]]) cube([900, 400, 18], center = true);
            multmatrix([[-1, 0, 0, 877.5], [0, 0, -1, -2777.44875218], [0, 1, 0, 200], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            multmatrix([[1, 0, 0, 4.5], [0, 0, -1, -2777.44875218], [0, 1, 0, 200], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            multmatrix([[-1, 0, 0, 588], [0, 0, -1, -3172.94875218], [0, 1, 0, 209], [0, 0, 0, 1]]) cube([18, 346, 800], center = true);
            multmatrix([[-1, 0, 0, 294], [0, 0, -1, -3172.94875218], [0, 1, 0, 209], [0, 0, 0, 1]]) cube([18, 346, 800], center = true);
            multmatrix([[-1, 0, 0, 441], [0, 0, -1, -3172.94875218], [0, 1, 0, 386.5], [0, 0, 0, 1]]) cube([882, 9, 800], center = true);
            multmatrix([[-1, 0, 0, 441], [0, 0, -1, -3172.94875218], [0, 1, 0, 13.5], [0, 0, 0, 1]]) cube([864, 9, 800], center = true);
            multmatrix([[-1, 0, 0, 441], [0, 0, -1, -3172.94875218], [0, 1, 0, 31.5], [0, 0, 0, 1]]) cube([864, 9, 800], center = true);
        }
        difference() {
            multmatrix([[-1, 0, 0, 441], [0, 0, 1, -3572.94875218], [0, 1, 0, 200], [0, 0, 0, 1]]) cube([900, 400, 18], center = true);
            multmatrix([[-1, 0, 0, 877.5], [0, 0, 1, -3568.44875218], [0, 1, 0, 200], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            multmatrix([[1, 0, 0, 4.5], [0, 0, 1, -3568.44875218], [0, 1, 0, 200], [0, 0, 0, 1]]) cube([9, 400, 9], center = true);
            multmatrix([[-1, 0, 0, 588], [0, 0, -1, -3172.94875218], [0, 1, 0, 209], [0, 0, 0, 1]]) cube([18, 346, 800], center = true);
            multmatrix([[-1, 0, 0, 294], [0, 0, -1, -3172.94875218], [0, 1, 0, 209], [0, 0, 0, 1]]) cube([18, 346, 800], center = true);
            multmatrix([[-1, 0, 0, 441], [0, 0, -1, -3172.94875218], [0, 1, 0, 386.5], [0, 0, 0, 1]]) cube([882, 9, 800], center = true);
            multmatrix([[-1, 0, 0, 441], [0, 0, -1, -3172.94875218], [0, 1, 0, 13.5], [0, 0, 0, 1]]) cube([864, 9, 800], center = true);
            multmatrix([[-1, 0, 0, 441], [0, 0, -1, -3172.94875218], [0, 1, 0, -4.5], [0, 0, 0, 1]]) cube([864, 9, 800], center = true);
        }
        multmatrix([[-1, 0, 0, 852], [0, -1, 0, -3172.94875218], [0, 0, -1, 50], [0, 0, 0, 1]]) cylinder(h = 100, r = 10);
    }
}

// 3D parts
if (PART == "" || PART == "pleft") pleft();
if (PART == "" || PART == "pright") pright();
if (PART == "" || PART == "pbottom") pbottom();
if (PART == "" || PART == "ptop") ptop();
if (PART == "" || PART == "vDivider1") vDivider1();
if (PART == "" || PART == "vDivider2") vDivider2();
if (PART == "" || PART == "backplate") backplate();
if (PART == "" || PART == "sliderDoorLeft") sliderDoorLeft();
if (PART == "" || PART == "sliderDoorRight") sliderDoorRight();
if (PART == "" || PART == "pleft_2") pleft_2();
if (PART == "" || PART == "pright_2") pright_2();
if (PART == "" || PART == "pbottom_2") pbottom_2();
if (PART == "" || PART == "ptop_2") ptop_2();
if (PART == "" || PART == "vDivider1_2") vDivider1_2();
if (PART == "" || PART == "vDivider2_2") vDivider2_2();
if (PART == "" || PART == "backplate_2") backplate_2();
if (PART == "" || PART == "sliderDoorLeft_2") sliderDoorLeft_2();
if (PART == "" || PART == "sliderDoorRight_2") sliderDoorRight_2();
