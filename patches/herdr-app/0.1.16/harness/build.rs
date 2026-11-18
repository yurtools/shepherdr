// Compile the runtime's actual bundle, resolving include_bytes relative to its source.
use std::{env, fs, path::PathBuf};
fn main() {
    let root = PathBuf::from(
        env::var_os("HERDR_FONT_SOURCE")
            .expect("set HERDR_FONT_SOURCE to the isolated v0.1.16 source"),
    );
    let source = root.join("src/settings.rs");
    println!("cargo:rerun-if-env-changed=HERDR_FONT_SOURCE");
    println!("cargo:rerun-if-changed={}", source.display());
    let text = fs::read_to_string(&source).unwrap();
    let start = text.find("pub const BUNDLED_FONTS: ").unwrap();
    let end = start + text[start..].find("\n];").unwrap() + 3;
    let mut bundle = text[start..end].to_string();
    let symbol_start = text.find("pub const SYMBOLS_FONT_FILE: ").unwrap();
    let symbol_end = symbol_start + text[symbol_start..].find(';').unwrap() + 1;
    bundle.push_str(&text[symbol_start..symbol_end]);
    bundle = bundle.replace(
        "include_bytes!(\"../assets/",
        &format!("include_bytes!(\"{}/assets/", root.display()),
    );
    fs::write(
        PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("bundled_fonts.rs"),
        bundle,
    )
    .unwrap();
}
