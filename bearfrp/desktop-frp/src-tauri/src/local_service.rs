use std::{
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream, ToSocketAddrs},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

use serde_json::Value;

pub const SERVICE_HOST: &str = "127.0.0.1";
pub const PORT_RANGE_START: u16 = 18_080;
pub const PORT_RANGE_END: u16 = 18_179;

#[derive(Debug)]
pub struct LocalServiceProcess {
    stop: Arc<AtomicBool>,
    port: u16,
}

impl LocalServiceProcess {
    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect((SERVICE_HOST, self.port));
    }

    pub fn is_stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }
}

impl Drop for LocalServiceProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn ensure_knowledge_mask_running(
    process: &mut Option<LocalServiceProcess>,
    port: u16,
    manifest_path: PathBuf,
) -> Result<bool, String> {
    if is_ready(port)? {
        return Ok(true);
    }
    if process.is_none() {
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let listener = TcpListener::bind((SERVICE_HOST, port))
            .map_err(|error| format!("无法启动知识库服务: {error}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("无法配置知识库服务: {error}"))?;
        thread::spawn(move || run_server(listener, thread_stop, manifest_path));
        *process = Some(LocalServiceProcess { stop, port });
    }
    for _ in 0..12 {
        thread::sleep(Duration::from_millis(250));
        if is_ready(port)? {
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn is_ready(port: u16) -> Result<bool, String> {
    let addrs = (SERVICE_HOST, port)
        .to_socket_addrs()
        .map_err(|error| format!("服务地址解析失败: {error}"))?;
    for addr in addrs {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(500)).is_ok() {
            return Ok(true);
        }
    }
    Ok(false)
}

fn run_server(listener: TcpListener, stop: Arc<AtomicBool>, manifest_path: PathBuf) {
    while !stop.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((mut stream, _)) => handle_request(&mut stream, &manifest_path),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(80));
            }
            Err(_) => break,
        }
    }
}

fn handle_request(stream: &mut TcpStream, manifest_path: &PathBuf) {
    let mut buffer = [0_u8; 2048];
    let Ok(size) = stream.read(&mut buffer) else {
        return;
    };
    let request = String::from_utf8_lossy(&buffer[..size]);
    let first_line = request.lines().next().unwrap_or_default();
    if first_line.starts_with("GET /api/project ") {
        let body = fs::read_to_string(manifest_path).unwrap_or_else(|_| "{}".to_string());
        write_response(stream, "200 OK", "application/json; charset=utf-8", body);
    } else if first_line.starts_with("GET / ") {
        write_response(
            stream,
            "200 OK",
            "text/html; charset=utf-8",
            render_page(manifest_path),
        );
    } else {
        write_response(
            stream,
            "404 Not Found",
            "text/plain; charset=utf-8",
            "not found".to_string(),
        );
    }
}

fn render_page(manifest_path: &PathBuf) -> String {
    let value = fs::read_to_string(manifest_path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or(Value::Null);
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("知识库项目");
    let build_status = value
        .get("build_status")
        .and_then(Value::as_str)
        .unwrap_or("not_built");
    let link_status = value
        .get("link_status")
        .and_then(Value::as_str)
        .unwrap_or("not_linked");
    let materials = value
        .get("materials")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let list = if materials.is_empty() {
        "<li class=\"empty\">暂无素材</li>".to_string()
    } else {
        materials
            .iter()
            .map(|item| {
                let original = item
                    .get("original_name")
                    .and_then(Value::as_str)
                    .unwrap_or("素材");
                let size = item.get("size_bytes").and_then(Value::as_u64).unwrap_or(0);
                format!(
                    "<li><strong>{}</strong><span>{:.1} KB</span></li>",
                    escape_html(original),
                    size as f64 / 1024.0
                )
            })
            .collect::<Vec<_>>()
            .join("")
    };

    format!(
        r#"<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{}</title>
<style>
:root{{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17202a;background:#eef2f6}}
body{{margin:0;min-height:100vh;display:grid;place-items:center;padding:28px}}
.shell{{width:min(860px,100%);display:grid;gap:16px}}
.hero,.panel{{background:#fff;border:1px solid #d8e0e8;border-radius:8px;padding:22px}}
.badge{{display:inline-flex;padding:6px 10px;border-radius:999px;background:#dcfce7;color:#047857;font-size:13px}}
h1{{margin:12px 0 8px;font-size:30px}}
p{{margin:0;color:#64748b;line-height:1.6}}
.status{{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}}
.status span{{padding:7px 10px;border-radius:999px;background:#e8edf4;color:#334155;font-size:13px}}
ul{{list-style:none;margin:0;padding:0;display:grid;gap:10px}}
li{{display:flex;justify-content:space-between;gap:16px;padding:12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc}}
li span,.empty{{color:#64748b}}
</style>
</head>
<body>
<main class="shell">
<section class="hero">
<span class="badge">Knowledge Base Mask</span>
<h1>{}</h1>
<p>这是本地知识库构建服务的占位页面。真实编译、链接和检索能力会在后续接入。</p>
<div class="status"><span>构建：{}</span><span>链接：{}</span><span>素材：{} 个</span></div>
</section>
<section class="panel"><ul>{}</ul></section>
</main>
</body>
</html>"#,
        escape_html(name),
        escape_html(name),
        escape_html(build_status),
        escape_html(link_status),
        materials.len(),
        list
    )
}

fn write_response(stream: &mut TcpStream, status: &str, content_type: &str, body: String) {
    let bytes = body.as_bytes();
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        bytes.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(bytes);
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
