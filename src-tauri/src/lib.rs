pub mod codex_app_server;
pub mod db;
pub mod storage;

use db::{ConnectionConfig, DatabaseType, QueryResult};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Write;
use tauri::{AppHandle, Emitter};

// ============================================================================
// Types for frontend communication
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionInfo {
    pub id: String,
    pub name: String,
    pub db_type: DatabaseType,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub database: String,
    pub username: Option<String>,
    pub ssl_mode: Option<String>,
    pub is_connected: bool,
}

impl ConnectionInfo {
    async fn from_config(config: ConnectionConfig) -> Self {
        let is_connected = db::is_connected(&config.id).await;
        Self {
            id: config.id,
            name: config.name,
            db_type: config.db_type,
            host: config.host,
            port: config.port,
            database: config.database,
            username: config.username,
            ssl_mode: config.ssl_mode,
            is_connected,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewConnectionRequest {
    pub name: String,
    pub db_type: DatabaseType,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub database: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub ssl_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodebaseProgressEvent {
    codebase_id: String,
    phase: String,
    text: String,
    append: bool,
}

fn emit_codebase_progress(
    app: &AppHandle,
    codebase_id: &str,
    phase: &str,
    text: &str,
    append: bool,
) {
    let _ = app.emit(
        "codebase-progress",
        CodebaseProgressEvent {
            codebase_id: codebase_id.to_string(),
            phase: phase.to_string(),
            text: text.to_string(),
            append,
        },
    );
}

// ============================================================================
// Tauri Commands - Projects
// ============================================================================

#[tauri::command]
fn create_project(parent_dir: String, name: String) -> Result<storage::ProjectInfo, String> {
    let project =
        storage::project::create_project(&parent_dir, &name).map_err(|e| e.to_string())?;
    storage::preferences::remember_project(&project).map_err(|e| e.to_string())?;
    Ok(project)
}

#[tauri::command]
fn open_project(root_path: String) -> Result<storage::ProjectInfo, String> {
    let project = storage::project::open_project(&root_path).map_err(|e| e.to_string())?;
    storage::preferences::remember_project(&project).map_err(|e| e.to_string())?;
    Ok(project)
}

#[tauri::command]
fn list_recent_projects() -> Result<Vec<storage::ProjectInfo>, String> {
    storage::preferences::list_recent_projects().map_err(|e| e.to_string())
}

// ============================================================================
// Tauri Commands - Codebases
// ============================================================================

#[tauri::command]
fn list_codebases(project_root: String) -> Result<Vec<storage::CodebaseConnection>, String> {
    storage::codebases::load_codebases(&project_root).map_err(|e| e.to_string())
}

#[tauri::command]
async fn connect_codebase(
    project_root: String,
    root_path: String,
) -> Result<storage::CodebaseConnection, String> {
    storage::codebases::connect_codebase(&project_root, &root_path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn fetch_codebase_query(
    app: AppHandle,
    project_root: String,
    codebase_id: String,
    prompt: String,
) -> Result<storage::CodebaseQueryLookupResult, String> {
    let codebase =
        storage::codebases::get_codebase(&project_root, &codebase_id).map_err(|e| e.to_string())?;

    match codex_app_server::find_sql_query_with_request(
        &codebase.root_path,
        None,
        &prompt,
        |update| {
            emit_codebase_progress(
                &app,
                &codebase_id,
                &update.phase,
                &update.text,
                update.append,
            );
        },
    )
    .await
    {
        Ok((_thread_id, lookup)) => {
            storage::codebases::apply_query_lookup(&project_root, &codebase.id, None, lookup)
                .map_err(|e| e.to_string())
        }
        Err(error) => {
            emit_codebase_progress(&app, &codebase_id, "error", &error.to_string(), false);
            eprintln!(
                "[CODEBASE] fetch_codebase_query failed project_root={project_root:?}, codebase_id={:?}, root_path={:?}, codex_thread_id={:?}: {error:?}",
                codebase.id, codebase.root_path, codebase.codex_thread_id
            );
            let _ = storage::codebases::mark_index_error(
                &project_root,
                &codebase.id,
                error.to_string(),
            );
            Err(error.to_string())
        }
    }
}

#[tauri::command]
async fn ask_codebase_context(
    app: AppHandle,
    project_root: String,
    codebase_id: String,
    prompt: String,
) -> Result<storage::CodebaseContextResult, String> {
    let codebase =
        storage::codebases::get_codebase(&project_root, &codebase_id).map_err(|e| e.to_string())?;

    match codex_app_server::ask_codebase_context(&codebase.root_path, None, &prompt, |update| {
        emit_codebase_progress(
            &app,
            &codebase_id,
            &update.phase,
            &update.text,
            update.append,
        );
    })
    .await
    {
        Ok((_thread_id, context)) => {
            storage::codebases::apply_codebase_context(&project_root, &codebase.id, None, context)
                .map_err(|e| e.to_string())
        }
        Err(error) => {
            emit_codebase_progress(&app, &codebase_id, "error", &error.to_string(), false);
            eprintln!(
                "[CODEBASE] ask_codebase_context failed project_root={project_root:?}, codebase_id={:?}, root_path={:?}, codex_thread_id={:?}: {error:?}",
                codebase.id, codebase.root_path, codebase.codex_thread_id
            );
            let _ = storage::codebases::mark_index_error(
                &project_root,
                &codebase.id,
                error.to_string(),
            );
            Err(error.to_string())
        }
    }
}

#[tauri::command]
fn set_codebase_expanded(
    project_root: String,
    codebase_id: String,
    is_expanded: bool,
) -> Result<storage::CodebaseConnection, String> {
    storage::codebases::set_codebase_expanded(&project_root, &codebase_id, is_expanded)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn disconnect_codebase(project_root: String, codebase_id: String) -> Result<(), String> {
    storage::codebases::disconnect_codebase(&project_root, &codebase_id).map_err(|e| e.to_string())
}

// ============================================================================
// Tauri Commands - Connections
// ============================================================================

#[tauri::command]
async fn list_connections(project_root: String) -> Result<Vec<ConnectionInfo>, String> {
    let configs = storage::list_connections(&project_root).map_err(|e| e.to_string())?;

    let mut connections = Vec::new();
    for config in configs {
        connections.push(ConnectionInfo::from_config(config).await);
    }

    Ok(connections)
}

#[tauri::command]
async fn add_connection(project_root: String, request: NewConnectionRequest) -> Result<ConnectionInfo, String> {
    let config = ConnectionConfig::new(
        request.name,
        request.db_type,
        request.host,
        request.port,
        request.database,
        request.username,
        request.ssl_mode,
    );

    // Store password in keychain if provided
    if let Some(password) = &request.password {
        if !password.is_empty() {
            storage::store_password(&config.id, password).map_err(|e| e.to_string())?;
        }
    }

    // Save connection config
    storage::add_connection(&project_root, config.clone()).map_err(|e| e.to_string())?;

    Ok(ConnectionInfo::from_config(config).await)
}

#[tauri::command]
async fn update_connection(
    project_root: String,
    connection_id: String,
    request: NewConnectionRequest,
) -> Result<ConnectionInfo, String> {
    // Get existing config to preserve the ID
    let mut config = storage::get_connection(&project_root, &connection_id).map_err(|e| e.to_string())?;

    config.name = request.name;
    config.db_type = request.db_type;
    config.host = request.host;
    config.port = request.port;
    config.database = request.database;
    config.username = request.username;
    config.ssl_mode = request.ssl_mode;

    // Update password if provided
    if let Some(password) = &request.password {
        if !password.is_empty() {
            storage::store_password(&config.id, password).map_err(|e| e.to_string())?;
        }
    }

    // Save updated config
    storage::add_connection(&project_root, config.clone()).map_err(|e| e.to_string())?;

    Ok(ConnectionInfo::from_config(config).await)
}

#[tauri::command]
async fn delete_connection(project_root: String, connection_id: String) -> Result<(), String> {
    // Disconnect if connected
    let _ = db::disconnect(&connection_id).await;

    // Delete password from keychain
    let _ = storage::delete_password(&connection_id);

    // Remove any scripts stored for this connection
    let _ = storage::scripts::delete_connection_scripts(&project_root, &connection_id);
    let _ = storage::saved_results::delete_connection_saved_results(&project_root, &connection_id);

    // Remove from config
    storage::remove_connection(&project_root, &connection_id).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn test_connection(request: NewConnectionRequest) -> Result<(), String> {
    let config = ConnectionConfig::new(
        request.name,
        request.db_type,
        request.host,
        request.port,
        request.database,
        request.username,
        request.ssl_mode,
    );

    db::test_connection(&config, request.password.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn connect(project_root: String, connection_id: String) -> Result<(), String> {
    let config = storage::get_connection(&project_root, &connection_id).map_err(|e| e.to_string())?;

    // Get password from keychain
    let password = match storage::get_password(&connection_id) {
        Ok(pwd) => Some(pwd),
        Err(_) => {
            // If password is required but not found, return a helpful error
            if config.username.is_some() && config.db_type != db::DatabaseType::Sqlite {
                return Err(
                    "Password not found. Please edit the connection and re-enter your password."
                        .to_string(),
                );
            }
            None
        }
    };

    db::connect(&config, password.as_deref())
        .await
        .map_err(|e| format!("Connection failed: {}", e))
}

#[tauri::command]
async fn disconnect(connection_id: String) -> Result<(), String> {
    db::disconnect(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn is_connected(connection_id: String) -> bool {
    db::is_connected(&connection_id).await
}

// ============================================================================
// Tauri Commands - Schema
// ============================================================================

#[tauri::command]
async fn get_schemas(connection_id: String) -> Result<Vec<db::SchemaInfo>, String> {
    db::get_schemas(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_tables(
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<db::TableInfo>, String> {
    db::get_tables(&connection_id, schema.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_columns(
    connection_id: String,
    table: String,
    schema: Option<String>,
) -> Result<Vec<db::ColumnInfo>, String> {
    db::get_columns(&connection_id, &table, schema.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_views(
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<db::ViewInfo>, String> {
    db::get_views(&connection_id, schema.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_indexes(
    connection_id: String,
    table: String,
    schema: Option<String>,
) -> Result<Vec<db::IndexInfo>, String> {
    db::get_indexes(&connection_id, &table, schema.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_foreign_keys(
    connection_id: String,
    table: String,
    schema: Option<String>,
) -> Result<Vec<db::ForeignKeyInfo>, String> {
    db::get_foreign_keys(&connection_id, &table, schema.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_functions(
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<db::FunctionInfo>, String> {
    db::get_functions(&connection_id, schema.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_custom_types(
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<db::CustomTypeInfo>, String> {
    db::get_custom_types(&connection_id, schema.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_type_details(
    connection_id: String,
    type_name: String,
    schema: Option<String>,
) -> Result<db::TypeDetailInfo, String> {
    db::get_type_details(&connection_id, &type_name, schema.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_function_details(
    connection_id: String,
    function_name: String,
    schema: Option<String>,
) -> Result<db::FunctionDetailInfo, String> {
    db::get_function_details(&connection_id, &function_name, schema.as_deref())
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// Tauri Commands - Query Execution
// ============================================================================

#[tauri::command]
async fn execute_query(connection_id: String, sql: String) -> Result<QueryResult, String> {
    db::execute_query(&connection_id, &sql)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// Tauri Commands - Saved Results
// ============================================================================

#[tauri::command]
fn list_saved_results(
    project_root: String,
    connection_id: String,
) -> Result<Vec<storage::SavedResultMetadata>, String> {
    storage::saved_results::list_saved_results(&project_root, &connection_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_saved_result(
    project_root: String,
    connection_id: String,
    request: storage::SaveSavedResultRequest,
) -> Result<storage::SavedResult, String> {
    storage::saved_results::save_saved_result(&project_root, &connection_id, &request).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_saved_result(
    project_root: String,
    connection_id: String,
    saved_result_id: String,
) -> Result<storage::SavedResult, String> {
    storage::saved_results::get_saved_result(&project_root, &connection_id, &saved_result_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn refresh_saved_result(
    project_root: String,
    connection_id: String,
    saved_result_id: String,
    sql: String,
    name: Option<String>,
    preview_source: Option<String>,
) -> Result<storage::SavedResult, String> {
    let result = db::execute_query(&connection_id, &sql)
        .await
        .map_err(|e| e.to_string())?;

    let request = storage::SaveSavedResultRequest {
        id: Some(saved_result_id),
        name,
        sql,
        preview_source,
        query_result: result,
    };
    storage::saved_results::save_saved_result(&project_root, &connection_id, &request)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_saved_result(
    project_root: String,
    connection_id: String,
    saved_result_id: String,
) -> Result<(), String> {
    storage::saved_results::delete_saved_result(&project_root, &connection_id, &saved_result_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_saved_result(
    project_root: String,
    connection_id: String,
    saved_result_id: String,
    new_name: String,
) -> Result<storage::SavedResultMetadata, String> {
    storage::saved_results::rename_saved_result(&project_root, &connection_id, &saved_result_id, &new_name)
        .map_err(|e| e.to_string())
}

// ============================================================================
// Tauri Commands - Tabs Persistence (legacy, kept for backwards compat)
// ============================================================================

#[tauri::command]
fn load_tabs(project_root: String) -> Result<storage::TabsState, String> {
    storage::tabs::load_tabs(&project_root).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_tabs(project_root: String, state: storage::TabsState) -> Result<(), String> {
    storage::tabs::save_tabs(&project_root, &state).map_err(|e| e.to_string())
}

// ============================================================================
// Tauri Commands - Scripts
// ============================================================================

#[tauri::command]
fn list_scripts(project_root: String, connection_id: String) -> Result<Vec<storage::ScriptMetadata>, String> {
    storage::scripts::list_scripts(&project_root, &connection_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_script(project_root: String, connection_id: String, name: String) -> Result<storage::Script, String> {
    storage::scripts::create_script(&project_root, &connection_id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_script(project_root: String, connection_id: String, script_id: String) -> Result<storage::Script, String> {
    storage::scripts::get_script(&project_root, &connection_id, &script_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_script_content(
    project_root: String,
    connection_id: String,
    script_id: String,
    sheet: storage::SqlSheetDocument,
) -> Result<(), String> {
    storage::scripts::update_script_content(&project_root, &connection_id, &script_id, &sheet)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn queue_script_update(
    project_root: String,
    connection_id: String,
    script_id: String,
    sheet: storage::SqlSheetDocument,
    revision: i64,
) -> Result<storage::ScriptSaveQueueStatus, String> {
    storage::scripts::queue_script_update(&project_root, &connection_id, &script_id, &sheet, revision)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn flush_script_updates(script_id: String) -> Result<storage::ScriptSaveQueueStatus, String> {
    storage::scripts::flush_script_updates(&script_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_script_update_status(script_id: String) -> Result<storage::ScriptSaveQueueStatus, String> {
    storage::scripts::get_script_update_status(&script_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_script(
    project_root: String,
    connection_id: String,
    script_id: String,
    new_name: String,
) -> Result<storage::ScriptMetadata, String> {
    storage::scripts::rename_script(&project_root, &connection_id, &script_id, &new_name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_script(project_root: String, connection_id: String, script_id: String) -> Result<(), String> {
    storage::scripts::delete_script(&project_root, &connection_id, &script_id).map_err(|e| e.to_string())
}

// ============================================================================
// Tauri Commands - Query History
// ============================================================================

#[tauri::command]
fn load_query_history(project_root: String) -> Result<Vec<storage::QueryHistoryEntry>, String> {
    let history = storage::history::load_history(&project_root).map_err(|e| e.to_string())?;
    Ok(history.entries)
}

#[tauri::command]
fn save_query_history(project_root: String, entries: Vec<storage::QueryHistoryEntry>) -> Result<(), String> {
    let history = storage::QueryHistory { entries };
    storage::history::save_history(&project_root, &history).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_query_history(project_root: String) -> Result<(), String> {
    storage::history::clear_history(&project_root).map_err(|e| e.to_string())
}

// ============================================================================
// Tauri Commands - Export
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportData {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
}

fn escape_csv(value: &serde_json::Value) -> String {
    let s = match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::String(s) => s.clone(),
        v => v.to_string(),
    };
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s
    }
}

#[tauri::command]
async fn export_to_csv(file_path: String, data: ExportData) -> Result<(), String> {
    let mut file = File::create(&file_path).map_err(|e| e.to_string())?;

    // Write headers
    let headers: Vec<String> = data
        .columns
        .iter()
        .map(|c| escape_csv(&serde_json::Value::String(c.clone())))
        .collect();
    writeln!(file, "{}", headers.join(",")).map_err(|e| e.to_string())?;

    // Write rows
    for row in data.rows {
        let escaped: Vec<String> = row.iter().map(escape_csv).collect();
        writeln!(file, "{}", escaped.join(",")).map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ============================================================================
// Tauri Commands - Environment Variables (for AI API keys)
// ============================================================================

const API_KEY_ENV_VARS: &[&str] = &[
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "MOONSHOT_API_KEY",
    "OPEN_ROUTER_API_KEY",
];

#[tauri::command]
fn get_env_var(name: String) -> Result<String, String> {
    if !API_KEY_ENV_VARS.contains(&name.as_str()) {
        return Err(format!(
            "Access to environment variable '{}' is not allowed",
            name
        ));
    }
    std::env::var(&name).map_err(|_| format!("Environment variable '{}' is not set", name))
}

fn looks_like_placeholder_secret(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    normalized.is_empty()
        || normalized == "your_key_here"
        || normalized == "changeme"
        || normalized == "replace_me"
}

fn warn_api_key_configuration() {
    for &key in API_KEY_ENV_VARS {
        match std::env::var(key) {
            Ok(value) if looks_like_placeholder_secret(&value) => {
                println!(
                    "[SECURITY] {} appears to be a placeholder value. Use a real API key via local secret management.",
                    key
                );
            }
            Ok(_) => {}
            Err(_) => {
                println!("[SECURITY] {} is not set.", key);
            }
        }
    }
}

// ============================================================================
// Tauri Commands - Chat Persistence
// ============================================================================

#[tauri::command]
fn list_chat_sessions(project_root: String) -> Result<Vec<storage::chats::ChatSessionMeta>, String> {
    storage::chats::list_chat_sessions(&project_root).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_chat_session(project_root: String, session_id: String) -> Result<storage::chats::ChatSession, String> {
    storage::chats::get_chat_session(&project_root, &session_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_chat_session(project_root: String, session: storage::chats::ChatSession) -> Result<(), String> {
    storage::chats::save_chat_session(&project_root, &session).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_chat_session(project_root: String, session_id: String) -> Result<(), String> {
    storage::chats::delete_chat_session(&project_root, &session_id).map_err(|e| e.to_string())
}

// ============================================================================
// Tauri Commands - AI Preferences
// ============================================================================

#[tauri::command]
fn get_selected_model_id() -> Result<Option<String>, String> {
    storage::preferences::get_selected_model_id().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_selected_model_id(model_id: String) -> Result<(), String> {
    storage::preferences::set_selected_model_id(model_id).map_err(|e| e.to_string())
}

// ============================================================================
// Tauri Commands - Debug
// ============================================================================

#[tauri::command]
fn debug_log(message: String) {
    println!("[DEBUG] {}", message);
}

// ============================================================================
// App Entry Point
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    warn_api_key_configuration();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            create_project,
            open_project,
            list_recent_projects,
            // Codebases
            list_codebases,
            connect_codebase,
            fetch_codebase_query,
            ask_codebase_context,
            set_codebase_expanded,
            disconnect_codebase,
            // Connections
            list_connections,
            add_connection,
            update_connection,
            delete_connection,
            test_connection,
            connect,
            disconnect,
            is_connected,
            // Schema
            get_schemas,
            get_tables,
            get_columns,
            get_views,
            get_indexes,
            get_foreign_keys,
            get_functions,
            get_custom_types,
            get_type_details,
            get_function_details,
            // Query
            execute_query,
            // Tabs (legacy)
            load_tabs,
            save_tabs,
            // Saved Results
            list_saved_results,
            save_saved_result,
            get_saved_result,
            refresh_saved_result,
            delete_saved_result,
            rename_saved_result,
            // Scripts
            list_scripts,
            create_script,
            get_script,
            update_script_content,
            queue_script_update,
            flush_script_updates,
            get_script_update_status,
            rename_script,
            delete_script,
            // Query History
            load_query_history,
            save_query_history,
            clear_query_history,
            // Export
            export_to_csv,
            // Environment Variables
            get_env_var,
            // Chat Persistence
            list_chat_sessions,
            get_chat_session,
            save_chat_session,
            delete_chat_session,
            // AI Preferences
            get_selected_model_id,
            set_selected_model_id,
            // Debug
            debug_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::de::DeserializeOwned;
    use serde_json::{json, Value};
    use std::fmt::Debug;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tauri::webview::InvokeRequest;

    fn setup_temp_config() -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("join-lib-tests-{nanos}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        unsafe {
            std::env::set_var("JOIN_CONFIG_DIR", &dir);
        }
        dir
    }

    fn build_test_app() -> tauri::App<tauri::test::MockRuntime> {
        mock_builder()
            .invoke_handler(tauri::generate_handler![
                add_connection,
                connect,
                disconnect,
                get_schemas,
                get_tables,
                execute_query,
                export_to_csv,
                get_env_var,
                get_chat_session,
            ])
            .build(mock_context(noop_assets()))
            .expect("build app")
    }

    fn invoke_ok<T, W>(webview: &W, cmd: &str, payload: Value) -> T
    where
        T: DeserializeOwned + Debug,
        W: AsRef<tauri::Webview<tauri::test::MockRuntime>>,
    {
        let request = InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost".parse().expect("url"),
            body: InvokeBody::Json(payload),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        };
        let response =
            tauri::test::get_ipc_response(webview, request).expect("invoke should succeed");
        response
            .deserialize::<T>()
            .expect("response should deserialize")
    }

    fn invoke_err<W>(webview: &W, cmd: &str, payload: Value) -> Value
    where
        W: AsRef<tauri::Webview<tauri::test::MockRuntime>>,
    {
        let request = InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost".parse().expect("url"),
            body: InvokeBody::Json(payload),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        };
        tauri::test::get_ipc_response(webview, request).expect_err("invoke should fail")
    }

    #[test]
    fn escape_csv_quotes_commas_and_newlines() {
        assert_eq!(escape_csv(&json!("simple")), "simple");
        assert_eq!(escape_csv(&json!("a,b")), "\"a,b\"");
        assert_eq!(escape_csv(&json!("line\nbreak")), "\"line\nbreak\"");
        assert_eq!(escape_csv(&json!("a\"b")), "\"a\"\"b\"");
    }

    #[test]
    fn get_env_var_enforces_allowlist() {
        unsafe {
            std::env::set_var("OPENAI_API_KEY", "token-123");
        }
        assert_eq!(
            get_env_var("OPENAI_API_KEY".into()).expect("allowed"),
            "token-123"
        );
        let err = get_env_var("PATH".into()).expect_err("path should be blocked");
        assert!(err.contains("not allowed"));
    }

    #[test]
    fn tauri_ipc_sqlite_smoke_flow() {
        let _lock = storage::config::test_env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let temp = setup_temp_config();
        let app = build_test_app();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("webview");
        let project =
            storage::project::create_project(temp.to_str().expect("temp"), "Smoke").expect("project");

        let conn: ConnectionInfo = invoke_ok(
            &webview,
            "add_connection",
            json!({
                "projectRoot": project.root_path,
                "request": {
                    "name": "sqlite-smoke",
                    "db_type": "sqlite",
                    "host": null,
                    "port": null,
                    "database": ":memory:",
                    "username": null,
                    "password": null,
                    "ssl_mode": null
                }
            }),
        );

        let _: () = invoke_ok(
            &webview,
            "connect",
            json!({
                "projectRoot": project.root_path,
                "connectionId": conn.id
            }),
        );

        let _: QueryResult = invoke_ok(
            &webview,
            "execute_query",
            json!({
                "connectionId": conn.id,
                "sql": "CREATE TABLE smoke (id INTEGER PRIMARY KEY, name TEXT);"
            }),
        );
        let _: QueryResult = invoke_ok(
            &webview,
            "execute_query",
            json!({
                "connectionId": conn.id,
                "sql": "INSERT INTO smoke (name) VALUES ('alpha');"
            }),
        );
        let rows: QueryResult = invoke_ok(
            &webview,
            "execute_query",
            json!({
                "connectionId": conn.id,
                "sql": "SELECT id, name FROM smoke ORDER BY id;"
            }),
        );
        assert_eq!(rows.row_count, 1);
        assert_eq!(rows.columns.len(), 2);

        let schemas: Vec<db::SchemaInfo> = invoke_ok(
            &webview,
            "get_schemas",
            json!({
                "connectionId": conn.id
            }),
        );
        assert!(schemas.iter().any(|s| s.name == "main"));

        let tables: Vec<db::TableInfo> = invoke_ok(
            &webview,
            "get_tables",
            json!({
                "connectionId": conn.id,
                "schema": "main"
            }),
        );
        assert!(tables.iter().any(|t| t.name == "smoke"));

        let csv_path = temp.join("smoke.csv");
        let _: () = invoke_ok(
            &webview,
            "export_to_csv",
            json!({
                "filePath": csv_path.to_string_lossy().to_string(),
                "data": {
                    "columns": ["name", "note"],
                    "rows": [["alpha", "hello,world"], ["beta", "line\nbreak"]]
                }
            }),
        );
        let csv = fs::read_to_string(csv_path).expect("csv should exist");
        assert!(csv.contains("\"hello,world\""));
        assert!(csv.contains("\"line\nbreak\""));

        unsafe {
            std::env::set_var("ANTHROPIC_API_KEY", "token-ipc");
        }
        let key: String = invoke_ok(
            &webview,
            "get_env_var",
            json!({
                "name": "ANTHROPIC_API_KEY"
            }),
        );
        assert_eq!(key, "token-ipc");

        let denied = invoke_err(
            &webview,
            "get_env_var",
            json!({
                "name": "PATH"
            }),
        );
        assert!(denied.to_string().contains("not allowed"));
    }

    #[test]
    fn tauri_ipc_rejects_invalid_chat_session_id() {
        let _lock = storage::config::test_env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _temp = setup_temp_config();
        let app = build_test_app();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("webview");
        let project =
            storage::project::create_project(_temp.to_str().expect("temp"), "Chat").expect("project");

        let denied = invoke_err(
            &webview,
            "get_chat_session",
            json!({
                "projectRoot": project.root_path,
                "sessionId": "../escape"
            }),
        );
        assert!(denied.to_string().contains("Validation error"));
    }
}
