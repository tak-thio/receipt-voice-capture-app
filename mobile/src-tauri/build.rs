fn main() {
    tauri_build::build();
    // Android 16KB memory page size 対応(Google Play 2025-11 以降の必須要件)。
    // Tauri の gradle plugin は RUSTFLAGS 経由で cargo を呼ぶため .cargo/config.toml の
    // [target.*] rustflags は無視される。build script の link-arg は上書きされず確実に効く。
    // これで .so の LOAD セグメントが 16KB(0x4000)境界に揃う。
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-arg-cdylib=-Wl,-z,max-page-size=16384");
    }
}
