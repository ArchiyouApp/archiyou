//! A random number generator whose output is fixed for a given seed, on every platform and in
//! every build: xoshiro256++ (Blackman & Vigna, public domain) with its state filled by
//! splitmix64, written out here so that no dependency can change it. The known-answer tests pin
//! the algorithm; they were computed with a separate Python port, not with this file.

/// xoshiro256++ seeded from a `u64` through splitmix64.
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

    pub fn next_u64(&mut self) -> u64
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

    /// A uniform integer in `0..bound` without modulo bias: the `2^64 mod bound` smallest words are
    /// rejected, so every residue is equally likely.
    pub fn below(&mut self, bound: u64) -> u64
    {
        assert!(bound > 0, "below(0) has no answer");
        let threshold = bound.wrapping_neg() % bound;
        loop
        {
            let word = self.next_u64();
            if word >= threshold
            {
                return word % bound;
            }
        }
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

#[cfg(test)]
mod tests
{
    use super::*;

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
        assert_eq!(got, [16294208416658607535, 7960286522194355700, 487617019471545679, 17909611376780542444, 1961750202426094747]);
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
    fn below_matches_the_reference_vectors()
    {
        let draw = |seed: u64, bound: u64, n: usize| {
            let mut rng = PortableRng::seed_from_u64(seed);
            (0..n).map(|_| rng.below(bound)).collect::<Vec<u64>>()
        };
        assert_eq!(draw(0, 10, 10), [3, 5, 0, 0, 4, 8, 6, 3, 7, 0]);
        assert_eq!(draw(7, 1000, 6), [661, 916, 178, 356, 142, 65]);
    }

    #[test]
    fn below_rejects_the_words_that_would_bias_it()
    {
        // 2^63 + 1 rejects every word under 2^63 - 1, which is half of them: seed 5 starts with
        // 5386871174976764958 (rejected), so the first answer comes from its second word
        let bound = (1u64 << 63) + 1;
        let mut rng = PortableRng::seed_from_u64(5);
        let got: Vec<u64> = (0..4).map(|_| rng.below(bound)).collect();
        assert_eq!(got, [2055694351276819941, 499102981827796990, 3748484576899087785, 7064357444210379897]);
    }

    #[test]
    fn below_one_is_always_zero()
    {
        let mut rng = PortableRng::seed_from_u64(1);
        assert!((0..20).all(|_| rng.below(1) == 0));
    }
}
