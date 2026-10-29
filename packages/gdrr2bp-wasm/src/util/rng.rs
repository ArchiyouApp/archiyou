//! archiyou: a random number generator whose output is fixed for a given seed, on every platform
//! and in every build.
//!
//! rand's `SmallRng` is Xoshiro128++ on 32-bit targets (wasm32) and Xoshiro256++ on 64-bit ones,
//! so one seed gave one layout natively and another in the browser. This is xoshiro256++
//! (Blackman & Vigna, public domain) with its state filled by splitmix64, written out here so
//! that no dependency can change it. The known-answer tests below pin the algorithm, and the
//! golden layout in `tests/smoke.rs` pins what the solver does with it.

use std::convert::Infallible;

use rand::TryRng;

/// xoshiro256++ seeded from a `u64` through splitmix64.
///
/// It implements `rand::TryRng` (and with that `Rng` and `RngExt`), so the solver keeps using
/// rand's `random`, `random_range`, `shuffle` and `choose` on top of it.
#[derive(Clone, Debug)]
pub struct PortableRng
{
    s: [u64; 4],
}

impl PortableRng
{
    pub fn seed_from_u64(seed: u64) -> Self
    {
        let mut state = seed;
        let mut s = [0u64; 4];
        s.iter_mut().for_each(|word| *word = splitmix64(&mut state));
        PortableRng { s }
    }

    fn step(&mut self) -> u64
    {
        let result = self.s[0].wrapping_add(self.s[3]).rotate_left(23).wrapping_add(self.s[0]);
        let t = self.s[1] << 17;
        self.s[2] ^= self.s[0];
        self.s[3] ^= self.s[1];
        self.s[1] ^= self.s[2];
        self.s[0] ^= self.s[3];
        self.s[2] ^= t;
        self.s[3] = self.s[3].rotate_left(45);
        result
    }
}

fn splitmix64(state: &mut u64) -> u64
{
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

impl TryRng for PortableRng
{
    type Error = Infallible;

    fn try_next_u32(&mut self) -> Result<u32, Infallible>
    {
        // the high half, as rand_xoshiro does
        Ok((self.step() >> 32) as u32)
    }

    fn try_next_u64(&mut self) -> Result<u64, Infallible>
    {
        Ok(self.step())
    }

    fn try_fill_bytes(&mut self, dst: &mut [u8]) -> Result<(), Infallible>
    {
        // little-endian words, so the bytes do not depend on the platform either
        dst.chunks_mut(8).for_each(|chunk| {
            let word = self.step().to_le_bytes();
            chunk.copy_from_slice(&word[..chunk.len()]);
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests
{
    use super::*;
    use rand::{Rng, RngExt};

    // The expected values below come from a separate Python port of the reference
    // implementations of xoshiro256++ and splitmix64, not from this file.

    #[test]
    fn xoshiro256pp_matches_the_reference_vectors()
    {
        let mut rng = PortableRng { s: [1, 2, 3, 4] };
        let got: Vec<u64> = (0..10).map(|_| rng.next_u64()).collect();
        assert_eq!(
            got,
            [
                41943041,
                58720359,
                3588806011781223,
                3591011842654386,
                9228616714210784205,
                9973669472204895162,
                14011001112246962877,
                12406186145184390807,
                15849039046786891736,
                10450023813501588000,
            ]
        );
    }

    #[test]
    fn splitmix64_matches_the_reference_vectors()
    {
        let mut state = 0u64;
        let got: Vec<u64> = (0..5).map(|_| splitmix64(&mut state)).collect();
        assert_eq!(
            got,
            [16294208416658607535, 7960286522194355700, 487617019471545679, 17909611376780542444, 1961750202426094747]
        );
    }

    #[test]
    fn a_seed_always_gives_the_same_stream()
    {
        let first_five = |seed: u64| {
            let mut rng = PortableRng::seed_from_u64(seed);
            (0..5).map(|_| rng.next_u64()).collect::<Vec<u64>>()
        };
        assert_eq!(first_five(0), [5987356902031041503, 7051070477665621255, 6633766593972829180, 211316841551650330, 9136120204379184874]);
        assert_eq!(first_five(42), [15021278609987233951, 5881210131331364753, 18149643915985481100, 12933668939759105464, 14637574242682825331]);
    }

    #[test]
    fn floats_come_straight_from_the_words()
    {
        // rand builds a float from the top bits of one word; if that ever changed, layouts would too
        let mut words = PortableRng::seed_from_u64(7);
        let mut floats = PortableRng::seed_from_u64(7);
        let expected_f32 = (words.next_u32() >> 8) as f32 * (1.0 / 16777216.0);
        assert_eq!(floats.random::<f32>(), expected_f32);
        let expected_f64 = (words.next_u64() >> 11) as f64 * (1.0 / 9007199254740992.0);
        assert_eq!(floats.random::<f64>(), expected_f64);
    }

    #[test]
    fn fill_bytes_is_little_endian_words()
    {
        let mut words = PortableRng::seed_from_u64(3);
        let mut bytes = PortableRng::seed_from_u64(3);
        let mut buffer = [0u8; 11];
        bytes.fill_bytes(&mut buffer);
        let mut expected = words.next_u64().to_le_bytes().to_vec();
        expected.extend_from_slice(&words.next_u64().to_le_bytes()[..3]);
        assert_eq!(buffer.to_vec(), expected);
    }
}
