use std::path::{Path, PathBuf};

use crate::config::{get_home_dir, write_text_file};
use crate::error::AppError;
use serde_json::{json, Value};
use toml::Value as TomlValue;
use toml_edit::{value, DocumentMut, Item};

pub const CC_SWITCH_GROK_PROXY_MODEL_ID: &str = "cc-switch-proxy";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GrokModelConfig {
    pub id: String,
    pub model: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub api_backend: Option<String>,
    pub auth_scheme: Option<String>,
}

pub fn get_grok_config_dir() -> PathBuf {
    get_home_dir().join(".grok")
}

pub fn get_grok_config_path() -> PathBuf {
    get_grok_config_dir().join("config.toml")
}

pub fn read_grok_config_text() -> Result<String, AppError> {
    let path = get_grok_config_path();
    if path.exists() {
        std::fs::read_to_string(&path).map_err(|e| AppError::io(&path, e))
    } else {
        Ok(String::new())
    }
}

pub fn validate_grok_config_toml(text: &str) -> Result<(), AppError> {
    if text.trim().is_empty() {
        return Ok(());
    }
    toml::from_str::<toml::Table>(text)
        .map(|_| ())
        .map_err(|e| AppError::toml(Path::new("config.toml"), e))
}

pub fn read_grok_live_settings() -> Result<Value, AppError> {
    let config = read_grok_config_text()?;
    validate_grok_config_toml(&config)?;
    Ok(json!({ "config": config }))
}

pub fn write_grok_live_settings(settings: &Value) -> Result<(), AppError> {
    let config_text = settings.get("config").and_then(Value::as_str).unwrap_or("");
    validate_grok_config_toml(config_text)?;
    let path = get_grok_config_path();
    write_text_file(&path, config_text)
}

