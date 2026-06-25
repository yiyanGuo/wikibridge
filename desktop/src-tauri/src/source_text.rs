use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::SystemTime,
};

const TEXT_SOURCE_EXTENSIONS: &[&str] = &["md", "mdx", "txt", "csv", "html", "htm", "rtf"];

static PDFIUM: OnceLock<Result<pdfium_render::prelude::Pdfium, String>> = OnceLock::new();
static PDFIUM_LOCK: Mutex<()> = Mutex::new(());
static RESOURCE_DIR_HINT: OnceLock<PathBuf> = OnceLock::new();

pub(crate) fn set_resource_dir_hint(dir: PathBuf) {
    let _ = RESOURCE_DIR_HINT.set(dir);
}

pub(crate) fn read_source_text_for_ingest(path: &Path) -> Result<String, String> {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if ext == "pdf" {
        return read_pdf_text_with_cache(path);
    }

    if TEXT_SOURCE_EXTENSIONS.contains(&ext.as_str()) {
        return fs::read_to_string(path)
            .map_err(|error| format!("无法读取 UTF-8 文本 source: {error}"));
    }

    let label = if ext.is_empty() {
        "无扩展名".to_string()
    } else {
        format!(".{ext}")
    };
    Err(format!(
        "暂不支持构建 {label} source；本轮仅支持 UTF-8 文本和可提取文本的 PDF"
    ))
}

fn read_pdf_text_with_cache(path: &Path) -> Result<String, String> {
    if let Some(cached) = read_fresh_pdf_cache(path) {
        return Ok(cached);
    }

    let text = extract_pdf_text(path)?;
    let _ = write_pdf_cache(path, &text);
    Ok(text)
}

fn read_fresh_pdf_cache(path: &Path) -> Option<String> {
    let source_modified = path.metadata().ok()?.modified().ok()?;
    let cache_path = pdf_cache_path(path);
    let cache_modified = cache_path.metadata().ok()?.modified().ok()?;
    if !is_cache_fresh(source_modified, cache_modified) {
        return None;
    }
    let cached = fs::read_to_string(cache_path).ok()?;
    if cached.trim().is_empty() {
        None
    } else {
        Some(cached)
    }
}

fn write_pdf_cache(path: &Path, text: &str) -> Result<(), String> {
    let cache_path = pdf_cache_path(path);
    if let Some(parent) = cache_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("无法创建 PDF 提取缓存目录: {error}"))?;
    }
    fs::write(&cache_path, text).map_err(|error| format!("无法写入 PDF 提取缓存: {error}"))
}

fn pdf_cache_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("source.pdf");
    path.parent()
        .unwrap_or_else(|| Path::new(""))
        .join(".cache")
        .join(format!("{file_name}.txt"))
}

fn is_cache_fresh(source_modified: SystemTime, cache_modified: SystemTime) -> bool {
    cache_modified >= source_modified
}

fn extract_pdf_text(path: &Path) -> Result<String, String> {
    use pdfium_render::prelude::*;

    let _guard = PDFIUM_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let pdfium = pdfium().map_err(|error| format!("PDF 解析库不可用: {error}"))?;
    let path_string = path.to_string_lossy().to_string();
    let doc = pdfium
        .load_pdf_from_file(path, None)
        .map_err(|error| match error {
            PdfiumError::PdfiumLibraryInternalError(PdfiumInternalError::PasswordError) => {
                format!("PDF 有密码保护，无法读取: {path_string}")
            }
            _ => format!("无法打开 PDF: {error}"),
        })?;

    let mut out = String::new();
    let mut has_extractable_text = false;

    for (page_index, page) in doc.pages().iter().enumerate() {
        let page_num = page_index + 1;
        if !out.is_empty() {
            out.push_str("\n\n");
        }
        out.push_str(&format!("## Page {page_num}\n\n"));
        let page_text = page
            .text()
            .map_err(|error| format!("PDF 第 {page_num} 页文本提取失败: {error}"))?
            .all();
        if !page_text.trim().is_empty() {
            has_extractable_text = true;
            out.push_str(page_text.trim());
            out.push('\n');
        }
    }

    if !has_extractable_text {
        return Err("PDF 未提取到文本，扫描件/OCR 不在本轮支持范围".to_string());
    }

    Ok(out)
}

