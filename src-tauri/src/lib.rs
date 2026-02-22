mod db;
mod storage;

use db::{ConnectionConfig, DatabaseType, QueryResult};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Write;

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

// ============================================================================
// Tauri Commands - Connections
// ============================================================================

#[tauri::command]
async fn list_connections() -> Result<Vec<ConnectionInfo>, String> {
    let configs = storage::list_connections().map_err(|e| e.to_string())?;
    
    let mut connections = Vec::new();
    for config in configs {
        connections.push(ConnectionInfo::from_config(config).await);
    }
    
    Ok(connections)
}

#[tauri::command]
async fn add_connection(request: NewConnectionRequest) -> Result<ConnectionInfo, String> {
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
    storage::add_connection(config.clone()).map_err(|e| e.to_string())?;
    
    Ok(ConnectionInfo::from_config(config).await)
}

#[tauri::command]
async fn update_connection(
    connection_id: String,
    request: NewConnectionRequest,
) -> Result<ConnectionInfo, String> {
    // Get existing config to preserve the ID
    let mut config = storage::get_connection(&connection_id).map_err(|e| e.to_string())?;
    
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
    storage::add_connection(config.clone()).map_err(|e| e.to_string())?;
    
    Ok(ConnectionInfo::from_config(config).await)
}

#[tauri::command]
async fn delete_connection(connection_id: String) -> Result<(), String> {
    // Disconnect if connected
    let _ = db::disconnect(&connection_id).await;
    
    // Delete password from keychain
    let _ = storage::delete_password(&connection_id);
    
    // Remove any scripts stored for this connection
    let _ = storage::scripts::delete_connection_scripts(&connection_id);
    let _ = storage::saved_results::delete_connection_saved_results(&connection_id);
    
    // Remove from config
    storage::remove_connection(&connection_id).map_err(|e| e.to_string())?;
    
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
async fn connect(connection_id: String) -> Result<(), String> {
    let config = storage::get_connection(&connection_id).map_err(|e| e.to_string())?;
    
    // Get password from keychain
    let password = match storage::get_password(&connection_id) {
        Ok(pwd) => Some(pwd),
        Err(_) => {
            // If password is required but not found, return a helpful error
            if config.username.is_some() && config.db_type != db::DatabaseType::Sqlite {
                return Err("Password not found. Please edit the connection and re-enter your password.".to_string());
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
async fn get_tables(connection_id: String, schema: Option<String>) -> Result<Vec<db::TableInfo>, String> {
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
async fn get_views(connection_id: String, schema: Option<String>) -> Result<Vec<db::ViewInfo>, String> {
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
async fn get_functions(connection_id: String, schema: Option<String>) -> Result<Vec<db::FunctionInfo>, String> {
    db::get_functions(&connection_id, schema.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_custom_types(connection_id: String, schema: Option<String>) -> Result<Vec<db::CustomTypeInfo>, String> {
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
fn list_saved_results(connection_id: String) -> Result<Vec<storage::SavedResultMetadata>, String> {
    storage::saved_results::list_saved_results(&connection_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_saved_result(
    connection_id: String,
    request: storage::SaveSavedResultRequest,
) -> Result<storage::SavedResult, String> {
    storage::saved_results::save_saved_result(&connection_id, &request).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_saved_result(connection_id: String, saved_result_id: String) -> Result<storage::SavedResult, String> {
    storage::saved_results::get_saved_result(&connection_id, &saved_result_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn refresh_saved_result(
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
    storage::saved_results::save_saved_result(&connection_id, &request).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_saved_result(connection_id: String, saved_result_id: String) -> Result<(), String> {
    storage::saved_results::delete_saved_result(&connection_id, &saved_result_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_saved_result(
    connection_id: String,
    saved_result_id: String,
    new_name: String,
) -> Result<storage::SavedResultMetadata, String> {
    storage::saved_results::rename_saved_result(&connection_id, &saved_result_id, &new_name)
        .map_err(|e| e.to_string())
}

// ============================================================================
// Tauri Commands - Tabs Persistence (legacy, kept for backwards compat)
// ============================================================================

#[tauri::command]
fn load_tabs() -> Result<storage::TabsState, String> {
    storage::tabs::load_tabs().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_tabs(state: storage::TabsState) -> Result<(), String> {
    storage::tabs::save_tabs(&state).map_err(|e| e.to_string())
}

// ============================================================================
// Tauri Commands - Scripts
// ============================================================================

#[tauri::command]
fn list_scripts(connection_id: String) -> Result<Vec<storage::ScriptMetadata>, String> {
    storage::scripts::list_scripts(&connection_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_script(connection_id: String, name: String) -> Result<storage::Script, String> {
    storage::scripts::create_script(&connection_id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_script(connection_id: String, script_id: String) -> Result<storage::Script, String> {
    storage::scripts::get_script(&connection_id, &script_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_script_content(
    connection_id: String,
    script_id: String,
    sheet: storage::SqlSheetDocument,
) -> Result<(), String> {
    storage::scripts::update_script_content(&connection_id, &script_id, &sheet)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_script(connection_id: String, script_id: String, new_name: String) -> Result<storage::ScriptMetadata, String> {
    storage::scripts::rename_script(&connection_id, &script_id, &new_name).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_script(connection_id: String, script_id: String) -> Result<(), String> {
    storage::scripts::delete_script(&connection_id, &script_id).map_err(|e| e.to_string())
}

// ============================================================================
// Tauri Commands - Query History
// ============================================================================

#[tauri::command]
fn load_query_history() -> Result<Vec<storage::QueryHistoryEntry>, String> {
    let history = storage::history::load_history().map_err(|e| e.to_string())?;
    Ok(history.entries)
}

#[tauri::command]
fn save_query_history(entries: Vec<storage::QueryHistoryEntry>) -> Result<(), String> {
    let history = storage::QueryHistory { entries };
    storage::history::save_history(&history).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_query_history() -> Result<(), String> {
    storage::history::clear_history().map_err(|e| e.to_string())
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
    let headers: Vec<String> = data.columns.iter().map(|c| escape_csv(&serde_json::Value::String(c.clone()))).collect();
    writeln!(file, "{}", headers.join(",")).map_err(|e| e.to_string())?;
    
    // Write rows
    for row in data.rows {
        let escaped: Vec<String> = row.iter().map(|v| escape_csv(v)).collect();
        writeln!(file, "{}", escaped.join(",")).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

// ============================================================================
// Tauri Commands - Environment Variables (for AI API keys)
// ============================================================================

#[tauri::command]
fn get_env_var(name: String) -> Result<String, String> {
    // Only allow specific env vars for security
    let allowed = ["ANTHROPIC_API_KEY", "GEMINI_API_KEY"];
    if !allowed.contains(&name.as_str()) {
        return Err(format!("Access to environment variable '{}' is not allowed", name));
    }
    std::env::var(&name).map_err(|_| format!("Environment variable '{}' is not set", name))
}

// ============================================================================
// Tauri Commands - Chat Persistence
// ============================================================================

#[tauri::command]
fn list_chat_sessions() -> Result<Vec<storage::chats::ChatSessionMeta>, String> {
    storage::chats::list_chat_sessions().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_chat_session(session_id: String) -> Result<storage::chats::ChatSession, String> {
    storage::chats::get_chat_session(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_chat_session(session: storage::chats::ChatSession) -> Result<(), String> {
    storage::chats::save_chat_session(&session).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_chat_session(session_id: String) -> Result<(), String> {
    storage::chats::delete_chat_session(&session_id).map_err(|e| e.to_string())
}

// ============================================================================
// App Entry Point
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
