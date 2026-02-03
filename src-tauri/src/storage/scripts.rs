use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use super::ConfigError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptMetadata {
    pub id: String,
    pub name: String,
    pub connection_id: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Script {
    #[serde(flatten)]
    pub metadata: ScriptMetadata,
    pub content: String,
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

/// Get the path to a script's SQL file
fn get_script_sql_path(connection_id: &str, script_id: &str) -> PathBuf {
    get_connection_scripts_dir(connection_id).join(format!("{}.sql", script_id))
}

/// Get the path to a script's metadata file
fn get_script_meta_path(connection_id: &str, script_id: &str) -> PathBuf {
    get_connection_scripts_dir(connection_id).join(format!("{}.meta.json", script_id))
}

/// Load a script's metadata
fn load_script_metadata(connection_id: &str, script_id: &str) -> Result<ScriptMetadata, ConfigError> {
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
    
    // Create empty SQL file
    let sql_path = get_script_sql_path(connection_id, &script_id);
    fs::write(&sql_path, "")?;

    Ok(Script {
        metadata,
        content: String::new(),
    })
}

/// Get a script by ID
pub fn get_script(connection_id: &str, script_id: &str) -> Result<Script, ConfigError> {
    let metadata = load_script_metadata(connection_id, script_id)?;
    let sql_path = get_script_sql_path(connection_id, script_id);
    let content = fs::read_to_string(&sql_path).unwrap_or_default();

    Ok(Script { metadata, content })
}

/// Update a script's content
pub fn update_script_content(connection_id: &str, script_id: &str, content: &str) -> Result<(), ConfigError> {
    // Update the SQL file
    let sql_path = get_script_sql_path(connection_id, script_id);
    fs::write(&sql_path, content)?;
    
    // Update the metadata timestamp
    let mut metadata = load_script_metadata(connection_id, script_id)?;
    metadata.updated_at = chrono::Utc::now().timestamp_millis();
    save_script_metadata(&metadata)?;

    Ok(())
}

/// Rename a script
pub fn rename_script(connection_id: &str, script_id: &str, new_name: &str) -> Result<ScriptMetadata, ConfigError> {
    let mut metadata = load_script_metadata(connection_id, script_id)?;
    metadata.name = new_name.to_string();
    metadata.updated_at = chrono::Utc::now().timestamp_millis();
    save_script_metadata(&metadata)?;
    Ok(metadata)
}

/// Delete a script
pub fn delete_script(connection_id: &str, script_id: &str) -> Result<(), ConfigError> {
    let sql_path = get_script_sql_path(connection_id, script_id);
    let meta_path = get_script_meta_path(connection_id, script_id);
    
    // Remove both files (ignore errors if they don't exist)
    fs::remove_file(&sql_path).ok();
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