fn pdfium() -> Result<&'static pdfium_render::prelude::Pdfium, String> {
    PDFIUM
        .get_or_init(|| {
            use pdfium_render::prelude::*;
            let candidates = pdfium_candidate_paths();
            for path in &candidates {
                if let Ok(bindings) = Pdfium::bind_to_library(path) {
                    eprintln!("[desktop-pdfium] loaded dynamic library from {path}");
                    return Ok(Pdfium::new(bindings));
                }
            }
            Pdfium::bind_to_system_library()
                .map(Pdfium::new)
                .map_err(|error| {
                    format!(
                        "Failed to locate Pdfium library. Tried: {} and the system search path. Last error: {error}",
                        if candidates.is_empty() {
                            "(no candidates)".to_string()
                        } else {
                            candidates.join(", ")
                        }
                    )
                })
        })
        .as_ref()
        .map_err(|error| error.clone())
}

fn pdfium_candidate_paths() -> Vec<String> {
    let mut candidates = Vec::new();
    let platform = current_platform_key();
    let library = pdfium_library_name();

    if let Ok(path) = std::env::var("PDFIUM_DYNAMIC_LIB_PATH") {
        candidates.push(path);
    }

    if let Some(resource_dir) = RESOURCE_DIR_HINT.get() {
        push_path(
            &mut candidates,
            resource_dir
                .join("binaries")
                .join("pdfium")
                .join(platform)
                .join(library),
        );
        push_path(&mut candidates, resource_dir.join("pdfium").join(library));
        push_path(&mut candidates, resource_dir.join(library));
    }

    if let Ok(cwd) = std::env::current_dir() {
        push_path(
            &mut candidates,
            cwd.join("binaries")
                .join("pdfium")
                .join(platform)
                .join(library),
        );
        push_path(
            &mut candidates,
            cwd.join("src-tauri")
                .join("binaries")
                .join("pdfium")
                .join(platform)
                .join(library),
        );
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            push_path(
                &mut candidates,
                exe_dir
                    .join("binaries")
                    .join("pdfium")
                    .join(platform)
                    .join(library),
            );
            push_path(
                &mut candidates,
                exe_dir
                    .join("resources")
                    .join("binaries")
                    .join("pdfium")
                    .join(platform)
                    .join(library),
            );

            #[cfg(target_os = "macos")]
            {
                push_path(
                    &mut candidates,
                    exe_dir
                        .join("../Resources/binaries/pdfium")
                        .join(platform)
                        .join(library),
                );
                push_path(&mut candidates, exe_dir.join("../Resources").join(library));
                push_path(&mut candidates, exe_dir.join("../Frameworks").join(library));
            }
        }
    }

    candidates
}

fn push_path(out: &mut Vec<String>, path: PathBuf) {
    out.push(path.to_string_lossy().into_owned());
}

fn pdfium_library_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "pdfium.dll"
    }
    #[cfg(target_os = "macos")]
    {
        "libpdfium.dylib"
    }
    #[cfg(target_os = "linux")]
    {
        "libpdfium.so"
    }
}

fn current_platform_key() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "darwin-arm64"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "darwin-amd64"
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        "linux-arm64"
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "linux-amd64"
    }
    #[cfg(target_os = "windows")]
    {
        "windows-amd64"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "wikibridge-source-text-{name}-{}",
            crate::unix_millis()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn text_source_uses_utf8_branch() {
        let root = temp_root("text");
        let source = root.join("note.txt");
        fs::write(&source, "hello\n").unwrap();

        let text = read_source_text_for_ingest(&source).unwrap();

        assert_eq!(text, "hello\n");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn unsupported_binary_source_fails_clearly() {
        let root = temp_root("unsupported");
        let source = root.join("deck.pptx");
        fs::write(&source, b"binary").unwrap();

        let error = read_source_text_for_ingest(&source).unwrap_err();

        assert!(error.contains("暂不支持构建 .pptx source"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn pdf_cache_hit_avoids_parsing() {
        let root = temp_root("pdf-cache-hit");
        let source = root.join("paper.pdf");
        fs::write(&source, b"not a real pdf").unwrap();
        let cache = pdf_cache_path(&source);
        fs::create_dir_all(cache.parent().unwrap()).unwrap();
        fs::write(&cache, "cached pdf text").unwrap();

        let text = read_source_text_for_ingest(&source).unwrap();

        assert_eq!(text, "cached pdf text");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn pdf_cache_freshness_uses_modified_times() {
        let source = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(20);
        let stale_cache = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(10);
        let fresh_cache = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(20);

        assert!(!is_cache_fresh(source, stale_cache));
        assert!(is_cache_fresh(source, fresh_cache));
    }

    #[test]
    fn invalid_uncached_pdf_reports_pdf_error() {
        let root = temp_root("invalid-pdf");
        let source = root.join("broken.pdf");
        fs::write(&source, b"not a real pdf").unwrap();

        let error = read_source_text_for_ingest(&source).unwrap_err();

        assert!(error.contains("PDF") || error.contains("Pdfium"));
        let _ = fs::remove_dir_all(root);
    }
}
