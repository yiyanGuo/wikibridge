fn main() {
    println!("cargo:rerun-if-env-changed=LLM_WIKI_SKIP_TAURI_BUILD");
    if std::env::var_os("LLM_WIKI_SKIP_TAURI_BUILD").is_some() {
        return;
    }

    let windows = tauri_build::WindowsAttributes::new()
        .app_manifest(include_str!("windows-app-manifest.xml"));
    let attrs = tauri_build::Attributes::new().windows_attributes(windows);
    tauri_build::try_build(attrs).expect("failed to run tauri build script");
}
