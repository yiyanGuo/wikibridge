use std::fs;
use std::path::Path;

use crate::types::wiki::FileNode;

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "pdf" => extract_pdf_text(&path),
        _ => fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read file '{}': {}", path, e)),
    }
}

fn extract_pdf_text(path: &str) -> Result<String, String> {
    let bytes =
        fs::read(path).map_err(|e| format!("Failed to read PDF '{}': {}", path, e))?;
    pdf_extract::extract_text_from_mem(&bytes)
        .map_err(|e| format!("Failed to extract text from PDF '{}': {}", path, e))
}

#[tauri::command]
pub fn write_file(path: String, contents: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent dirs for '{}': {}", path, e))?;
    }
    fs::write(&path, contents).map_err(|e| format!("Failed to write file '{}': {}", path, e))
}

#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<FileNode>, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: '{}'", path));
    }
    if !p.is_dir() {
        return Err(format!("Path is not a directory: '{}'", path));
    }
    let nodes = build_tree(p, 0, 3)?;
    Ok(nodes)
}

fn build_tree(dir: &Path, depth: usize, max_depth: usize) -> Result<Vec<FileNode>, String> {
    if depth >= max_depth {
        return Ok(vec![]);
    }

    let mut entries: Vec<_> = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory '{}': {}", dir.display(), e))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            // Skip dotfiles
            entry
                .file_name()
                .to_str()
                .map(|n| !n.starts_with('.'))
                .unwrap_or(false)
        })
        .collect();

    // Sort: directories first, then alphabetical within each group
    entries.sort_by(|a, b| {
        let a_is_dir = a.path().is_dir();
        let b_is_dir = b.path().is_dir();
        match (a_is_dir, b_is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.file_name().cmp(&b.file_name()),
        }
    });

    let mut nodes = Vec::new();
    for entry in entries {
        let entry_path = entry.path();
        let name = entry
            .file_name()
            .to_str()
            .unwrap_or("")
            .to_string();
        let path_str = entry_path.to_string_lossy().to_string();
        let is_dir = entry_path.is_dir();

        let children = if is_dir {
            let kids = build_tree(&entry_path, depth + 1, max_depth)?;
            if kids.is_empty() {
                None
            } else {
                Some(kids)
            }
        } else {
            None
        };

        nodes.push(FileNode {
            name,
            path: path_str,
            is_dir,
            children,
        });
    }

    Ok(nodes)
}

#[tauri::command]
pub fn copy_file(source: String, destination: String) -> Result<(), String> {
    let dest = Path::new(&destination);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent dirs: {}", e))?;
    }
    fs::copy(&source, &destination)
        .map_err(|e| format!("Failed to copy '{}' to '{}': {}", source, destination, e))?;
    Ok(())
}

#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(&path)
            .map_err(|e| format!("Failed to delete directory '{}': {}", path, e))
    } else {
        fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete file '{}': {}", path, e))
    }
}

/// Find wiki pages that reference a given source file name.
/// Scans all .md files under wiki/ for the source filename in frontmatter or content.
#[tauri::command]
pub fn find_related_wiki_pages(project_path: String, source_name: String) -> Result<Vec<String>, String> {
    let wiki_dir = Path::new(&project_path).join("wiki");
    if !wiki_dir.is_dir() {
        return Ok(vec![]);
    }

    let mut related = Vec::new();
    collect_related_pages(&wiki_dir, &source_name, &mut related)?;
    Ok(related)
}

fn collect_related_pages(dir: &Path, source_name: &str, results: &mut Vec<String>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    // derive a slug from source filename for matching (e.g., "my-article.pdf" → "my-article")
    let slug = source_name
        .rsplit('/')
        .next()
        .unwrap_or(source_name)
        .rsplit('.')
        .last()
        .unwrap_or(source_name)
        .to_lowercase();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_related_pages(&path, source_name, results)?;
        } else if path.extension().map(|e| e == "md").unwrap_or(false) {
            // Skip index.md and log.md — they'll be updated separately
            let fname = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if fname == "index.md" || fname == "log.md" || fname == "overview.md" {
                continue;
            }

            if let Ok(content) = fs::read_to_string(&path) {
                let content_lower = content.to_lowercase();
                // Match if the page references the source file name or its slug
                if content_lower.contains(&source_name.to_lowercase())
                    || content_lower.contains(&slug)
                {
                    results.push(path.to_string_lossy().to_string());
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn create_directory(path: String) -> Result<(), String> {
    fs::create_dir_all(&path)
        .map_err(|e| format!("Failed to create directory '{}': {}", path, e))
}
