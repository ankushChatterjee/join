use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use super::project::get_project_root;
use super::ConfigError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryEntry {
    pub id: String,
    pub sql: String,
    pub connection_id: String,
    pub connection_name: String,
    pub timestamp: i64,
    pub row_count: Option<i64>,
    pub execution_time_ms: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QueryHistory {
    pub entries: Vec<QueryHistoryEntry>,
}

fn get_history_path(project_root: &str) -> Result<PathBuf, ConfigError> {
    Ok(get_project_root(project_root)?
        .join("history")
        .join("query_history.json"))
}

pub fn load_history(project_root: &str) -> Result<QueryHistory, ConfigError> {
    let path = get_history_path(project_root)?;
    if !path.exists() {
        return Ok(QueryHistory::default());
    }
    let content = fs::read_to_string(&path)?;
    let history = serde_json::from_str(&content)?;
    Ok(history)
}

pub fn save_history(project_root: &str, history: &QueryHistory) -> Result<(), ConfigError> {
    let path = get_history_path(project_root)?;
    let content = serde_json::to_string_pretty(history)?;
    fs::write(&path, content)?;
    Ok(())
}

pub fn clear_history(project_root: &str) -> Result<(), ConfigError> {
    save_history(project_root, &QueryHistory::default())
}
