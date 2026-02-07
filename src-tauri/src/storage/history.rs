use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use super::ConfigError;

/// A single query history entry
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

/// Container for query history
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QueryHistory {
    pub entries: Vec<QueryHistoryEntry>,
}

/// Get the path to the query history file
fn get_history_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("join");

    fs::create_dir_all(&config_dir).ok();
    config_dir.join("query_history.json")
}

/// Load query history from disk
pub fn load_history() -> Result<QueryHistory, ConfigError> {
    let path = get_history_path();

    if !path.exists() {
        return Ok(QueryHistory::default());
    }

    let content = fs::read_to_string(&path)?;
    let history: QueryHistory = serde_json::from_str(&content)?;

    Ok(history)
}

/// Save query history to disk
pub fn save_history(history: &QueryHistory) -> Result<(), ConfigError> {
    let path = get_history_path();
    let content = serde_json::to_string_pretty(history)?;
    fs::write(&path, content)?;

    Ok(())
}

/// Add an entry to the history (keeps last 50 entries)
pub fn add_history_entry(entry: QueryHistoryEntry) -> Result<(), ConfigError> {
    let mut history = load_history()?;
    
    // Add new entry at the beginning
    history.entries.insert(0, entry);
    
    // Keep only last 50 entries
    history.entries.truncate(50);
    
    save_history(&history)
}

/// Clear all history
pub fn clear_history() -> Result<(), ConfigError> {
    save_history(&QueryHistory::default())
}

