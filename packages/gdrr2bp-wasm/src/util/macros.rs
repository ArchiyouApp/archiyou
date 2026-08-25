// wasm port: the original macros wrote to stdout via `print!`/`println!` and read
// `std::thread::current().name()`. Neither is meaningful under wasm32-unknown-unknown,
// so both macros now funnel through `crate::log_line`, which forwards to the browser
// console on wasm and to stdout natively. The timestamp prefix is added there.

#[macro_export]
macro_rules! timed_println {
    ($($arg:tt)*) => {
        $crate::log_line(format!($($arg)*));
    };
}

#[macro_export]
macro_rules! timed_thread_println {
    ($($arg:tt)*) => {
        $crate::log_line(format!($($arg)*));
    };
}
