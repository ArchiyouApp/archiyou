use std::cell::RefCell;

thread_local! {
    static VALUATION_POWER : RefCell<Option<f32>> = RefCell::new(None);
}

pub fn set_power(power: f32) {
    VALUATION_POWER.with(|p| {
        *p.borrow_mut() = Some(power);
    })
}

pub fn valuate(area: u64) -> f32 {
    VALUATION_POWER.with(|p| {
        let power = p.borrow().expect("valuation power not set for this thread!");
        // archiyou: the default power 2 as a plain product. powf comes from another libm natively
        // than in wasm and can differ in the last bit, which would split the layouts.
        if power == 2.0 {
            let area = area as f32;
            area * area
        } else {
            f32::powf(area as f32, power)
        }
    })
}