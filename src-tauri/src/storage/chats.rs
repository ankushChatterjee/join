use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use super::ConfigError;

/// A single chat message
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatToolCall {
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ChatToolCall>>,
    pub timestamp: i64,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
}

/// A chat session with metadata and messages
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSession {
    pub id: String,
    pub title: String,
    pub model_id: String,
    pub connection_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub messages: Vec<ChatMessage>,
}

/// Lightweight session metadata (without messages)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSessionMeta {
    pub id: String,
    pub title: String,
    pub model_id: String,
    pub connection_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Get the chats directory
fn get_chats_dir() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("join")
        .join("chats");

    fs::create_dir_all(&config_dir).ok();
    config_dir
}

/// List all chat sessions (metadata only)
pub fn list_chat_sessions() -> Result<Vec<ChatSessionMeta>, ConfigError> {
    let chats_dir = get_chats_dir();

    if !chats_dir.exists() {
        return Ok(Vec::new());
    }

    let mut sessions = Vec::new();

    for entry in fs::read_dir(&chats_dir)? {
        let entry = entry?;
        let path = entry.path();

        if path.extension().map_or(false, |ext| ext == "json") {
            match fs::read_to_string(&path) {
                Ok(content) => {
                    if let Ok(session) = serde_json::from_str::<ChatSession>(&content) {
                        sessions.push(ChatSessionMeta {
                            id: session.id,
                            title: session.title,
                            model_id: session.model_id,
                            connection_id: session.connection_id,
                            created_at: session.created_at,
                            updated_at: session.updated_at,
                        });
                    }
                }
                Err(_) => continue,
            }
        }
    }

    // Sort by updated_at descending (most recent first)
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    Ok(sessions)
}

/// Get a single chat session by ID (with messages)
pub fn get_chat_session(session_id: &str) -> Result<ChatSession, ConfigError> {
    let path = get_chats_dir().join(format!("{}.json", session_id));

    if !path.exists() {
        return Err(ConfigError::IoError(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Chat session not found: {}", session_id),
        )));
    }

    let content = fs::read_to_string(&path)?;
    let session: ChatSession = serde_json::from_str(&content)?;

    Ok(session)
}

/// Save a chat session
pub fn save_chat_session(session: &ChatSession) -> Result<(), ConfigError> {
    let path = get_chats_dir().join(format!("{}.json", session.id));
    let content = serde_json::to_string_pretty(session)?;
    fs::write(&path, content)?;

    Ok(())
}

/// Delete a chat session
pub fn delete_chat_session(session_id: &str) -> Result<(), ConfigError> {
    let path = get_chats_dir().join(format!("{}.json", session_id));

    if path.exists() {
        fs::remove_file(&path)?;
    }

    Ok(())
}

