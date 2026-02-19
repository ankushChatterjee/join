use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

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

/// Get the base directory for all scripts
fn get_scripts_base_dir() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("join")
        .join("scripts");

    fs::create_dir_all(&config_dir).ok();
    config_dir
}

/// Get the directory for a specific connection's scripts
fn get_connection_scripts_dir(connection_id: &str) -> PathBuf {
    let dir = get_scripts_base_dir().join(connection_id);
    fs::create_dir_all(&dir).ok();
    dir
}

/// Get the path to a script's legacy SQL file.
fn get_script_sql_path(connection_id: &str, script_id: &str) -> PathBuf {
    get_connection_scripts_dir(connection_id).join(format!("{}.sql", script_id))
}

/// Get the path to a script's sheet JSON file.
fn get_script_sheet_path(connection_id: &str, script_id: &str) -> PathBuf {
    get_connection_scripts_dir(connection_id).join(format!("{}.sheet.json", script_id))
}

/// Get the path to a script's metadata file
fn get_script_meta_path(connection_id: &str, script_id: &str) -> PathBuf {
    get_connection_scripts_dir(connection_id).join(format!("{}.meta.json", script_id))
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
    let meta_path = get_script_meta_path(connection_id, script_id);
    let content = fs::read_to_string(&meta_path)?;
    let metadata: ScriptMetadata = serde_json::from_str(&content)?;
    Ok(metadata)
}

/// Save a script's metadata
fn save_script_metadata(metadata: &ScriptMetadata) -> Result<(), ConfigError> {
    let meta_path = get_script_meta_path(&metadata.connection_id, &metadata.id);
    let content = serde_json::to_string_pretty(metadata)?;
    fs::write(&meta_path, content)?;
    Ok(())
}

fn load_script_sheet(
    connection_id: &str,
    script_id: &str,
) -> Result<SqlSheetDocument, ConfigError> {
    let sheet_path = get_script_sheet_path(connection_id, script_id);

    if sheet_path.exists() {
        let content = fs::read_to_string(&sheet_path)?;
        let sheet: SqlSheetDocument = serde_json::from_str(&content)?;
        return Ok(normalize_sheet(sheet));
    }

    // Legacy migration path: if there is only a .sql file, convert it to one sheet cell.
    let legacy_content =
        fs::read_to_string(get_script_sql_path(connection_id, script_id)).unwrap_or_default();
    let sheet = create_default_sheet(legacy_content);
    save_script_sheet(connection_id, script_id, &sheet)?;
    Ok(sheet)
}

fn save_script_sheet(
    connection_id: &str,
    script_id: &str,
    sheet: &SqlSheetDocument,
) -> Result<(), ConfigError> {
    let sheet_path = get_script_sheet_path(connection_id, script_id);
    let normalized = normalize_sheet(sheet.clone());
    let content = serde_json::to_string_pretty(&normalized)?;
    fs::write(&sheet_path, content)?;
    Ok(())
}

/// List all scripts for a connection
pub fn list_scripts(connection_id: &str) -> Result<Vec<ScriptMetadata>, ConfigError> {
    let dir = get_connection_scripts_dir(connection_id);

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
    save_script_sheet(connection_id, script_id, sheet)?;

    // Update the metadata timestamp
    let mut metadata = load_script_metadata(connection_id, script_id)?;
    metadata.updated_at = chrono::Utc::now().timestamp_millis();
    save_script_metadata(&metadata)?;

    Ok(())
}

/// Rename a script
pub fn rename_script(
    connection_id: &str,
    script_id: &str,
    new_name: &str,
) -> Result<ScriptMetadata, ConfigError> {
    let mut metadata = load_script_metadata(connection_id, script_id)?;
    metadata.name = new_name.to_string();
    metadata.updated_at = chrono::Utc::now().timestamp_millis();
    save_script_metadata(&metadata)?;
    Ok(metadata)
}

/// Delete a script
pub fn delete_script(connection_id: &str, script_id: &str) -> Result<(), ConfigError> {
    let sheet_path = get_script_sheet_path(connection_id, script_id);
    let legacy_sql_path = get_script_sql_path(connection_id, script_id);
    let meta_path = get_script_meta_path(connection_id, script_id);

    // Remove all known files (ignore errors if they don't exist)
    fs::remove_file(&sheet_path).ok();
    fs::remove_file(&legacy_sql_path).ok();
    fs::remove_file(&meta_path).ok();

    Ok(())
}

/// Delete all scripts for a connection
pub fn delete_connection_scripts(connection_id: &str) -> Result<(), ConfigError> {
    let dir = get_connection_scripts_dir(connection_id);
    if dir.exists() {
        fs::remove_dir_all(&dir)?;
    }
    Ok(())
}
