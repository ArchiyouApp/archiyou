//! The balance of a load: where its centre of gravity is, what the supports carry, and by how much
//! the whole load can be moved to meet what the bin asks.
//!
//! Everything is exact. A load of weight `W` with box centres at `c_i` has the doubled moment
//! `M = sum(w_i * 2 c_i)` about a wall, so its centre of gravity is `M / (2 W)`, and every
//! requirement on the balance becomes an interval of `M`. Moving the whole load by `s` millimetres
//! changes `M` by `2 s W`, which makes the shift that meets the interval a division of integers.
//!
//! The functions work in the real frame: x from the front wall of the bin, y from its side wall.

use crate::geom::V3;
use crate::model::{BalanceSpec, Kind};

/// What the balance of a load looks like, for the plan.
#[derive(Clone, Debug, PartialEq)]
pub struct Report
{
    pub weight: u64,
    /// The centre of gravity in millimetres, when the load has weight.
    pub cog: Option<[f64; 2]>,
    /// What the two supports carry, in grams, rounded up; empty when the bin has none.
    pub axle_loads: Vec<u64>,
    pub ok: bool,
}

/// The doubled moments of the load about x = 0 and y = 0 are allowed to be within `lo..=hi` along `axis`.
/// `None` when the bin asks nothing of that axis or the load has no weight. An empty interval
/// (`lo > hi`) means that no position of the load meets all the requirements.
pub fn allowed_moment(spec: &BalanceSpec, dims: V3, weight: i128, axis: usize) -> Option<(i128, i128)>
{
    if weight == 0
    {
        return None;
    }
    let length = dims[axis] as i128;
    let tolerance = spec.cog_ppm[axis].map(|ppm| {
        let reach = 2 * ppm as i128 * length * weight / 1_000_000;
        (weight * length - reach, weight * length + reach)
    });
    let supports = spec.axles.filter(|_| axis == 0).map(|[(a1, m1), (a2, m2)]| {
        let (a1, a2, m1, m2) = (a1 as i128, a2 as i128, m1 as i128, m2 as i128);
        let span = a2 - a1;
        // the rear support carries (M - 2 W a1) / (2 span), the front one (2 W a2 - M) / (2 span); neither is lifted or overloaded
        ((2 * weight * a1).max(2 * weight * a2 - 2 * span * m1), (2 * weight * a1 + 2 * span * m2).min(2 * weight * a2))
    });
    match (tolerance, supports)
    {
        (Some((l1, h1)), Some((l2, h2))) => Some((l1.max(l2), h1.min(h2))),
        (one, other) => one.or(other),
    }
}

/// The shift in millimetres, within `free`, that takes a load with doubled moment `moment` and weight
/// `weight` into `allowed`: the smallest one that does, else the one that gets nearest.
pub fn shift_into(allowed: Option<(i128, i128)>, moment: i128, weight: i128, free: (i64, i64)) -> i64
{
    let Some((lo, hi)) = allowed
    else
    {
        return 0;
    };
    if lo > hi || (lo..=hi).contains(&moment)
    {
        // either already inside, or impossible whatever the shift: the load stays where it is
        return 0;
    }
    let step = 2 * weight;
    let ceil_div = |n: i128| -(-n).div_euclid(step);
    let needed = (ceil_div(lo - moment) as i64, (hi - moment).div_euclid(step) as i64);
    if needed.0 > needed.1
    {
        // no whole millimetre lands inside the interval: go to the one that is nearest
        return if moment < lo { needed.0.min(free.1).max(free.0) } else { needed.1.min(free.1).max(free.0) };
    }
    let reachable = (needed.0.max(free.0), needed.1.min(free.1));
    if reachable.0 <= reachable.1
    {
        0i64.clamp(reachable.0, reachable.1)
    }
    else if needed.1 < free.0
    {
        free.0
    }
    else
    {
        free.1
    }
}

/// The balance of a load of `weight` grams with doubled moments `moment`, in the real frame.
pub fn report(kind: &Kind, weight: u64, moment: [i128; 2]) -> Report
{
    let w = weight as i128;
    let ok = kind.balance.as_ref().is_none_or(|spec| (0..2).all(|axis| allowed_moment(spec, kind.dims, w, axis).is_none_or(|(lo, hi)| lo <= moment[axis] && moment[axis] <= hi)));
    let cog = (weight > 0).then(|| [moment[0] as f64 / (2.0 * w as f64), moment[1] as f64 / (2.0 * w as f64)]);
    let axle_loads = kind
        .balance
        .as_ref()
        .and_then(|spec| spec.axles)
        .map(|[(a1, _), (a2, _)]| {
            let span2 = 2 * (a2 - a1) as u128;
            let rear = (moment[0] - 2 * w * a1 as i128).max(0) as u128;
            let front = (2 * w * a2 as i128 - moment[0]).max(0) as u128;
            vec![front.div_ceil(span2) as u64, rear.div_ceil(span2) as u64]
        })
        .unwrap_or_default();
    Report { weight, cog, axle_loads, ok }
}

#[cfg(test)]
mod tests
{
    use super::*;

    fn spec(cog_x: Option<f64>, cog_y: Option<f64>, axles: Option<[(i64, u64); 2]>) -> BalanceSpec
    {
        BalanceSpec { cog_ppm: [cog_x.map(|f| (f * 1e6) as u64), cog_y.map(|f| (f * 1e6) as u64)], axles }
    }

    const DIMS: V3 = [10_000, 2_000, 2_500];

