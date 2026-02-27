use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::fs;
use std::path::PathBuf;

use crate::db::{ColumnDef, QueryResult};

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

fn get_saved_results_base_dir() -> PathBuf {
    let config_dir = super::config::get_join_config_dir().join("saved-results");
    fs::create_dir_all(&config_dir).ok();
    config_dir
}

fn get_connection_saved_results_dir(connection_id: &str) -> PathBuf {
    let dir = get_saved_results_base_dir().join(connection_id);
    fs::create_dir_all(&dir).ok();
    dir
}

fn get_saved_result_meta_path(connection_id: &str, saved_result_id: &str) -> PathBuf {
    get_connection_saved_results_dir(connection_id).join(format!("{saved_result_id}.meta.json"))
}

fn get_saved_result_csv_path(connection_id: &str, saved_result_id: &str) -> PathBuf {
    get_connection_saved_results_dir(connection_id).join(format!("{saved_result_id}.csv"))
}

fn get_saved_result_data_path(connection_id: &str, saved_result_id: &str) -> PathBuf {
    get_connection_saved_results_dir(connection_id).join(format!("{saved_result_id}.data.json"))
}

fn load_metadata(connection_id: &str, saved_result_id: &str) -> Result<SavedResultMetadata, ConfigError> {
    let path = get_saved_result_meta_path(connection_id, saved_result_id);
    let content = fs::read_to_string(path)?;
    let metadata: SavedResultMetadata = serde_json::from_str(&content)?;
    Ok(metadata)
}

fn save_metadata(metadata: &SavedResultMetadata) -> Result<(), ConfigError> {
    let path = get_saved_result_meta_path(&metadata.connection_id, &metadata.id);
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

fn write_result_data(connection_id: &str, saved_result_id: &str, result: &QueryResult) -> Result<(), ConfigError> {
    // Write JSON file preserving full type information (column types and value types).
    let data_path = get_saved_result_data_path(connection_id, saved_result_id);
    let content = serde_json::to_string(result)?;
    fs::write(data_path, content)?;

    // Also write CSV as a human-readable export fallback.
    let csv_path = get_saved_result_csv_path(connection_id, saved_result_id);
    let mut writer = csv::Writer::from_path(csv_path)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
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
    writer.flush().map_err(|e| std::io::Error::other(e.to_string()))?;
    Ok(())
}

fn read_result_data(connection_id: &str, saved_result_id: &str, execution_time_ms: i64) -> Result<QueryResult, ConfigError> {
    // Prefer the JSON file which preserves column types and value types.
    let data_path = get_saved_result_data_path(connection_id, saved_result_id);
    if data_path.exists() {
        let content = fs::read_to_string(data_path)?;
        let result: QueryResult = serde_json::from_str(&content)?;
        return Ok(result);
    }

    // Fall back to CSV for results saved before the JSON format was introduced.
    let csv_path = get_saved_result_csv_path(connection_id, saved_result_id);
    let mut reader = csv::Reader::from_path(csv_path)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
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
        let parsed = record
            .iter()
            .map(|field| JsonValue::String(field.to_string()))
            .collect();
        rows.push(parsed);
    }

    Ok(QueryResult {
        columns,
        row_count: rows.len(),
        rows,
        execution_time_ms: execution_time_ms.max(0) as u64,
    })
}

