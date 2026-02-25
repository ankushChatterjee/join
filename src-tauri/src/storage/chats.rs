use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use super::ConfigError;

/// A single chat message
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageMetadata {
    #[serde(default)]
    pub connection_id: Option<String>,
    #[serde(default)]
    pub metadata_version: Option<i64>,
    #[serde(default)]
    pub result_tab_id: Option<String>,
    #[serde(default)]
    pub result_version: Option<i64>,
    #[serde(default)]
    pub captured_at: Option<i64>,
}

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
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<ChatMessageMetadata>,
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
    let config_dir = super::config::get_join_config_dir().join("chats");

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
                Err(_) => {
                    continue;
                }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn setup_temp_config() -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("join-chats-tests-{nanos}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        unsafe {
            std::env::set_var("JOIN_CONFIG_DIR", &dir);
        }
        dir
    }

    fn sample_session(id: &str, title: &str, updated_at: i64) -> ChatSession {
        ChatSession {
            id: id.into(),
            title: title.into(),
            model_id: "model".into(),
            connection_id: Some("conn-1".into()),
            created_at: updated_at - 1000,
            updated_at,
            messages: vec![ChatMessage {
                id: format!("msg-{id}"),
                role: "user".into(),
                content: "hello".into(),
                tool_calls: None,
                timestamp: updated_at - 500,
                is_error: None,
                metadata: None,
            }],
        }
    }

    #[test]
    fn chat_sessions_roundtrip_and_sorting() {
        let _lock = crate::storage::config::test_env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _guard = setup_temp_config();
        let older = sample_session("s1", "Older", 100);
        let newer = sample_session("s2", "Newer", 200);
        save_chat_session(&older).expect("save older");
        save_chat_session(&newer).expect("save newer");

        let listed = list_chat_sessions().expect("list");
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, "s2");
        assert_eq!(listed[1].id, "s1");

        let loaded = get_chat_session("s2").expect("get");
        assert_eq!(loaded.title, "Newer");

        delete_chat_session("s1").expect("delete");
        let listed_after_delete = list_chat_sessions().expect("list after");
        assert_eq!(listed_after_delete.len(), 1);
        assert_eq!(listed_after_delete[0].id, "s2");
    }
}
