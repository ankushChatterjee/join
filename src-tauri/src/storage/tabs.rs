use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use super::project::get_project_root;
use super::ConfigError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditorTab {
    pub id: String,
    pub name: String,
    #[serde(default = "default_tab_kind")]
    pub kind: String,
    #[serde(default)]
    pub script_id: Option<String>,
    #[serde(default)]
    pub saved_result_id: Option<String>,
    pub content: String,
    pub connection_id: String,
    pub is_dirty: bool,
    #[serde(default)]
    pub is_query_collapsed: bool,
    #[serde(default)]
    pub last_executed_at: Option<i64>,
    #[serde(default)]
    pub last_executed_database: Option<String>,
    pub created_at: i64,
}

fn default_tab_kind() -> String {
    "script".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TabsState {
    pub tabs: Vec<EditorTab>,
    pub active_tab_id: Option<String>,
}

fn get_tabs_path(project_root: &str) -> Result<PathBuf, ConfigError> {
    Ok(get_project_root(project_root)?.join("tabs").join("tabs.json"))
}

pub fn load_tabs(project_root: &str) -> Result<TabsState, ConfigError> {
    let path = get_tabs_path(project_root)?;
    if !path.exists() {
        return Ok(TabsState::default());
    }
    let content = fs::read_to_string(&path)?;
    let state = serde_json::from_str(&content)?;
    Ok(state)
}

pub fn save_tabs(project_root: &str, state: &TabsState) -> Result<(), ConfigError> {
    let path = get_tabs_path(project_root)?;
    let content = serde_json::to_string_pretty(state)?;
    fs::write(&path, content)?;
    Ok(())
}
