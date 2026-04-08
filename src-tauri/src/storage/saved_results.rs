use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::fs;
use std::path::{Path, PathBuf};

use crate::db::{ColumnDef, QueryResult};

use super::path_safety::{safe_join, validate_id};
use super::project::get_project_root;
use super::ConfigError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedResultMetadata {
    pub id: String,
    pub name: String,
    pub connection_id: String,
    pub sql: String,
    pub preview_source: Option<String>,
    pub row_count: i64,
    pub execution_time_ms: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveSavedResultRequest {
    pub id: Option<String>,
    pub name: Option<String>,
    pub sql: String,
    pub preview_source: Option<String>,
    pub query_result: QueryResult,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedResult {
    #[serde(flatten)]
    pub metadata: SavedResultMetadata,
    pub query_result: QueryResult,
}

fn get_saved_results_base_dir(project_root: &Path) -> PathBuf {
    let dir = project_root.join("saved-results");
    fs::create_dir_all(&dir).ok();
    dir
}

fn get_connection_saved_results_dir(
    project_root: &Path,
    connection_id: &str,
) -> Result<PathBuf, ConfigError> {
    safe_join(&get_saved_results_base_dir(project_root), connection_id)
}

fn get_saved_result_meta_path(
    project_root: &Path,
    connection_id: &str,
    saved_result_id: &str,
) -> Result<PathBuf, ConfigError> {
    validate_id(saved_result_id)?;
    safe_join(
        &get_connection_saved_results_dir(project_root, connection_id)?,
        &format!("{saved_result_id}.meta.json"),
    )
}

fn get_saved_result_csv_path(
    project_root: &Path,
    connection_id: &str,
    saved_result_id: &str,
) -> Result<PathBuf, ConfigError> {
    validate_id(saved_result_id)?;
    safe_join(
        &get_connection_saved_results_dir(project_root, connection_id)?,
        &format!("{saved_result_id}.csv"),
    )
}

fn get_saved_result_data_path(
    project_root: &Path,
    connection_id: &str,
    saved_result_id: &str,
) -> Result<PathBuf, ConfigError> {
    validate_id(saved_result_id)?;
    safe_join(
        &get_connection_saved_results_dir(project_root, connection_id)?,
        &format!("{saved_result_id}.data.json"),
    )
}

fn load_metadata(
    project_root: &Path,
    connection_id: &str,
    saved_result_id: &str,
) -> Result<SavedResultMetadata, ConfigError> {
    let path = get_saved_result_meta_path(project_root, connection_id, saved_result_id)?;
    let content = fs::read_to_string(path)?;
    let metadata = serde_json::from_str(&content)?;
    Ok(metadata)
}

fn save_metadata(project_root: &Path, metadata: &SavedResultMetadata) -> Result<(), ConfigError> {
    let path = get_saved_result_meta_path(project_root, &metadata.connection_id, &metadata.id)?;
    let content = serde_json::to_string_pretty(metadata)?;
    fs::write(path, content)?;
    Ok(())
}

fn to_csv_cell(value: &JsonValue) -> String {
    match value {
        JsonValue::Null => String::new(),
        JsonValue::String(v) => v.clone(),
        other => other.to_string(),
    }
}

fn write_result_data(
    project_root: &Path,
    connection_id: &str,
    saved_result_id: &str,
    result: &QueryResult,
) -> Result<(), ConfigError> {
    let data_path = get_saved_result_data_path(project_root, connection_id, saved_result_id)?;
    let content = serde_json::to_string(result)?;
    fs::write(data_path, content)?;

    let csv_path = get_saved_result_csv_path(project_root, connection_id, saved_result_id)?;
    let mut writer =
        csv::Writer::from_path(csv_path).map_err(|e| std::io::Error::other(e.to_string()))?;
    let headers: Vec<String> = result.columns.iter().map(|c| c.name.clone()).collect();
    writer
        .write_record(headers)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    for row in &result.rows {
        let values: Vec<String> = row.iter().map(to_csv_cell).collect();
        writer
            .write_record(values)
            .map_err(|e| std::io::Error::other(e.to_string()))?;
    }
    writer
        .flush()
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    Ok(())
}

fn read_result_data(
    project_root: &Path,
    connection_id: &str,
    saved_result_id: &str,
    execution_time_ms: i64,
) -> Result<QueryResult, ConfigError> {
    let data_path = get_saved_result_data_path(project_root, connection_id, saved_result_id)?;
    if data_path.exists() {
        let content = fs::read_to_string(data_path)?;
        let result = serde_json::from_str(&content)?;
        return Ok(result);
    }

    let csv_path = get_saved_result_csv_path(project_root, connection_id, saved_result_id)?;
    let mut reader =
        csv::Reader::from_path(csv_path).map_err(|e| std::io::Error::other(e.to_string()))?;
    let headers = reader
        .headers()
        .map_err(|e| std::io::Error::other(e.to_string()))?
        .clone();
    let columns: Vec<ColumnDef> = headers
        .iter()
        .map(|name| ColumnDef {
            name: name.to_string(),
            type_name: "text".to_string(),
            is_primary_key: None,
            is_indexed: None,
        })
        .collect();

    let mut rows: Vec<Vec<JsonValue>> = Vec::new();
    for row in reader.records() {
        let record = row.map_err(|e| std::io::Error::other(e.to_string()))?;
        rows.push(
            record
                .iter()
                .map(|field| JsonValue::String(field.to_string()))
                .collect(),
        );
    }

    Ok(QueryResult {
        columns,
        row_count: rows.len(),
        max_rows: rows.len(),
        rows,
        execution_time_ms: execution_time_ms.max(0) as u64,
        truncated: false,
    })
}

pub fn list_saved_results(
    project_root: &str,
    connection_id: &str,
) -> Result<Vec<SavedResultMetadata>, ConfigError> {
    let project_root = get_project_root(project_root)?;
    validate_id(connection_id)?;
    let dir = get_connection_saved_results_dir(&project_root, connection_id)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut results = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if !name.ends_with(".meta.json") {
                continue;
            }
            let content = fs::read_to_string(path)?;
            if let Ok(meta) = serde_json::from_str::<SavedResultMetadata>(&content) {
                results.push(meta);
            }
        }
    }

    results.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(results)
}

