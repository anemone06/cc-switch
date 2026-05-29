use super::{adapter::auth_header_value, AuthInfo, AuthStrategy, ProviderAdapter};
use crate::provider::Provider;
use crate::proxy::error::ProxyError;

pub struct GrokAdapter;

impl GrokAdapter {
    pub fn new() -> Self {
        Self
    }

    fn extract_model_config(provider: &Provider) -> Option<crate::grok_config::GrokModelConfig> {
        provider
            .settings_config
            .get("config")
            .and_then(|value| value.as_str())
            .and_then(crate::grok_config::extract_grok_default_model)
    }
}

impl Default for GrokAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl ProviderAdapter for GrokAdapter {
    fn name(&self) -> &'static str {
        "Grok"
    }

    fn extract_base_url(&self, provider: &Provider) -> Result<String, ProxyError> {
        if let Some(url) = provider
            .settings_config
            .get("base_url")
            .or_else(|| provider.settings_config.get("baseURL"))
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Ok(url.trim_end_matches('/').to_string());
        }

        Self::extract_model_config(provider)
            .and_then(|config| config.base_url)
            .map(|url| url.trim_end_matches('/').to_string())
            .ok_or_else(|| ProxyError::ConfigError("Grok Provider 缺少 base_url 配置".to_string()))
    }

    fn extract_auth(&self, provider: &Provider) -> Option<AuthInfo> {
        if let Some(key) = provider
            .settings_config
            .get("api_key")
            .or_else(|| provider.settings_config.get("apiKey"))
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some(AuthInfo::new(key.to_string(), AuthStrategy::Bearer));
        }

        let model_config = Self::extract_model_config(provider)?;
        let api_key = model_config.api_key.or_else(|| {
            model_config
                .env_key
                .and_then(|key| std::env::var(key).ok())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })?;
        let strategy = match model_config.auth_scheme.as_deref() {
            Some("x_api_key") | Some("x-api-key") => AuthStrategy::Anthropic,
            _ => AuthStrategy::Bearer,
        };
        Some(AuthInfo::new(api_key, strategy))
    }

    fn build_url(&self, base_url: &str, endpoint: &str) -> String {
        let base_trimmed = base_url.trim_end_matches('/');
        let endpoint_trimmed = endpoint.trim_start_matches('/');
        let origin_only = super::is_origin_only_url(base_trimmed);

        let mut url = if base_trimmed.ends_with("/v1") {
            format!("{base_trimmed}/{endpoint_trimmed}")
        } else if origin_only {
            format!("{base_trimmed}/v1/{endpoint_trimmed}")
        } else {
            format!("{base_trimmed}/{endpoint_trimmed}")
        };

        while url.contains("/v1/v1") {
            url = url.replace("/v1/v1", "/v1");
        }

        url
    }

    fn get_auth_headers(
        &self,
        auth: &AuthInfo,
    ) -> Result<Vec<(http::HeaderName, http::HeaderValue)>, ProxyError> {
        if auth.strategy == AuthStrategy::Anthropic {
            return Ok(vec![(
                http::HeaderName::from_static("x-api-key"),
                auth_header_value(&auth.api_key)?,
            )]);
        }

        let bearer = format!("Bearer {}", auth.api_key);
        Ok(vec![(
            http::HeaderName::from_static("authorization"),
            auth_header_value(&bearer)?,
        )])
    }
}
