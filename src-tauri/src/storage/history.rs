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
    let config_dir = super::config::get_join_config_dir();

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn setup_temp_config() -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("join-history-tests-{nanos}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        unsafe {
            std::env::set_var("JOIN_CONFIG_DIR", &dir);
        }
        dir
    }

    #[test]
    fn add_history_entry_keeps_latest_50() {
        let _lock = crate::storage::config::test_env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _guard = setup_temp_config();
        clear_history().expect("clear");

        for i in 0..55 {
            add_history_entry(QueryHistoryEntry {
                id: format!("id-{i}"),
                sql: format!("SELECT {i}"),
                connection_id: "conn-1".into(),
                connection_name: "Conn".into(),
                timestamp: i,
                row_count: Some(i),
                execution_time_ms: Some(i),
                error: None,
            })
            .expect("add");
        }

        let history = load_history().expect("load");
        assert_eq!(history.entries.len(), 50);
        assert_eq!(history.entries[0].id, "id-54");
        assert_eq!(history.entries[49].id, "id-5");
    }
}
