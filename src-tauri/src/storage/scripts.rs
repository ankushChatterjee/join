use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use super::path_safety::{safe_join, validate_id};
use super::ConfigError;

const SHEET_FORMAT_VERSION: i64 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptMetadata {
    pub id: String,
    pub name: String,
    pub connection_id: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlSheetCell {
    pub id: String,
    #[serde(default)]
    pub sql: String,
    #[serde(default)]
    pub last_run_at: Option<i64>,
    #[serde(default)]
    pub last_run_duration_ms: Option<i64>,
    #[serde(default)]
    pub last_run_successful: Option<bool>,
    #[serde(default)]
    pub proposed_sql: Option<String>,
}

fn default_sheet_version() -> i64 {
    SHEET_FORMAT_VERSION
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlSheetDocument {
    #[serde(default = "default_sheet_version")]
    pub version: i64,
    #[serde(default)]
    pub selected_cell_id: Option<String>,
    #[serde(default)]
    pub cells: Vec<SqlSheetCell>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Script {
    #[serde(flatten)]
    pub metadata: ScriptMetadata,
    #[serde(flatten)]
    pub sheet: SqlSheetDocument,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptSaveQueueStatus {
    pub script_id: String,
    pub pending_revision: Option<i64>,
    pub last_flushed_revision: i64,
    pub has_pending: bool,
}

#[derive(Debug, Clone)]
struct PendingScriptUpdate {
    connection_id: String,
    script_id: String,
    revision: i64,
    sheet: SqlSheetDocument,
}

static SCRIPT_SAVE_QUEUE: Lazy<Mutex<HashMap<String, PendingScriptUpdate>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Get the base directory for all scripts
fn get_scripts_base_dir() -> PathBuf {
    let config_dir = super::config::get_join_config_dir().join("scripts");

    fs::create_dir_all(&config_dir).ok();
    config_dir
}

/// Get the directory for a specific connection's scripts
fn get_connection_scripts_dir(connection_id: &str) -> Result<PathBuf, ConfigError> {
    safe_join(&get_scripts_base_dir(), connection_id)
}

/// Get the path to a script's legacy SQL file.
fn get_script_sql_path(connection_id: &str, script_id: &str) -> Result<PathBuf, ConfigError> {
    validate_id(script_id)?;
    safe_join(
        &get_connection_scripts_dir(connection_id)?,
        &format!("{}.sql", script_id),
    )
}

/// Get the path to a script's sheet JSON file.
fn get_script_sheet_path(connection_id: &str, script_id: &str) -> Result<PathBuf, ConfigError> {
    validate_id(script_id)?;
    safe_join(
        &get_connection_scripts_dir(connection_id)?,
        &format!("{}.sheet.json", script_id),
    )
}

/// Get the path to a script's metadata file
fn get_script_meta_path(connection_id: &str, script_id: &str) -> Result<PathBuf, ConfigError> {
    validate_id(script_id)?;
    safe_join(
        &get_connection_scripts_dir(connection_id)?,
        &format!("{}.meta.json", script_id),
    )
}

fn new_cell_id() -> String {
    let ts = chrono::Utc::now()
        .timestamp_nanos_opt()
        .unwrap_or_else(|| chrono::Utc::now().timestamp_micros() * 1000);
    format!("cell-{ts}")
}

fn create_default_cell(sql: String) -> SqlSheetCell {
    SqlSheetCell {
        id: new_cell_id(),
        sql,
        last_run_at: None,
        last_run_duration_ms: None,
        last_run_successful: None,
        proposed_sql: None,
    }
}

fn create_default_sheet(sql: String) -> SqlSheetDocument {
    let cell = create_default_cell(sql);
    SqlSheetDocument {
        version: SHEET_FORMAT_VERSION,
        selected_cell_id: Some(cell.id.clone()),
        cells: vec![cell],
    }
}

fn normalize_sheet(mut sheet: SqlSheetDocument) -> SqlSheetDocument {
    if sheet.version <= 0 {
        sheet.version = SHEET_FORMAT_VERSION;
    }

    if sheet.cells.is_empty() {
        sheet.cells.push(create_default_cell(String::new()));
    }

    let selected_exists = sheet
        .selected_cell_id
        .as_ref()
        .map(|id| sheet.cells.iter().any(|cell| cell.id == *id))
        .unwrap_or(false);

    if !selected_exists {
        sheet.selected_cell_id = sheet.cells.first().map(|c| c.id.clone());
    }

    sheet
}

/// Load a script's metadata
fn load_script_metadata(
    connection_id: &str,
    script_id: &str,
) -> Result<ScriptMetadata, ConfigError> {
    let meta_path = get_script_meta_path(connection_id, script_id)?;
    let content = fs::read_to_string(meta_path)?;
    let metadata: ScriptMetadata = serde_json::from_str(&content)?;
    Ok(metadata)
}

/// Save a script's metadata
fn save_script_metadata(metadata: &ScriptMetadata) -> Result<(), ConfigError> {
    let meta_path = get_script_meta_path(&metadata.connection_id, &metadata.id)?;
    let content = serde_json::to_string_pretty(metadata)?;
    fs::write(meta_path, content)?;
    Ok(())
}

fn load_script_sheet(
    connection_id: &str,
    script_id: &str,
) -> Result<SqlSheetDocument, ConfigError> {
    let sheet_path = get_script_sheet_path(connection_id, script_id)?;

    if sheet_path.exists() {
        let content = fs::read_to_string(sheet_path)?;
        let sheet: SqlSheetDocument = serde_json::from_str(&content)?;
        return Ok(normalize_sheet(sheet));
    }

    // Legacy migration path: if there is only a .sql file, convert it to one sheet cell.
    let legacy_content =
        fs::read_to_string(get_script_sql_path(connection_id, script_id)?).unwrap_or_default();
    let sheet = create_default_sheet(legacy_content);
    save_script_sheet(connection_id, script_id, &sheet)?;
    Ok(sheet)
}

fn save_script_sheet(
    connection_id: &str,
    script_id: &str,
    sheet: &SqlSheetDocument,
) -> Result<(), ConfigError> {
    let sheet_path = get_script_sheet_path(connection_id, script_id)?;
    let normalized = normalize_sheet(sheet.clone());
    let content = serde_json::to_string(&normalized)?;
    fs::write(sheet_path, content)?;
    Ok(())
}

/// List all scripts for a connection
pub fn list_scripts(connection_id: &str) -> Result<Vec<ScriptMetadata>, ConfigError> {
    let dir = get_connection_scripts_dir(connection_id)?;

    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut scripts = Vec::new();

    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();

        // Only process .meta.json files
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.ends_with(".meta.json") {
                let script_id = name.trim_end_matches(".meta.json");
                if let Ok(metadata) = load_script_metadata(connection_id, script_id) {
                    scripts.push(metadata);
                }
            }
        }
    }

    // Sort by created_at
    scripts.sort_by(|a, b| a.created_at.cmp(&b.created_at));

    Ok(scripts)
}

/// Create a new script
pub fn create_script(connection_id: &str, name: &str) -> Result<Script, ConfigError> {
    validate_id(connection_id)?;
    let script_id = format!("script-{}", chrono::Utc::now().timestamp_millis());
    let now = chrono::Utc::now().timestamp_millis();

    let metadata = ScriptMetadata {
        id: script_id.clone(),
        name: name.to_string(),
        connection_id: connection_id.to_string(),
        created_at: now,
        updated_at: now,
    };

    // Save metadata
    save_script_metadata(&metadata)?;

    // Create default sheet JSON (single empty cell)
    let sheet = create_default_sheet(String::new());
    save_script_sheet(connection_id, &script_id, &sheet)?;

    Ok(Script { metadata, sheet })
}

/// Get a script by ID
pub fn get_script(connection_id: &str, script_id: &str) -> Result<Script, ConfigError> {
    validate_id(connection_id)?;
    validate_id(script_id)?;
    let metadata = load_script_metadata(connection_id, script_id)?;
    let sheet = load_script_sheet(connection_id, script_id)?;

    Ok(Script { metadata, sheet })
}

/// Update a script's sheet content
pub fn update_script_content(
    connection_id: &str,
    script_id: &str,
    sheet: &SqlSheetDocument,
) -> Result<(), ConfigError> {
    validate_id(connection_id)?;
    validate_id(script_id)?;
    save_script_sheet(connection_id, script_id, sheet)?;

    // Update the metadata timestamp
    let mut metadata = load_script_metadata(connection_id, script_id)?;
    metadata.updated_at = chrono::Utc::now().timestamp_millis();
    save_script_metadata(&metadata)?;

    Ok(())
}

pub fn queue_script_update(
    connection_id: &str,
    script_id: &str,
    sheet: &SqlSheetDocument,
    revision: i64,
) -> Result<ScriptSaveQueueStatus, ConfigError> {
    validate_id(connection_id)?;
    validate_id(script_id)?;
    let key = format!("{connection_id}:{script_id}");
    let mut queue = SCRIPT_SAVE_QUEUE
        .lock()
        .map_err(|_| ConfigError::ValidationError("script save queue lock poisoned".to_string()))?;

    let last_flushed_revision = queue.get(&key).map(|u| u.revision).unwrap_or(0);
    queue.insert(
        key,
        PendingScriptUpdate {
            connection_id: connection_id.to_string(),
            script_id: script_id.to_string(),
            revision,
            sheet: normalize_sheet(sheet.clone()),
        },
    );

    Ok(ScriptSaveQueueStatus {
        script_id: script_id.to_string(),
        pending_revision: Some(revision),
        last_flushed_revision,
        has_pending: true,
    })
}

pub fn flush_script_updates(script_id: &str) -> Result<ScriptSaveQueueStatus, ConfigError> {
    validate_id(script_id)?;
    let mut queue = SCRIPT_SAVE_QUEUE
        .lock()
        .map_err(|_| ConfigError::ValidationError("script save queue lock poisoned".to_string()))?;
    let key = queue
        .keys()
        .find(|k| k.rsplit(':').next() == Some(script_id))
        .cloned();

    let Some(queue_key) = key else {
        return Ok(ScriptSaveQueueStatus {
            script_id: script_id.to_string(),
            pending_revision: None,
            last_flushed_revision: 0,
            has_pending: false,
        });
    };
    let pending = queue.remove(&queue_key);
    drop(queue);

    let Some(update) = pending else {
        return Ok(ScriptSaveQueueStatus {
            script_id: script_id.to_string(),
            pending_revision: None,
            last_flushed_revision: 0,
            has_pending: false,
        });
    };

    update_script_content(&update.connection_id, &update.script_id, &update.sheet)?;

    Ok(ScriptSaveQueueStatus {
        script_id: update.script_id,
        pending_revision: None,
        last_flushed_revision: update.revision,
        has_pending: false,
    })
}

pub fn get_script_update_status(script_id: &str) -> Result<ScriptSaveQueueStatus, ConfigError> {
    validate_id(script_id)?;
    let queue = SCRIPT_SAVE_QUEUE
        .lock()
        .map_err(|_| ConfigError::ValidationError("script save queue lock poisoned".to_string()))?;
    let maybe_pending = queue
        .iter()
        .find(|(k, _)| k.rsplit(':').next() == Some(script_id))
        .map(|(_, v)| v.revision);

    Ok(ScriptSaveQueueStatus {
        script_id: script_id.to_string(),
        pending_revision: maybe_pending,
        last_flushed_revision: 0,
        has_pending: maybe_pending.is_some(),
    })
}

/// Rename a script
pub fn rename_script(
    connection_id: &str,
    script_id: &str,
    new_name: &str,
) -> Result<ScriptMetadata, ConfigError> {
    validate_id(connection_id)?;
    validate_id(script_id)?;
    let mut metadata = load_script_metadata(connection_id, script_id)?;
    metadata.name = new_name.to_string();
    metadata.updated_at = chrono::Utc::now().timestamp_millis();
    save_script_metadata(&metadata)?;
    Ok(metadata)
}

/// Delete a script
pub fn delete_script(connection_id: &str, script_id: &str) -> Result<(), ConfigError> {
    validate_id(connection_id)?;
    validate_id(script_id)?;
    let sheet_path = get_script_sheet_path(connection_id, script_id)?;
    let legacy_sql_path = get_script_sql_path(connection_id, script_id)?;
    let meta_path = get_script_meta_path(connection_id, script_id)?;

    // Remove all known files (ignore errors if they don't exist)
    fs::remove_file(sheet_path).ok();
    fs::remove_file(legacy_sql_path).ok();
    fs::remove_file(meta_path).ok();

    Ok(())
}

/// Delete all scripts for a connection
pub fn delete_connection_scripts(connection_id: &str) -> Result<(), ConfigError> {
    validate_id(connection_id)?;
    let dir = get_connection_scripts_dir(connection_id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir)?;
    }
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
        let dir = std::env::temp_dir().join(format!("join-scripts-tests-{nanos}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        unsafe {
            std::env::set_var("JOIN_CONFIG_DIR", &dir);
        }
        dir
    }

    #[test]
    fn update_script_normalizes_empty_sheet_and_selection() {
        let _lock = crate::storage::config::test_env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _guard = setup_temp_config();
        let script = create_script("conn-1", "My Script").expect("create script");

        let sheet = SqlSheetDocument {
            version: 0,
            selected_cell_id: Some("missing-cell".into()),
            cells: vec![],
        };
        update_script_content("conn-1", &script.metadata.id, &sheet).expect("update");

        let loaded = get_script("conn-1", &script.metadata.id).expect("load script");
        assert_eq!(loaded.sheet.version, SHEET_FORMAT_VERSION);
        assert_eq!(loaded.sheet.cells.len(), 1);
        assert_eq!(
            loaded.sheet.selected_cell_id.as_deref(),
            Some(loaded.sheet.cells[0].id.as_str())
        );
    }

    #[test]
    fn get_script_migrates_legacy_sql_file() {
        let _lock = crate::storage::config::test_env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _guard = setup_temp_config();
        let script = create_script("conn-legacy", "Legacy Script").expect("create script");

        let legacy_sql = "SELECT * FROM customers;";
        let legacy_path =
            get_script_sql_path("conn-legacy", &script.metadata.id).expect("legacy path");
        fs::write(&legacy_path, legacy_sql).expect("write legacy sql");
        fs::remove_file(
            get_script_sheet_path("conn-legacy", &script.metadata.id).expect("sheet path"),
        )
        .expect("remove sheet");

        let loaded = get_script("conn-legacy", &script.metadata.id).expect("load script");
        assert_eq!(loaded.sheet.cells.len(), 1);
        assert_eq!(loaded.sheet.cells[0].sql, legacy_sql);
        assert!(get_script_sheet_path("conn-legacy", &script.metadata.id)
            .expect("sheet path")
            .exists());
    }

    #[test]
    fn queue_coalesces_and_flushes_latest_revision() {
        let _lock = crate::storage::config::test_env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _guard = setup_temp_config();
        let script = create_script("conn-q", "Queue Script").expect("create script");

        let first_sheet = SqlSheetDocument {
            version: SHEET_FORMAT_VERSION,
            selected_cell_id: Some("cell-1".into()),
            cells: vec![SqlSheetCell {
                id: "cell-1".into(),
                sql: "SELECT 1".into(),
                last_run_at: None,
                last_run_duration_ms: None,
                last_run_successful: None,
                proposed_sql: None,
            }],
        };
        let second_sheet = SqlSheetDocument {
            version: SHEET_FORMAT_VERSION,
            selected_cell_id: Some("cell-1".into()),
            cells: vec![SqlSheetCell {
                id: "cell-1".into(),
                sql: "SELECT 2".into(),
                last_run_at: None,
                last_run_duration_ms: None,
                last_run_successful: None,
                proposed_sql: None,
            }],
        };

        queue_script_update("conn-q", &script.metadata.id, &first_sheet, 1).expect("queue first");
        queue_script_update("conn-q", &script.metadata.id, &second_sheet, 2).expect("queue second");
        let status = flush_script_updates(&script.metadata.id).expect("flush");
        assert_eq!(status.last_flushed_revision, 2);
        let loaded = get_script("conn-q", &script.metadata.id).expect("load");
        assert_eq!(loaded.sheet.cells[0].sql, "SELECT 2");
    }
}
