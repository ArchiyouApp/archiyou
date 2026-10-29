//! Integer geometry for the rules: boxes, the six orientations, overlap and support areas, and the
//! convex hull the centre of gravity has to lie in. Everything is i64 (millimetres), so no rule
//! depends on a float or on the platform.

pub type V3 = [i64; 3];
pub type V2 = [i64; 2];

/// Orientation `o` puts the item's axis `PERMS[o][k]` along world axis `k`: 0 as modelled, 1 turned
/// 90° about z, 2 and 3 with the item's y axis up, 4 and 5 with its x axis up. Even and odd ones
/// alternate which of the two horizontal axes comes first.
pub const PERMS: [[usize; 3]; 6] = [[0, 1, 2], [1, 0, 2], [0, 2, 1], [2, 0, 1], [1, 2, 0], [2, 1, 0]];

/// Every orientation, as a mask over `PERMS`.
pub const ALL_ORIENTATIONS: u8 = 0b11_1111;

/// What the item's extents become in orientation `orientation`.
pub fn extents(dims: V3, orientation: u8) -> V3
{
    let perm = PERMS[orientation as usize];
    [dims[perm[0]], dims[perm[1]], dims[perm[2]]]
}

/// The orientations in `mask`, without the ones that give the same extents as an earlier one (a
/// square base turned 90° is the same box).
pub fn distinct_orientations(dims: V3, mask: u8) -> Vec<u8>
{
    (0..6u8)
        .filter(|o| mask & (1 << o) != 0)
        .fold(Vec::new(), |mut kept: Vec<u8>, o| {
            if !kept.iter().any(|&k| extents(dims, k) == extents(dims, o))
            {
                kept.push(o);
            }
            kept
        })
}

/// An axis-aligned box, half open: `min` is inside, `max` is not.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cuboid
{
    pub min: V3,
    pub max: V3,
}

impl Cuboid
{
    pub fn new(min: V3, extent: V3) -> Self
    {
        Cuboid { min, max: [min[0] + extent[0], min[1] + extent[1], min[2] + extent[2]] }
    }

    pub fn extent(&self) -> V3
    {
        [self.max[0] - self.min[0], self.max[1] - self.min[1], self.max[2] - self.min[2]]
    }

    /// Boxes that only touch do not overlap.
    pub fn overlaps(&self, other: &Cuboid) -> bool
    {
        (0..3).all(|a| self.min[a] < other.max[a] && other.min[a] < self.max[a])
    }

    pub fn contains_point(&self, p: V3) -> bool
    {
        (0..3).all(|a| self.min[a] <= p[a] && p[a] < self.max[a])
    }

    pub fn within(&self, outer: &Cuboid) -> bool
    {
        (0..3).all(|a| outer.min[a] <= self.min[a] && self.max[a] <= outer.max[a])
    }

    /// Area of the overlap of the two footprints on the floor plane.
    pub fn footprint_overlap(&self, other: &Cuboid) -> i64
    {
        let overlap = |a: usize| (self.max[a].min(other.max[a]) - self.min[a].max(other.min[a])).max(0);
        overlap(0) * overlap(1)
    }

    pub fn footprint_area(&self) -> i64
    {
        let e = self.extent();
        e[0] * e[1]
    }

    pub fn volume(&self) -> i128
    {
        let e = self.extent();
        e[0] as i128 * e[1] as i128 * e[2] as i128
    }

    /// The centre of the footprint in doubled coordinates, which keeps it an integer.
    pub fn footprint_centre2(&self) -> V2
    {
        [self.min[0] + self.max[0], self.min[1] + self.max[1]]
    }
}

fn cross(o: V2, a: V2, b: V2) -> i128
{
    (a[0] - o[0]) as i128 * (b[1] - o[1]) as i128 - (a[1] - o[1]) as i128 * (b[0] - o[0]) as i128
}