pub fn list_saved_results(connection_id: &str) -> Result<Vec<SavedResultMetadata>, ConfigError> {
    let dir = get_connection_saved_results_dir(connection_id);
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

pub fn save_saved_result(connection_id: &str, request: &SaveSavedResultRequest) -> Result<SavedResult, ConfigError> {
    let now = Utc::now().timestamp_millis();
    let id = request
        .id
        .clone()
        .unwrap_or_else(|| format!("result-{}", now));

    let existing = load_metadata(connection_id, &id).ok();
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

    write_result_data(connection_id, &id, &request.query_result)?;
    save_metadata(&metadata)?;

    Ok(SavedResult {
        metadata,
        query_result: request.query_result.clone(),
    })
}

pub fn get_saved_result(connection_id: &str, saved_result_id: &str) -> Result<SavedResult, ConfigError> {
    let metadata = load_metadata(connection_id, saved_result_id)?;
    let query_result = read_result_data(connection_id, saved_result_id, metadata.execution_time_ms)?;
    Ok(SavedResult { metadata, query_result })
}

pub fn delete_saved_result(connection_id: &str, saved_result_id: &str) -> Result<(), ConfigError> {
    let meta_path = get_saved_result_meta_path(connection_id, saved_result_id);
    let csv_path = get_saved_result_csv_path(connection_id, saved_result_id);
    let data_path = get_saved_result_data_path(connection_id, saved_result_id);
    fs::remove_file(meta_path).ok();
    fs::remove_file(csv_path).ok();
    fs::remove_file(data_path).ok();
    Ok(())
}

pub fn rename_saved_result(
    connection_id: &str,
    saved_result_id: &str,
    new_name: &str,
) -> Result<SavedResultMetadata, ConfigError> {
    let mut metadata = load_metadata(connection_id, saved_result_id)?;
    metadata.name = new_name.to_string();
    metadata.updated_at = Utc::now().timestamp_millis();
    save_metadata(&metadata)?;
    Ok(metadata)
}

pub fn delete_connection_saved_results(connection_id: &str) -> Result<(), ConfigError> {
    let dir = get_connection_saved_results_dir(connection_id);
    if dir.exists() {
        fs::remove_dir_all(dir)?;
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
        let dir = std::env::temp_dir().join(format!("join-saved-results-tests-{nanos}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        unsafe {
            std::env::set_var("JOIN_CONFIG_DIR", &dir);
        }
        dir
    }

    fn sample_query_result() -> QueryResult {
        QueryResult {
            columns: vec![
                ColumnDef {
                    name: "id".into(),
                    type_name: "int4".into(),
                    is_primary_key: Some(true),
                    is_indexed: Some(true),
                },
                ColumnDef {
                    name: "note".into(),
                    type_name: "text".into(),
                    is_primary_key: None,
                    is_indexed: None,
                },
                ColumnDef {
                    name: "tags".into(),
                    type_name: "_text".into(),
                    is_primary_key: None,
                    is_indexed: None,
                },
            ],
            rows: vec![
                vec![
                    JsonValue::from(1),
                    JsonValue::from("hello,world"),
                    JsonValue::Array(vec![JsonValue::from("a"), JsonValue::from("b")]),
                ],
                vec![
                    JsonValue::from(2),
                    JsonValue::from("line\nbreak"),
                    JsonValue::Array(vec![JsonValue::from("x")]),
                ],
            ],
            row_count: 2,
            execution_time_ms: 12,
        }
    }

    #[test]
    fn saved_result_roundtrip_and_rename_delete() {
        let _lock = crate::storage::config::test_env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _guard = setup_temp_config();
        let request = SaveSavedResultRequest {
            id: None,
            name: Some("Weekly Report".into()),
            sql: "SELECT * FROM reports".into(),
            preview_source: Some("public.reports".into()),
            query_result: sample_query_result(),
        };

        let saved = save_saved_result("conn-1", &request).expect("save");
        assert_eq!(saved.metadata.row_count, 2);

        let loaded = get_saved_result("conn-1", &saved.metadata.id).expect("load");
        assert_eq!(loaded.query_result.row_count, 2);
        assert_eq!(loaded.query_result.rows.len(), 2);

        // Column type metadata must be preserved.
        assert_eq!(loaded.query_result.columns[0].type_name, "int4");
        assert_eq!(loaded.query_result.columns[2].type_name, "_text");

        // Array values must be preserved as arrays, not flattened to strings.
        assert!(loaded.query_result.rows[0][2].is_array(), "array value should round-trip as array");
        assert_eq!(loaded.query_result.rows[0][2], JsonValue::Array(vec![JsonValue::from("a"), JsonValue::from("b")]));

        let renamed = rename_saved_result("conn-1", &saved.metadata.id, "Renamed").expect("rename");
        assert_eq!(renamed.name, "Renamed");

        delete_saved_result("conn-1", &saved.metadata.id).expect("delete");
        assert!(get_saved_result("conn-1", &saved.metadata.id).is_err());
    }
}
