fn main() {
    tauri_build::build();
    println!("cargo:rerun-if-changed=ios/Package.swift");
    println!("cargo:rerun-if-changed=ios/Sources");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("ios") {
        link_ios_billing_plugin();
    }
    // Android 16KB memory page size 対応(Google Play 2025-11 以降の必須要件)。
    // Tauri の gradle plugin は RUSTFLAGS 経由で cargo を呼ぶため .cargo/config.toml の
    // [target.*] rustflags は無視される。build script の link-arg は上書きされず確実に効く。
    // これで .so の LOAD セグメントが 16KB(0x4000)境界に揃う。
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-arg-cdylib=-Wl,-z,max-page-size=16384");
    }
}

#[cfg(target_os = "macos")]
fn link_ios_billing_plugin() {
    use std::path::PathBuf;

    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let tauri_api = PathBuf::from(
        std::env::var("DEP_TAURI_IOS_LIBRARY_PATH")
            .expect("Tauri iOS library path is unavailable"),
    );
    let package_dir = manifest_dir.join("ios");
    let local_tauri_api = manifest_dir.join(".tauri/tauri-api");

    if local_tauri_api.exists() {
        std::fs::remove_dir_all(&local_tauri_api).unwrap();
    }
    copy_directory(&tauri_api, &local_tauri_api);
    tauri_utils::build::link_apple_library("nativebilling", package_dir);
}

#[cfg(not(target_os = "macos"))]
fn link_ios_billing_plugin() {}

#[cfg(target_os = "macos")]
fn copy_directory(source: &std::path::Path, target: &std::path::Path) {
    std::fs::create_dir_all(target).unwrap();
    for entry in std::fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name();
        if matches!(name.to_str(), Some(".build" | "Package.resolved" | "Tests")) {
            continue;
        }
        let destination = target.join(&name);
        if entry.file_type().unwrap().is_dir() {
            copy_directory(&entry.path(), &destination);
        } else {
            std::fs::copy(entry.path(), destination).unwrap();
        }
    }
}