/// The convex hull by monotone chain: counter-clockwise, without repeated or collinear points.
/// Fewer than three distinct points come back as they are.
pub fn convex_hull(mut points: Vec<V2>) -> Vec<V2>
{
    points.sort_unstable();
    points.dedup();
    if points.len() < 3
    {
        return points;
    }
    let chain = |ordered: &mut dyn Iterator<Item = V2>| {
        ordered.fold(Vec::new(), |mut hull: Vec<V2>, p| {
            while hull.len() >= 2 && cross(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 0
            {
                hull.pop();
            }
            hull.push(p);
            hull
        })
    };
    let mut lower = chain(&mut points.iter().copied());
    let mut upper = chain(&mut points.iter().rev().copied());
    // each chain ends where the other begins
    lower.pop();
    upper.pop();
    lower.extend(upper);
    lower
}

/// Whether `p` lies inside the hull or on its edge. A hull without area contains nothing.
pub fn hull_contains(hull: &[V2], p: V2) -> bool
{
    hull.len() >= 3 && (0..hull.len()).all(|i| cross(hull[i], hull[(i + 1) % hull.len()], p) >= 0)
}

/// Where the base of an item touches the boxes under it.
pub struct Contact
{
    /// Area of the base that rests on a top face at exactly the height of the base.
    pub area: i64,
    /// Corners of every contact rectangle, in doubled coordinates.
    pub corners: Vec<V2>,
}

/// The contact of `base` with those of `others` whose top face is at the height of its bottom face.
pub fn contact<'a>(base: &Cuboid, others: impl Iterator<Item = &'a Cuboid>) -> Contact
{
    others
        .filter(|o| o.max[2] == base.min[2] && base.footprint_overlap(o) > 0)
        .fold(Contact { area: 0, corners: Vec::new() }, |mut contact, o| {
            let (x0, x1) = (base.min[0].max(o.min[0]), base.max[0].min(o.max[0]));
            let (y0, y1) = (base.min[1].max(o.min[1]), base.max[1].min(o.max[1]));
            contact.area += (x1 - x0) * (y1 - y0);
            contact.corners.extend([[2 * x0, 2 * y0], [2 * x1, 2 * y0], [2 * x1, 2 * y1], [2 * x0, 2 * y1]]);
            contact
        })
}

/// Whether `base` stands: on the floor, or with at least `permille`/1000 of its footprint resting on
/// the tops of `others` and its centre inside the convex hull of that contact.
pub fn stands<'a>(base: &Cuboid, others: impl Iterator<Item = &'a Cuboid>, permille: i64) -> bool
{
    if base.min[2] == 0
    {
        return true;
    }
    let touching = contact(base, others);
    touching.area * 1000 >= permille * base.footprint_area() && hull_contains(&convex_hull(touching.corners), base.footprint_centre2())
}

#[cfg(test)]
mod tests
{
    use super::*;

    #[test]
    fn each_orientation_permutes_the_extents()
    {
        let got: Vec<V3> = (0..6).map(|o| extents([2, 3, 5], o)).collect();
        assert_eq!(got, [[2, 3, 5], [3, 2, 5], [2, 5, 3], [5, 2, 3], [3, 5, 2], [5, 3, 2]]);
    }

    #[test]
    fn equal_extents_are_one_orientation()
    {
        assert_eq!(distinct_orientations([4, 4, 9], ALL_ORIENTATIONS), [0, 2, 3]);
        assert_eq!(distinct_orientations([5, 5, 5], ALL_ORIENTATIONS), [0]);
        assert_eq!(distinct_orientations([2, 3, 5], ALL_ORIENTATIONS), [0, 1, 2, 3, 4, 5]);
        // the mask is respected, and an order is kept
        assert_eq!(distinct_orientations([2, 3, 5], 0b00_0110), [1, 2]);
    }

    #[test]
    fn boxes_that_only_touch_do_not_overlap()
    {
        let a = Cuboid::new([0, 0, 0], [10, 10, 10]);
        assert!(!a.overlaps(&Cuboid::new([10, 0, 0], [5, 5, 5])));
        assert!(!a.overlaps(&Cuboid::new([0, 0, 10], [5, 5, 5])));
        assert!(a.overlaps(&Cuboid::new([9, 9, 9], [5, 5, 5])));
        assert!(a.overlaps(&Cuboid::new([2, 2, 2], [1, 1, 1])));
    }

    #[test]
    fn a_point_on_the_max_face_is_outside()
    {
        let a = Cuboid::new([0, 0, 0], [10, 10, 10]);
        assert!(a.contains_point([0, 0, 0]));
        assert!(a.contains_point([9, 9, 9]));
        assert!(!a.contains_point([10, 5, 5]));
    }

    #[test]
    fn the_hull_of_a_rectangle_is_its_corners()
    {
        let hull = convex_hull(vec![[0, 0], [4, 0], [4, 2], [0, 2], [2, 1], [2, 0], [0, 0]]);
        assert_eq!(hull.len(), 4);
        assert!(hull_contains(&hull, [2, 1]));
        assert!(hull_contains(&hull, [0, 0]), "a corner is on the edge");
        assert!(hull_contains(&hull, [4, 1]), "so is a point on a side");
        assert!(!hull_contains(&hull, [5, 1]));
        assert!(!hull_contains(&hull, [2, 3]));
    }

    #[test]
    fn a_hull_without_area_contains_nothing()
    {
        assert!(!hull_contains(&convex_hull(vec![[0, 0]]), [0, 0]));
        assert!(!hull_contains(&convex_hull(vec![[0, 0], [4, 0]]), [2, 0]));
        assert!(!hull_contains(&convex_hull(vec![[0, 0], [2, 0], [4, 0]]), [2, 0]), "collinear points have no area either");
        assert!(!hull_contains(&[], [0, 0]));
    }

