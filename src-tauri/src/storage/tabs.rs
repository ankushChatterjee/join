use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use super::ConfigError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditorTab {
    pub id: String,
    pub name: String,
    pub content: String,
    pub connection_id: String,
    pub is_dirty: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TabsState {
    pub tabs: Vec<EditorTab>,
    pub active_tab_id: Option<String>,
}

fn get_tabs_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("join");

    fs::create_dir_all(&config_dir).ok();
    config_dir.join("tabs.json")
}

pub fn load_tabs() -> Result<TabsState, ConfigError> {
    let path = get_tabs_path();

    if !path.exists() {
        return Ok(TabsState::default());
    }

    let content = fs::read_to_string(&path)?;
    let state: TabsState = serde_json::from_str(&content)?;

    Ok(state)
}

pub fn save_tabs(state: &TabsState) -> Result<(), ConfigError> {
    let path = get_tabs_path();
    let content = serde_json::to_string_pretty(state)?;
    fs::write(&path, content)?;

    Ok(())
}