pub fn save_saved_result(
    project_root: &str,
    connection_id: &str,
    request: &SaveSavedResultRequest,
) -> Result<SavedResult, ConfigError> {
    let project_root = get_project_root(project_root)?;
    validate_id(connection_id)?;
    let now = Utc::now().timestamp_millis();
    let id = request
        .id
        .clone()
        .unwrap_or_else(|| format!("result-{now}"));

    let existing = load_metadata(&project_root, connection_id, &id).ok();
    let created_at = existing.as_ref().map(|m| m.created_at).unwrap_or(now);
    let default_name = Utc::now().format("Result %Y-%m-%d %H:%M:%S").to_string();
    let name = request
        .name
        .clone()
        .or_else(|| existing.as_ref().map(|m| m.name.clone()))
        .unwrap_or(default_name);

    let metadata = SavedResultMetadata {
        id: id.clone(),
        name,
        connection_id: connection_id.to_string(),
        sql: request.sql.clone(),
        preview_source: request.preview_source.clone(),
        row_count: request.query_result.row_count as i64,
        execution_time_ms: request.query_result.execution_time_ms as i64,
        created_at,
        updated_at: now,
    };

    write_result_data(&project_root, connection_id, &id, &request.query_result)?;
    save_metadata(&project_root, &metadata)?;

    Ok(SavedResult {
        metadata,
        query_result: request.query_result.clone(),
    })
}

pub fn get_saved_result(
    project_root: &str,
    connection_id: &str,
    saved_result_id: &str,
) -> Result<SavedResult, ConfigError> {
    let project_root = get_project_root(project_root)?;
    validate_id(connection_id)?;
    validate_id(saved_result_id)?;
    let metadata = load_metadata(&project_root, connection_id, saved_result_id)?;
    let query_result = read_result_data(
        &project_root,
        connection_id,
        saved_result_id,
        metadata.execution_time_ms,
    )?;
    Ok(SavedResult {
        metadata,
        query_result,
    })
}

pub fn delete_saved_result(
    project_root: &str,
    connection_id: &str,
    saved_result_id: &str,
) -> Result<(), ConfigError> {
    let project_root = get_project_root(project_root)?;
    validate_id(connection_id)?;
    validate_id(saved_result_id)?;
    let meta_path = get_saved_result_meta_path(&project_root, connection_id, saved_result_id)?;
    let csv_path = get_saved_result_csv_path(&project_root, connection_id, saved_result_id)?;
    let data_path = get_saved_result_data_path(&project_root, connection_id, saved_result_id)?;
    fs::remove_file(meta_path).ok();
    fs::remove_file(csv_path).ok();
    fs::remove_file(data_path).ok();
    Ok(())
}

pub fn rename_saved_result(
    project_root: &str,
    connection_id: &str,
    saved_result_id: &str,
    new_name: &str,
) -> Result<SavedResultMetadata, ConfigError> {
    let project_root = get_project_root(project_root)?;
    validate_id(connection_id)?;
    validate_id(saved_result_id)?;
    let mut metadata = load_metadata(&project_root, connection_id, saved_result_id)?;
    metadata.name = new_name.to_string();
    metadata.updated_at = Utc::now().timestamp_millis();
    save_metadata(&project_root, &metadata)?;
    Ok(metadata)
}

pub fn delete_connection_saved_results(
    project_root: &str,
    connection_id: &str,
) -> Result<(), ConfigError> {
    let project_root = get_project_root(project_root)?;
    validate_id(connection_id)?;
    let dir = get_connection_saved_results_dir(&project_root, connection_id)?;
    if dir.exists() {
        fs::remove_dir_all(dir)?;
    }
    Ok(())
}