    /// Brute force by Carathéodory: a point is in the hull of a set when it is one of the points, on a
    /// segment between two of them, or inside a triangle of three of them.
    fn inside_by_brute_force(points: &[V2], p: V2) -> bool
    {
        let on_segment = |a: V2, b: V2| cross(a, b, p) == 0 && p[0] >= a[0].min(b[0]) && p[0] <= a[0].max(b[0]) && p[1] >= a[1].min(b[1]) && p[1] <= a[1].max(b[1]);
        let in_triangle = |a: V2, b: V2, c: V2| {
            let (d1, d2, d3) = (cross(a, b, p), cross(b, c, p), cross(c, a, p));
            cross(a, b, c) != 0 && !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
        };
        let n = points.len();
        points.contains(&p)
            || (0..n).any(|i| (i + 1..n).any(|j| on_segment(points[i], points[j])))
            || (0..n).any(|i| (i + 1..n).any(|j| (j + 1..n).any(|k| in_triangle(points[i], points[j], points[k]))))
    }

    #[test]
    fn the_hull_test_agrees_with_brute_force_on_random_point_sets()
    {
        let mut state = 12345u64;
        let mut next = |bound: u64| {
            state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((state >> 33) % bound) as i64
        };
        (0..300).for_each(|_| {
            let points: Vec<V2> = (0..(3 + next(7))).map(|_| [next(9), next(9)]).collect();
            let hull = convex_hull(points.clone());
            (0..9).for_each(|x| {
                (0..9).for_each(|y| {
                    assert_eq!(hull_contains(&hull, [x, y]), inside_by_brute_force(&points, [x, y]) && hull.len() >= 3, "points {points:?}, probe {:?}", [x, y]);
                });
            });
        });
    }

    #[test]
    fn contact_adds_up_the_boxes_whose_top_is_at_the_base()
    {
        let base = Cuboid::new([0, 0, 100], [200, 100, 50]);
        let under = [
            Cuboid::new([0, 0, 0], [120, 100, 100]),    // top at 100, overlaps 120 x 100
            Cuboid::new([120, 0, 0], [100, 60, 100]),   // top at 100, overlaps 80 x 60
            Cuboid::new([0, 0, 0], [200, 100, 90]),     // top at 90: not touching
            Cuboid::new([150, 80, 0], [100, 100, 100]), // top at 100, overlaps 50 x 20
        ];
        let touching = contact(&base, under.iter());
        assert_eq!(touching.area, 120 * 100 + 80 * 60 + 50 * 20);
        assert_eq!(touching.corners.len(), 12);
    }

    #[test]
    fn a_plate_on_a_central_column_stands_only_if_little_support_is_enough()
    {
        // the ratio rule: 1000 x 1000 plate on a 400 x 400 column, centred
        let plate = Cuboid::new([0, 0, 500], [1000, 1000, 20]);
        let column = [Cuboid::new([300, 300, 0], [400, 400, 500])];
        assert!(!stands(&plate, column.iter(), 800), "16 % of the base is not enough for 80 %");
        assert!(stands(&plate, column.iter(), 100), "but it is for 10 %: the centre is over the column");
    }

    #[test]
    fn a_plate_whose_centre_hangs_over_nothing_does_not_stand_whatever_the_ratio()
    {
        // the centre rule: 60 % of the base rests on the left, the centre (x = 500) is outside the contact (x < 400)
        let plate = Cuboid::new([0, 0, 500], [1000, 1000, 20]);
        let left = [Cuboid::new([0, 0, 0], [400, 1000, 500])];
        assert!(!stands(&plate, left.iter(), 300), "40 % rests on the box, the centre does not");
        // shift the support under the centre and the same ratio is fine
        let middle = [Cuboid::new([300, 0, 0], [400, 1000, 500])];
        assert!(stands(&plate, middle.iter(), 300));
    }

    #[test]
    fn the_floor_always_supports()
    {
        assert!(stands(&Cuboid::new([0, 0, 0], [10, 10, 10]), std::iter::empty(), 1000));
    }

    #[test]
    fn full_support_needs_the_whole_base()
    {
        let base = Cuboid::new([0, 0, 50], [100, 100, 10]);
        let whole = [Cuboid::new([0, 0, 0], [100, 100, 50])];
        let almost = [Cuboid::new([0, 0, 0], [99, 100, 50])];
        assert!(stands(&base, whole.iter(), 1000));
        assert!(!stands(&base, almost.iter(), 1000));
        assert!(stands(&base, almost.iter(), 990));
    }
}
