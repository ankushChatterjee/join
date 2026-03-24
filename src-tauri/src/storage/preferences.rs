use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use super::config::{get_join_config_dir, ConfigError};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AiPreferences {
    #[serde(default)]
    pub selected_model_id: Option<String>,
}

fn get_preferences_path() -> PathBuf {
    get_join_config_dir().join("preferences.json")
}

pub fn load_ai_preferences() -> Result<AiPreferences, ConfigError> {
    let path = get_preferences_path();

    if !path.exists() {
        return Ok(AiPreferences::default());
    }

    let content = fs::read_to_string(&path)?;
    let prefs: AiPreferences = serde_json::from_str(&content)?;

    Ok(prefs)
}

pub fn save_ai_preferences(prefs: &AiPreferences) -> Result<(), ConfigError> {
    let path = get_preferences_path();
    fs::create_dir_all(path.parent().unwrap_or(&get_join_config_dir()))?;
    let content = serde_json::to_string_pretty(prefs)?;
    fs::write(&path, content)?;

    Ok(())
}

pub fn get_selected_model_id() -> Result<Option<String>, ConfigError> {
    let prefs = load_ai_preferences()?;
    Ok(prefs.selected_model_id)
}

pub fn set_selected_model_id(model_id: String) -> Result<(), ConfigError> {
    let mut prefs = load_ai_preferences()?;
    prefs.selected_model_id = Some(model_id);
    save_ai_preferences(&prefs)
}
