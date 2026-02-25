use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

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

fn get_tabs_path() -> PathBuf {
    let config_dir = super::config::get_join_config_dir();

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn setup_temp_config() -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("join-tabs-tests-{nanos}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        unsafe {
            std::env::set_var("JOIN_CONFIG_DIR", &dir);
        }
        dir
    }

    #[test]
    fn tabs_roundtrip_persists_state() {
        let _lock = crate::storage::config::test_env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _guard = setup_temp_config();
        let state = TabsState {
            tabs: vec![EditorTab {
                id: "tab-1".into(),
                name: "Tab".into(),
                kind: "script".into(),
                script_id: Some("script-1".into()),
                saved_result_id: None,
                content: "SELECT 1;".into(),
                connection_id: "conn-1".into(),
                is_dirty: true,
                is_query_collapsed: false,
                last_executed_at: Some(1_700_000_000_000),
                last_executed_database: Some("join_test".into()),
                created_at: 1_700_000_000_000,
            }],
            active_tab_id: Some("tab-1".into()),
        };

        save_tabs(&state).expect("save");
        let loaded = load_tabs().expect("load");
        assert_eq!(loaded.tabs.len(), 1);
        assert_eq!(loaded.active_tab_id.as_deref(), Some("tab-1"));
        assert_eq!(loaded.tabs[0].content, "SELECT 1;");
    }
}