    #[test]
    fn a_tolerance_is_a_band_around_the_middle_of_the_floor()
    {
        // 1000 g, 10 % of 10 m: the centre of gravity may be 1 m from the middle, so M (= 2 W c) from 8 000 000 to 12 000 000
        let band = allowed_moment(&spec(Some(0.1), None, None), DIMS, 1000, 0).unwrap();
        assert_eq!(band, (8_000_000, 12_000_000));
        assert_eq!(allowed_moment(&spec(Some(0.1), None, None), DIMS, 1000, 1), None, "y is free");
        assert_eq!(allowed_moment(&spec(Some(0.1), None, None), DIMS, 0, 0), None, "no weight, nothing to balance");
    }

    #[test]
    fn the_supports_share_the_weight_by_the_lever_rule()
    {
        // supports at 1000 and 9000 (8 m apart), 10 t = 10 000 000 g, each may carry 7 t
        let supports = spec(None, None, Some([(1000, 7_000_000), (9000, 7_000_000)]));
        let (lo, hi) = allowed_moment(&supports, DIMS, 10_000_000, 0).unwrap();
        // the centre of gravity (M / 2W) has to be between 3400 and 6600: at 6600 the rear support carries 10 t * 5600 / 8000 = 7 t,
        // at 3400 the front one carries 7 t
        assert_eq!((lo / 20_000_000, hi / 20_000_000), (3400, 6600));
        let at = |cog: i128| report(&kind(supports.clone()), 10_000_000, [cog * 20_000_000, 0]);
        assert!(at(3400).ok && at(6600).ok && at(5000).ok);
        assert!(!at(3399).ok && !at(6601).ok);
        assert_eq!(at(5000).axle_loads, [5_000_000, 5_000_000]);
        assert_eq!(at(6600).axle_loads, [3_000_000, 7_000_000], "front 3 t, rear 7 t");
    }

    #[test]
    fn a_support_that_would_be_lifted_is_not_allowed()
    {
        // 1 t with the centre of gravity behind the rear support: the front one would carry less than nothing
        let supports = spec(None, None, Some([(1000, 9_000_000), (9000, 9_000_000)]));
        let (lo, hi) = allowed_moment(&supports, DIMS, 1_000_000, 0).unwrap();
        assert_eq!((lo / 2_000_000, hi / 2_000_000), (1000, 9000));
    }

    #[test]
    fn requirements_are_intersected_and_can_exclude_each_other()
    {
        let both = spec(Some(0.05), None, Some([(1000, 7_000_000), (9000, 7_000_000)]));
        // the band 4500..5500 lies inside 3400..6600
        let (lo, hi) = allowed_moment(&both, DIMS, 10_000_000, 0).unwrap();
        assert_eq!((lo / 20_000_000, hi / 20_000_000), (4500, 5500));
        // supports that can only take 4 t each cannot carry 10 t whatever the tolerance: the interval is empty
        let weak = spec(Some(0.5), None, Some([(1000, 4_000_000), (9000, 4_000_000)]));
        let (lo, hi) = allowed_moment(&weak, DIMS, 10_000_000, 0).unwrap();
        assert!(lo > hi);
    }

    fn kind(balance: BalanceSpec) -> Kind
    {
        Kind { dims: DIMS, cost: 1000, stock: None, max_weight: None, door: None, flip: [false, false], balance: Some(balance), volume: 1 }
    }

    #[test]
    fn a_load_is_moved_the_least_that_brings_it_into_the_band()
    {
        let band = Some((8_000_000, 12_000_000));
        let w = 1000;
        // M = 2 W c: a centre of gravity at 2000 mm is M = 4 000 000; it has to get to 4000 or more, so by 2000 mm at least
        assert_eq!(shift_into(band, 4_000_000, w, (-2000, 6000)), 2000);
        // already inside: no shift
        assert_eq!(shift_into(band, 10_000_000, w, (-2000, 6000)), 0);
        // too far forward and only 1500 mm of room: as far as it goes
        assert_eq!(shift_into(band, 4_000_000, w, (-2000, 1500)), 1500);
        // too far back: moved forward
        assert_eq!(shift_into(band, 16_000_000, w, (-5000, 5000)), -2000);
        // an empty interval leaves the load alone
        assert_eq!(shift_into(Some((5, 4)), 0, w, (-100, 100)), 0);
        assert_eq!(shift_into(None, 0, w, (-100, 100)), 0);
    }

    #[test]
    fn the_shift_is_exact_to_the_millimetre_with_awkward_weights()
    {
        // 3 g: M changes by 6 per millimetre; the band is 1000..1005, one whole millimetre lands inside only when 6 divides the way
        let w = 3;
        let shift = shift_into(Some((1000, 1005)), 0, w, (-10_000, 10_000));
        assert_eq!(shift, 167, "6 * 167 = 1002 is inside, 166 would give 996");
        let inside = 6 * shift as i128;
        assert!((1000..=1005).contains(&inside));
    }

    #[test]
    fn a_report_names_the_centre_of_gravity_and_whether_it_is_in_the_band()
    {
        let k = kind(spec(Some(0.1), Some(0.1), None));
        let in_band = report(&k, 1000, [10_000_000, 2_000_000]);
        assert!(in_band.ok);
        assert_eq!(in_band.cog, Some([5000.0, 1000.0]));
        let off = report(&k, 1000, [10_000_000, 3_000_000]);
        assert!(!off.ok, "y = 1500 is 500 mm from the middle of a 2000 mm width, the tolerance is 200");
        let empty = report(&k, 0, [0, 0]);
        assert!(empty.ok && empty.cog.is_none());
    }
}
