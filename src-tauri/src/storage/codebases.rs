use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

use super::path_safety::validate_id;
use super::project::get_project_root;
use super::{scripts, ConfigError};
use crate::codex_app_server::{
    CodexExtractedQuery, CodexQueryLookupCandidate, CodexSqlExtraction, CodexSqlQueryLookup,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedCodebaseParameter {
    pub name: String,
    #[serde(default)]
    pub source_expression: Option<String>,
    #[serde(default)]
    pub original_placeholder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedCodebaseQuery {
    pub id: String,
    pub name: String,
    pub sql: String,
    pub parameterized_sql: String,
    pub source_path: String,
    #[serde(default)]
    pub start_line: Option<i64>,
    #[serde(default)]
    pub end_line: Option<i64>,
    #[serde(default)]
    pub framework: Option<String>,
    pub confidence: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub detected_parameters: Vec<DetectedCodebaseParameter>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodebaseConnection {
    pub id: String,
    pub name: String,
    pub root_path: String,
    #[serde(default)]
    pub codex_thread_id: Option<String>,
    #[serde(default)]
    pub queries: Vec<ExtractedCodebaseQuery>,
    #[serde(default)]
    pub is_expanded: bool,
    #[serde(default)]
    pub last_indexed_at: Option<i64>,
    #[serde(default)]
    pub last_error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodebaseQueryLookupCandidate {
    pub name: String,
    pub source_path: String,
    pub confidence: String,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodebaseQueryLookupResult {
    pub status: String,
    #[serde(default)]
    pub query: Option<ExtractedCodebaseQuery>,
    #[serde(default)]
    pub matches: Vec<CodebaseQueryLookupCandidate>,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodebasesState {
    #[serde(default)]
    pub codebases: Vec<CodebaseConnection>,
}

fn codebases_dir(project_root: &Path) -> PathBuf {
    let dir = project_root.join("codebases");
    fs::create_dir_all(&dir).ok();
    dir
}

fn codebases_path(project_root: &Path) -> PathBuf {
    codebases_dir(project_root).join("codebases.json")
}

fn folder_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("Local Folder")
        .to_string()
}

pub fn validate_local_folder(root_path: &str) -> Result<PathBuf, ConfigError> {
    let path = PathBuf::from(root_path);
    let canonical = fs::canonicalize(&path).map_err(|_| {
        ConfigError::ValidationError("folder does not exist or cannot be accessed".to_string())
    })?;
    if !canonical.is_dir() {
        return Err(ConfigError::ValidationError(
            "selected path is not a folder".to_string(),
        ));
    }
    Ok(canonical)
}

pub fn load_codebases(project_root: &str) -> Result<Vec<CodebaseConnection>, ConfigError> {
    let project_root = get_project_root(project_root)?;
    let path = codebases_path(&project_root);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path)?;
    let state: CodebasesState = serde_json::from_str(&content)?;
    Ok(state.codebases)
}

fn save_codebases(
    project_root: &Path,
    codebases: Vec<CodebaseConnection>,
) -> Result<(), ConfigError> {
    let path = codebases_path(project_root);
    let content = serde_json::to_string_pretty(&CodebasesState { codebases })?;
    fs::write(path, content)?;
    Ok(())
}

pub fn connect_codebase(
    project_root: &str,
    root_path: &str,
) -> Result<CodebaseConnection, ConfigError> {
    let project_root = get_project_root(project_root)?;
    let canonical = validate_local_folder(root_path)?;
    let canonical_str = canonical.to_string_lossy().to_string();
    let mut codebases = load_codebases(project_root.to_string_lossy().as_ref())?;
    let now = chrono::Utc::now().timestamp_millis();

    if let Some(index) = codebases.iter().position(|c| c.root_path == canonical_str) {
        codebases[index].updated_at = now;
        let updated = codebases[index].clone();
        save_codebases(&project_root, codebases)?;
        return Ok(updated);
    }

    let codebase = CodebaseConnection {
        id: format!("codebase-{}", Uuid::new_v4()),
        name: folder_name(&canonical),
        root_path: canonical_str,
        codex_thread_id: None,
        queries: Vec::new(),
        is_expanded: true,
        last_indexed_at: None,
        last_error: None,
        created_at: now,
        updated_at: now,
    };

    codebases.clear();
    codebases.push(codebase.clone());
    save_codebases(&project_root, codebases)?;
    Ok(codebase)
}

fn normalize_confidence(confidence: &str) -> String {
    match confidence.to_ascii_lowercase().as_str() {
        "high" | "medium" | "low" => confidence.to_ascii_lowercase(),
        _ => "medium".to_string(),
    }
}

fn convert_query(query: CodexExtractedQuery) -> ExtractedCodebaseQuery {
    ExtractedCodebaseQuery {
        id: format!("query-{}", Uuid::new_v4()),
        name: query.name,
        sql: query.sql,
        parameterized_sql: query.parameterized_sql,
        source_path: query.source_path,
        start_line: query.start_line,
        end_line: query.end_line,
        framework: query.framework,
        confidence: normalize_confidence(&query.confidence),
        notes: query.notes,
        detected_parameters: query
            .detected_parameters
            .into_iter()
            .map(|param| DetectedCodebaseParameter {
                name: param.name,
                source_expression: param.source_expression,
                original_placeholder: param.original_placeholder,
            })
            .collect(),
    }
}

pub fn apply_bulk_extraction(
    project_root: &str,
    codebase_id: &str,
    thread_id: Option<String>,
    extraction: CodexSqlExtraction,
) -> Result<CodebaseConnection, ConfigError> {
    validate_id(codebase_id)?;
    let project_root = get_project_root(project_root)?;
    let mut codebases = load_codebases(project_root.to_string_lossy().as_ref())?;
    let now = chrono::Utc::now().timestamp_millis();
    let Some(index) = codebases.iter().position(|c| c.id == codebase_id) else {
        return Err(ConfigError::NotFound);
    };

    codebases[index].codex_thread_id =
        thread_id.or_else(|| codebases[index].codex_thread_id.clone());
    codebases[index].queries = extraction.queries.into_iter().map(convert_query).collect();
    codebases[index].last_indexed_at = Some(now);
    codebases[index].last_error = None;
    codebases[index].updated_at = now;
    let updated = codebases[index].clone();
    save_codebases(&project_root, codebases)?;
    Ok(updated)
}

fn convert_query_lookup_candidate(
    candidate: CodexQueryLookupCandidate,
) -> CodebaseQueryLookupCandidate {
    CodebaseQueryLookupCandidate {
        name: candidate.name,
        source_path: candidate.source_path,
        confidence: normalize_confidence(&candidate.confidence),
        notes: candidate.notes,
    }
}

pub fn apply_query_lookup(
    project_root: &str,
    codebase_id: &str,
    thread_id: Option<String>,
    lookup: CodexSqlQueryLookup,
) -> Result<CodebaseQueryLookupResult, ConfigError> {
    validate_id(codebase_id)?;
    let project_root = get_project_root(project_root)?;
    let mut codebases = load_codebases(project_root.to_string_lossy().as_ref())?;
    let now = chrono::Utc::now().timestamp_millis();
    let Some(index) = codebases.iter().position(|c| c.id == codebase_id) else {
        return Err(ConfigError::NotFound);
    };

    codebases[index].codex_thread_id =
        thread_id.or_else(|| codebases[index].codex_thread_id.clone());
    codebases[index].last_error = None;
    codebases[index].updated_at = now;
    save_codebases(&project_root, codebases)?;

    Ok(CodebaseQueryLookupResult {
        status: lookup.status,
        query: lookup.query.map(convert_query),
        matches: lookup
            .matches
            .into_iter()
            .map(convert_query_lookup_candidate)
            .collect(),
        message: lookup.message,
    })
}

pub fn mark_index_error(
    project_root: &str,
    codebase_id: &str,
    error: String,
) -> Result<CodebaseConnection, ConfigError> {
    validate_id(codebase_id)?;
    let project_root = get_project_root(project_root)?;
    let mut codebases = load_codebases(project_root.to_string_lossy().as_ref())?;
    let now = chrono::Utc::now().timestamp_millis();
    let Some(index) = codebases.iter().position(|c| c.id == codebase_id) else {
        return Err(ConfigError::NotFound);
    };
    codebases[index].last_error = Some(error);
    codebases[index].updated_at = now;
    let updated = codebases[index].clone();
    save_codebases(&project_root, codebases)?;
    Ok(updated)
}

pub fn get_codebase(project_root: &str, codebase_id: &str) -> Result<CodebaseConnection, ConfigError> {
    validate_id(codebase_id)?;
    load_codebases(project_root)?
        .into_iter()
        .find(|codebase| codebase.id == codebase_id)
        .ok_or(ConfigError::NotFound)
}

pub fn set_codebase_expanded(
    project_root: &str,
    codebase_id: &str,
    is_expanded: bool,
) -> Result<CodebaseConnection, ConfigError> {
    validate_id(codebase_id)?;
    let project_root = get_project_root(project_root)?;
    let mut codebases = load_codebases(project_root.to_string_lossy().as_ref())?;
    let Some(index) = codebases.iter().position(|c| c.id == codebase_id) else {
        return Err(ConfigError::NotFound);
    };
    codebases[index].is_expanded = is_expanded;
    let updated = codebases[index].clone();
    save_codebases(&project_root, codebases)?;
    Ok(updated)
}

pub fn disconnect_codebase(project_root: &str, codebase_id: &str) -> Result<(), ConfigError> {
    validate_id(codebase_id)?;
    let project_root = get_project_root(project_root)?;
    let mut codebases = load_codebases(project_root.to_string_lossy().as_ref())?;
    codebases.retain(|codebase| codebase.id != codebase_id);
    save_codebases(&project_root, codebases)
}

fn query_header(query: &ExtractedCodebaseQuery) -> String {
    let mut lines = vec![
        format!("-- Query: {}", query.name.replace('\n', " ")),
        format!("-- Source: {}", query.source_path.replace('\n', " ")),
    ];
    if let Some(start_line) = query.start_line {
        lines.push(format!("-- Line: {start_line}"));
    }
    if query.confidence != "high" {
        lines.push(format!("-- Confidence: {}", query.confidence));
    }
    if let Some(notes) = &query.notes {
        if !notes.trim().is_empty() {
            lines.push(format!("-- Notes: {}", notes.replace('\n', " ")));
        }
    }
    lines.join("\n")
}

pub fn open_codebase_queries_as_sheet(
    project_root: &str,
    codebase_id: &str,
    query_ids: &[String],
    connection_id: &str,
) -> Result<scripts::Script, ConfigError> {
    validate_id(codebase_id)?;
    validate_id(connection_id)?;
    for query_id in query_ids {
        validate_id(query_id)?;
    }

    let codebases = load_codebases(project_root)?;
    let codebase = codebases
        .iter()
        .find(|c| c.id == codebase_id)
        .ok_or(ConfigError::NotFound)?;
    let selected_ids: std::collections::HashSet<&str> =
        query_ids.iter().map(String::as_str).collect();
    let selected: Vec<&ExtractedCodebaseQuery> = codebase
        .queries
        .iter()
        .filter(|query| selected_ids.contains(query.id.as_str()))
        .collect();

    if selected.is_empty() {
        return Err(ConfigError::ValidationError(
            "no extracted queries were selected".to_string(),
        ));
    }

    let cells: Vec<scripts::SqlSheetCell> = selected
        .iter()
        .map(|query| {
            let sql = format!(
                "{}\n{}",
                query_header(query),
                query.parameterized_sql.trim()
            );
            scripts::create_sheet_cell(sql)
        })
        .collect();
    let selected_cell_id = cells.first().map(|cell| cell.id.clone());
    let sheet = scripts::SqlSheetDocument {
        version: scripts::SHEET_FORMAT_VERSION,
        selected_cell_id,
        cells,
    };
    let name = format!("Folder Queries - {}", codebase.name);
    scripts::create_script_with_sheet(project_root, connection_id, &name, &sheet)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::project;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_project_root() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("join-codebase-tests-{nanos}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        let project =
            project::create_project(dir.to_str().expect("path"), "Demo").expect("project");
        PathBuf::from(project.root_path)
    }

    #[test]
    fn accepts_existing_non_git_directory() {
        let root = temp_project_root();
        let folder = root.join("plain-folder");
        fs::create_dir_all(&folder).expect("folder");
        let codebase = connect_codebase(
            root.to_str().expect("root"),
            folder.to_str().expect("folder"),
        )
        .expect("connect");
        assert_eq!(codebase.name, "plain-folder");
        assert!(codebase.queries.is_empty());
        assert!(codebase.last_indexed_at.is_none());
    }

    #[test]
    fn rejects_missing_directory() {
        let root = temp_project_root();
        let missing = root.join("missing");
        assert!(connect_codebase(
            root.to_str().expect("root"),
            missing.to_str().expect("missing")
        )
        .is_err());
    }

    #[test]
    fn query_lookup_updates_thread_without_persisting_bulk_queries() {
        let root = temp_project_root();
        let folder = root.join("lookup-folder");
        fs::create_dir_all(&folder).expect("folder");
        let codebase = connect_codebase(
            root.to_str().expect("root"),
            folder.to_str().expect("folder"),
        )
        .expect("connect");

        let lookup = apply_query_lookup(
            root.to_str().expect("root"),
            &codebase.id,
            Some("thread-123".to_string()),
            CodexSqlQueryLookup {
                status: "match".to_string(),
                query: Some(CodexExtractedQuery {
                    name: "signup".to_string(),
                    sql: "select * from users".to_string(),
                    parameterized_sql: "select * from users".to_string(),
                    source_path: "queries/signup.sql".to_string(),
                    start_line: Some(1),
                    end_line: Some(3),
                    framework: None,
                    confidence: "high".to_string(),
                    notes: None,
                    detected_parameters: vec![],
                }),
                matches: vec![],
                message: None,
            },
        )
        .expect("lookup");

        let persisted = get_codebase(root.to_str().expect("root"), &codebase.id).expect("codebase");
        assert_eq!(lookup.status, "match");
        assert!(lookup.query.is_some());
        assert_eq!(persisted.codex_thread_id.as_deref(), Some("thread-123"));
        assert!(persisted.queries.is_empty());
    }
}
