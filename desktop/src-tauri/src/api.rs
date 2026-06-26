use reqwest::{
    header::{HeaderMap, COOKIE, SET_COOKIE},
    Client, Response,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::state::PersistedState;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct UserDto {
    pub uid: String,
    pub username: String,
    pub balance_mb: i64,
    pub total_recharged_mb: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RechargeDto {
    pub balance_mb: i64,
    pub total_recharged_mb: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProxyDto {
    pub id: u64,
    pub name: String,
    pub proxy_type: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub is_online: bool,
    #[serde(default)]
    pub local_ip: Option<String>,
    #[serde(default)]
    pub local_port: Option<i64>,
    #[serde(default)]
    pub subdomain: Option<String>,
    #[serde(default)]
    pub public_url: Option<String>,
    #[serde(default)]
    pub public_urls: Vec<String>,
    #[serde(default)]
    pub speed_limit_kbps: Option<i64>,
    #[serde(default)]
    pub traffic_limit_mb: Option<i64>,
    #[serde(default)]
    pub traffic_used_bytes: Option<i64>,
    #[serde(default)]
    pub current_speed_bps: Option<i64>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProxyListDto {
    pub proxies: Vec<ProxyDto>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProxyScriptsDto {
    pub proxy: ProxyDto,
    pub frpc_config: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AuthResult {
    pub user: UserDto,
    pub user_session: Option<String>,
    pub uid_cookie: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AdvancedConfigInput {
    #[serde(default)]
    pub use_encryption: bool,
    #[serde(default)]
    pub use_compression: bool,
    #[serde(default = "default_bandwidth_mode")]
    pub bandwidth_limit_mode: String,
    #[serde(default)]
    pub http_user: Option<String>,
    #[serde(default)]
    pub http_password: Option<String>,
    #[serde(default)]
    pub http_locations: Vec<String>,
    #[serde(default)]
    pub host_header_rewrite: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateHttpProxyInput {
    pub name: String,
    pub local_ip: String,
    pub local_port: i64,
    pub subdomain: String,
    pub traffic_mb: i64,
    pub speed_limit_kbps: i64,
    #[serde(default)]
    pub advanced_config: Option<AdvancedConfigInput>,
}

#[derive(Debug, Clone)]
pub struct ApiClient {
    base_url: String,
    user_session: Option<String>,
    uid_cookie: Option<String>,
    client: Client,
}

impl ApiClient {
    pub fn from_state(state: &PersistedState) -> Self {
        Self {
            base_url: state.base_url.trim_end_matches('/').to_string(),
            user_session: state.user_session.clone(),
            uid_cookie: state.uid_cookie.clone(),
            client: Client::new(),
        }
    }

    pub async fn register(&self, username: String, password: String) -> Result<AuthResult, String> {
        let response = self
            .client
            .post(self.url("/api/user/register"))
            .json(&json!({ "username": username, "password": password }))
            .send()
            .await
            .map_err(network_error)?;
        self.auth_result(response).await
    }

    pub async fn login(&self, username: String, password: String) -> Result<AuthResult, String> {
        let response = self
            .client
            .post(self.url("/api/user/login"))
            .json(&json!({ "username": username, "password": password }))
            .send()
            .await
            .map_err(network_error)?;
        self.auth_result(response).await
    }

    pub async fn logout(&self) -> Result<(), String> {
        let response = self
            .with_auth(self.client.post(self.url("/api/user/logout")))
            .send()
            .await
            .map_err(network_error)?;
        read_empty(response).await
    }

    pub async fn me(&self) -> Result<UserDto, String> {
        let response = self
            .with_auth(self.client.get(self.url("/api/user/me")))
            .send()
            .await
            .map_err(network_error)?;
        read_json(response).await
    }

    pub async fn recharge(&self) -> Result<RechargeDto, String> {
        let response = self
            .with_auth(
                self.client
                    .post(self.url("/api/user/recharge"))
                    .json(&json!({})),
            )
            .send()
            .await
            .map_err(network_error)?;
        read_json(response).await
    }

    pub async fn list_http_proxies(&self) -> Result<ProxyListDto, String> {
        let response = self
            .with_auth(self.client.get(self.url("/api/proxies")))
            .send()
            .await
            .map_err(network_error)?;
        let mut list: ProxyListDto = read_json(response).await?;
        list.proxies
            .retain(|proxy| proxy.proxy_type == "http" && proxy.status != "deleted");
        Ok(list)
    }

    pub async fn create_http_proxy(
        &self,
        input: CreateHttpProxyInput,
    ) -> Result<ProxyScriptsDto, String> {
        let advanced = input.advanced_config.unwrap_or_default();
        let response = self
            .with_auth(self.client.post(self.url("/api/proxies")))
            .json(&json!({
                "name": input.name,
                "proxy_type": "http",
                "traffic_mb": input.traffic_mb,
                "speed_limit_kbps": input.speed_limit_kbps,
                "local_ip": input.local_ip,
                "local_port": input.local_port,
                "subdomain": input.subdomain,
                "advanced_config": {
                    "use_encryption": advanced.use_encryption,
                    "use_compression": advanced.use_compression,
                    "bandwidth_limit_mode": advanced.bandwidth_limit_mode,
                    "http_user": blank_to_null(advanced.http_user),
                    "http_password": blank_to_null(advanced.http_password),
                    "http_locations": advanced.http_locations,
                    "host_header_rewrite": blank_to_null(advanced.host_header_rewrite)
                }
            }))
            .send()
            .await
            .map_err(network_error)?;
        read_json(response).await
    }

    pub async fn get_proxy_scripts(&self, proxy_id: u64) -> Result<ProxyScriptsDto, String> {
        let response = self
            .with_auth(
                self.client
                    .get(self.url(&format!("/api/proxies/{proxy_id}/scripts"))),
            )
            .send()
            .await
            .map_err(network_error)?;
        read_json(response).await
    }

    pub async fn delete_proxy(&self, proxy_id: u64) -> Result<(), String> {
        let response = self
            .with_auth(
                self.client
                    .delete(self.url(&format!("/api/proxies/{proxy_id}"))),
            )
            .send()
            .await
            .map_err(network_error)?;
        read_empty(response).await
    }

    pub async fn start_proxy(&self, proxy_id: u64) -> Result<(), String> {
        let response = self
            .with_auth(
                self.client
                    .post(self.url(&format!("/api/proxies/{proxy_id}/start"))),
            )
            .send()
            .await
            .map_err(network_error)?;
        read_empty(response).await
    }

    pub async fn stop_proxy(&self, proxy_id: u64) -> Result<(), String> {
        let response = self
            .with_auth(
                self.client
                    .post(self.url(&format!("/api/proxies/{proxy_id}/stop"))),
            )
            .send()
            .await
            .map_err(network_error)?;
        read_empty(response).await
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    fn with_auth(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        let mut cookies = Vec::new();
        if let Some(session) = &self.user_session {
            cookies.push(format!("user_session={session}"));
        }
        if let Some(uid) = &self.uid_cookie {
            cookies.push(format!("uid={uid}"));
        }
        if cookies.is_empty() {
            builder
        } else {
            builder.header(COOKIE, cookies.join("; "))
        }
    }

    async fn auth_result(&self, response: Response) -> Result<AuthResult, String> {
        let user_session = extract_cookie(response.headers(), "user_session");
        let uid_cookie = extract_cookie(response.headers(), "uid");
        let user = read_json(response).await?;
        Ok(AuthResult {
            user,
            user_session,
            uid_cookie,
        })
    }
}

impl Default for AdvancedConfigInput {
    fn default() -> Self {
        Self {
            use_encryption: false,
            use_compression: false,
            bandwidth_limit_mode: default_bandwidth_mode(),
            http_user: None,
            http_password: None,
            http_locations: Vec::new(),
            host_header_rewrite: None,
        }
    }
}

fn default_bandwidth_mode() -> String {
    "server".to_string()
}

fn blank_to_null(value: Option<String>) -> Option<String> {
    value.and_then(|text| {
        let trimmed = text.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn extract_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    let prefix = format!("{name}=");
    for value in headers.get_all(SET_COOKIE) {
        let Ok(text) = value.to_str() else {
            continue;
        };
        if let Some(rest) = text.strip_prefix(&prefix) {
            return rest.split(';').next().map(|item| item.to_string());
        }
    }
    None
}

async fn read_empty(response: Response) -> Result<(), String> {
    if response.status().is_success() {
        Ok(())
    } else {
        Err(response_error(response).await)
    }
}

async fn read_json<T: for<'de> Deserialize<'de>>(response: Response) -> Result<T, String> {
    if !response.status().is_success() {
        return Err(response_error(response).await);
    }
    response
        .json::<T>()
        .await
        .map_err(|error| format!("后端响应格式错误: {error}"))
}

async fn response_error(response: Response) -> String {
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if let Ok(value) = serde_json::from_str::<Value>(&text) {
        if let Some(detail) = value.get("detail").and_then(Value::as_str) {
            return detail.to_string();
        }
        if let Some(message) = value.get("message").and_then(Value::as_str) {
            return message.to_string();
        }
    }
    if text.trim().is_empty() {
        format!("后端请求失败: HTTP {status}")
    } else {
        format!("后端请求失败: HTTP {status}: {text}")
    }
}

fn network_error(error: reqwest::Error) -> String {
    if error.is_connect() {
        "无法连接发布端后端".to_string()
    } else {
        format!("网络请求失败: {error}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client() -> ApiClient {
        ApiClient {
            base_url: "https://bearfrp.example.test".to_string(),
            user_session: Some("session-1".to_string()),
            uid_cookie: Some("uid-1".to_string()),
            client: Client::new(),
        }
    }

    #[test]
    fn url_joins_backend_base_and_api_path() {
        let client = client();
        assert_eq!(
            client.url("/api/user/me"),
            "https://bearfrp.example.test/api/user/me"
        );
    }

    #[test]
    fn with_auth_adds_user_session_and_uid_cookies() {
        let client = client();
        let request = client
            .with_auth(client.client.get(client.url("/api/user/me")))
            .build()
            .unwrap();
        let cookie = request.headers().get(COOKIE).unwrap().to_str().unwrap();
        assert!(cookie.contains("user_session=session-1"));
        assert!(cookie.contains("uid=uid-1"));
    }

    #[test]
    fn extract_cookie_reads_named_set_cookie_value() {
        let mut headers = HeaderMap::new();
        headers.append(
            SET_COOKIE,
            "user_session=session-2; Path=/; HttpOnly".parse().unwrap(),
        );
        headers.append(SET_COOKIE, "uid=uid-2; Path=/".parse().unwrap());
        assert_eq!(extract_cookie(&headers, "user_session"), Some("session-2".to_string()));
        assert_eq!(extract_cookie(&headers, "uid"), Some("uid-2".to_string()));
        assert_eq!(extract_cookie(&headers, "missing"), None);
    }
}