pub fn extract_grok_default_model(config_text: &str) -> Option<GrokModelConfig> {
    let doc = toml::from_str::<TomlValue>(config_text).ok()?;
    let model_tables = doc.get("model")?.as_table()?;
    let default_id = doc
        .get("models")
        .and_then(|models| models.get("default"))
        .and_then(TomlValue::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty());

    let (id, table) = if let Some(default_id) = default_id {
        let table = model_tables.get(default_id)?.as_table()?;
        (default_id.to_string(), table)
    } else {
        model_tables
            .iter()
            .filter_map(|(id, value)| value.as_table().map(|table| (id.clone(), table)))
            .find(|(id, table)| {
                id != "grok-build"
                    && !table
                        .get("hidden")
                        .and_then(TomlValue::as_bool)
                        .unwrap_or(false)
            })?
    };

    let model = table
        .get("model")
        .and_then(TomlValue::as_str)
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .unwrap_or(id.as_str())
        .to_string();

    Some(GrokModelConfig {
        id,
        model,
        base_url: table
            .get("base_url")
            .and_then(TomlValue::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        api_key: table
            .get("api_key")
            .and_then(TomlValue::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        api_backend: table
            .get("api_backend")
            .and_then(TomlValue::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        auth_scheme: table
            .get("auth_scheme")
            .and_then(TomlValue::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
    })
}

pub fn apply_grok_proxy_config(
    config_text: &str,
    proxy_base_url: &str,
    upstream_model: &str,
    api_key_placeholder: &str,
) -> Result<String, AppError> {
    let mut doc = parse_toml_document(config_text)?;

    if !doc["models"].is_table() {
        doc["models"] = Item::Table(Default::default());
    }
    doc["models"]["default"] = value(CC_SWITCH_GROK_PROXY_MODEL_ID);

    if !doc["model"].is_table() {
        doc["model"] = Item::Table(Default::default());
    }
    doc["model"][CC_SWITCH_GROK_PROXY_MODEL_ID] = Item::Table(Default::default());
    doc["model"][CC_SWITCH_GROK_PROXY_MODEL_ID]["name"] = value("CC Switch Proxy");
    doc["model"][CC_SWITCH_GROK_PROXY_MODEL_ID]["model"] = value(upstream_model);
    doc["model"][CC_SWITCH_GROK_PROXY_MODEL_ID]["base_url"] = value(proxy_base_url);
    doc["model"][CC_SWITCH_GROK_PROXY_MODEL_ID]["api_backend"] = value("chat_completions");
    doc["model"][CC_SWITCH_GROK_PROXY_MODEL_ID]["api_key"] = value(api_key_placeholder);

    Ok(doc.to_string())
}

pub fn remove_grok_proxy_config(config_text: &str) -> Result<String, AppError> {
    let mut doc = parse_toml_document(config_text)?;

    let fallback_default = if let Some(model_table) = doc["model"].as_table_like_mut() {
        model_table.remove(CC_SWITCH_GROK_PROXY_MODEL_ID);
        model_table
            .iter()
            .find(|(id, item)| {
                *id != CC_SWITCH_GROK_PROXY_MODEL_ID && item.as_table_like().is_some()
            })
            .map(|(id, _)| id.to_string())
    } else {
        None
    };

    if doc["models"]["default"].as_str() == Some(CC_SWITCH_GROK_PROXY_MODEL_ID) {
        if let Some(default_id) = fallback_default {
            doc["models"]["default"] = value(default_id);
        } else if let Some(models) = doc["models"].as_table_like_mut() {
            models.remove("default");
        }
    }

    Ok(doc.to_string())
}

pub fn is_grok_proxy_config_taken_over(
    config_text: &str,
    api_key_placeholder: &str,
    local_proxy_predicate: impl Fn(&str) -> bool,
) -> bool {
    let Ok(doc) = toml::from_str::<TomlValue>(config_text) else {
        return false;
    };
    let Some(model) = doc
        .get("model")
        .and_then(|models| models.get(CC_SWITCH_GROK_PROXY_MODEL_ID))
        .and_then(TomlValue::as_table)
    else {
        return false;
    };

    model
        .get("api_key")
        .and_then(TomlValue::as_str)
        .map(|value| value == api_key_placeholder)
        .unwrap_or(false)
        || model
            .get("base_url")
            .and_then(TomlValue::as_str)
            .map(local_proxy_predicate)
            .unwrap_or(false)
}

fn parse_toml_document(config_text: &str) -> Result<DocumentMut, AppError> {
    if config_text.trim().is_empty() {
        Ok(DocumentMut::new())
    } else {
        config_text
            .parse::<DocumentMut>()
            .map_err(|e| AppError::InvalidInput(format!("TOML 解析错误: config.toml: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_default_model_from_grok_config() {
        let config = r#"
[models]
default = "DeepSeek/deepseek-v4-pro"

[model."DeepSeek/deepseek-v4-pro"]
model = "DeepSeek/deepseek-v4-pro"
base_url = "https://api.example.com/v1"
api_key = "sk-test"
api_backend = "chat_completions"
"#;

        let model = extract_grok_default_model(config).unwrap();
        assert_eq!(model.model, "DeepSeek/deepseek-v4-pro");
        assert_eq!(
            model.base_url.as_deref(),
            Some("https://api.example.com/v1")
        );
        assert_eq!(model.api_key.as_deref(), Some("sk-test"));
    }

    #[test]
    fn applies_and_removes_proxy_model() {
        let input = r#"
[models]
default = "real"

[model.real]
model = "gpt-4o"
base_url = "https://api.example.com/v1"
"#;

        let proxied =
            apply_grok_proxy_config(input, "http://127.0.0.1:15721/grok/v1", "gpt-4o", "PROXY")
                .unwrap();
        assert!(is_grok_proxy_config_taken_over(&proxied, "PROXY", |url| {
            url.starts_with("http://127.0.0.1")
        }));

        let restored = remove_grok_proxy_config(&proxied).unwrap();
        let model = extract_grok_default_model(&restored).unwrap();
        assert_eq!(model.id, "real");
        assert!(!restored.contains(CC_SWITCH_GROK_PROXY_MODEL_ID));
    }
}
