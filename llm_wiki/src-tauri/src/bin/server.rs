use std::path::PathBuf;

use llm_wiki_lib::{run_headless, HeadlessConfig};

fn main() {
    let data_dir = std::env::var("LLM_WIKI_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("data")
        });
    let port = std::env::var("LLM_WIKI_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(19828);
    let bind = std::env::var("LLM_WIKI_BIND").unwrap_or_else(|_| "0.0.0.0".to_string());
    let token = std::env::var("LLM_WIKI_TOKEN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    run_headless(HeadlessConfig {
        data_dir,
        bind,
        port,
        token,
    });
}
