use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use super::ConfigError;
use super::path_safety::{safe_join, validate_id};

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
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parts: Option<Vec<serde_json::Value>>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forked_from: Option<String>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forked_from: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Get the chats directory
fn get_chats_dir() -> PathBuf {
    let config_dir = super::config::get_join_config_dir().join("chats");

    fs::create_dir_all(&config_dir).ok();
    config_dir
}

fn get_chat_session_path(session_id: &str) -> Result<PathBuf, ConfigError> {
    validate_id(session_id)?;
    safe_join(&get_chats_dir(), &format!("{session_id}.json"))
}

fn get_chat_index_path() -> PathBuf {
    get_chats_dir().join("index.json")
}

fn load_chat_index() -> Result<Vec<ChatSessionMeta>, ConfigError> {
    let index_path = get_chat_index_path();
    if !index_path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(index_path)?;
    let metas: Vec<ChatSessionMeta> = serde_json::from_str(&content)?;
    Ok(metas)
}

fn save_chat_index(metas: &[ChatSessionMeta]) -> Result<(), ConfigError> {
    let index_path = get_chat_index_path();
    let content = serde_json::to_string(metas)?;
    fs::write(index_path, content)?;
    Ok(())
}

/// List all chat sessions (metadata only)
pub fn list_chat_sessions() -> Result<Vec<ChatSessionMeta>, ConfigError> {
    let chats_dir = get_chats_dir();

    if !chats_dir.exists() {
        return Ok(Vec::new());
    }

    let mut sessions = load_chat_index()?;

    if !sessions.is_empty() {
        sessions.retain(|meta| {
            get_chat_session_path(&meta.id)
                .map(|path| path.exists())
                .unwrap_or(false)
        });
        sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        save_chat_index(&sessions)?;
        return Ok(sessions);
    }

    sessions = Vec::new();

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
                            forked_from: session.forked_from,
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
    save_chat_index(&sessions)?;

    Ok(sessions)
}

/// Get a single chat session by ID (with messages)
pub fn get_chat_session(session_id: &str) -> Result<ChatSession, ConfigError> {
    let path = get_chat_session_path(session_id)?;

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
    validate_id(&session.id)?;
    let path = get_chat_session_path(&session.id)?;
    let content = serde_json::to_string_pretty(session)?;
    fs::write(&path, content)?;

    let mut metas = load_chat_index().unwrap_or_default();
    let next_meta = ChatSessionMeta {
        id: session.id.clone(),
        title: session.title.clone(),
        model_id: session.model_id.clone(),
        connection_id: session.connection_id.clone(),
        forked_from: session.forked_from.clone(),
        created_at: session.created_at,
        updated_at: session.updated_at,
    };
    metas.retain(|m| m.id != session.id);
    metas.push(next_meta);
    metas.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    save_chat_index(&metas)?;

    Ok(())
}

/// Delete a chat session
pub fn delete_chat_session(session_id: &str) -> Result<(), ConfigError> {
    let path = get_chat_session_path(session_id)?;

    if path.exists() {
        fs::remove_file(&path)?;
    }

    let mut metas = load_chat_index().unwrap_or_default();
    metas.retain(|m| m.id != session_id);
    save_chat_index(&metas)?;

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
            forked_from: None,
            created_at: updated_at - 1000,
            updated_at,
            messages: vec![ChatMessage {
                id: format!("msg-{id}"),
                role: "user".into(),
                content: "hello".into(),
                tool_calls: None,
                parts: None,
                timestamp: updated_at - 500,
                is_error: None,
                metadata: None,
            }],
        }
    }

    fn sample_forked_session(
        id: &str,
        title: &str,
        forked_from: &str,
        updated_at: i64,
    ) -> ChatSession {
        ChatSession {
            id: id.into(),
            title: title.into(),
            model_id: "model".into(),
            connection_id: Some("conn-1".into()),
            forked_from: Some(forked_from.into()),
            created_at: updated_at - 1000,
            updated_at,
            messages: vec![ChatMessage {
                id: format!("msg-{id}"),
                role: "user".into(),
                content: "forked content".into(),
                tool_calls: None,
                parts: None,
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

    #[test]
    fn forked_session_preserves_forked_from_field() {
        let _lock = crate::storage::config::test_env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _guard = setup_temp_config();

        let original = sample_session("original", "Original Session", 100);
        let forked = sample_forked_session("forked", "Forked Session", "original", 200);

        save_chat_session(&original).expect("save original");
        save_chat_session(&forked).expect("save forked");

        // Verify forked session is saved correctly
        let loaded_forked = get_chat_session("forked").expect("get forked");
        assert_eq!(loaded_forked.id, "forked");
        assert_eq!(loaded_forked.forked_from, Some("original".to_string()));
        assert_eq!(loaded_forked.title, "Forked Session");

        // Verify listing includes fork information
        let listed = list_chat_sessions().expect("list");
        assert_eq!(listed.len(), 2);

        let forked_meta = listed.iter().find(|s| s.id == "forked").unwrap();
        assert_eq!(forked_meta.forked_from, Some("original".to_string()));

        // Original session should not have forked_from
        let original_meta = listed.iter().find(|s| s.id == "original").unwrap();
        assert_eq!(original_meta.forked_from, None);
    }

    #[test]
    fn forked_session_roundtrip() {
        let _lock = crate::storage::config::test_env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _guard = setup_temp_config();

        // Create a session with multiple messages
        let forked = ChatSession {
            id: "fork-1".into(),
            title: "Fork with Messages".into(),
            model_id: "gpt-4".into(),
            connection_id: Some("conn-2".into()),
            forked_from: Some("original-session".into()),
            created_at: 1000,
            updated_at: 2000,
            messages: vec![
                ChatMessage {
                    id: "msg-1".into(),
                    role: "user".into(),
                    content: "First message".into(),
                    tool_calls: None,
                    parts: None,
                    timestamp: 1500,
                    is_error: None,
                    metadata: Some(ChatMessageMetadata {
                        connection_id: Some("conn-2".into()),
                        metadata_version: Some(1),
                        result_tab_id: None,
                        result_version: None,
                        captured_at: Some(1500),
                    }),
                },
                ChatMessage {
                    id: "msg-2".into(),
                    role: "assistant".into(),
                    content: "Assistant response".into(),
                    tool_calls: None,
                    parts: None,
                    timestamp: 1600,
                    is_error: None,
                    metadata: None,
                },
            ],
        };

        save_chat_session(&forked).expect("save forked session");

        let loaded = get_chat_session("fork-1").expect("load forked session");
        assert_eq!(loaded.id, "fork-1");
        assert_eq!(loaded.forked_from, Some("original-session".into()));
        assert_eq!(loaded.messages.len(), 2);
        assert_eq!(loaded.messages[0].role, "user");
        assert_eq!(loaded.messages[1].role, "assistant");

        // Verify metadata is preserved
        let first_msg_metadata = loaded.messages[0].metadata.as_ref().unwrap();
        assert_eq!(first_msg_metadata.connection_id, Some("conn-2".into()));
        assert_eq!(first_msg_metadata.metadata_version, Some(1));
    }

    #[test]
    fn forked_session_without_forked_from_is_none() {
        let _lock = crate::storage::config::test_env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _guard = setup_temp_config();

        // Create a regular session without forked_from
        let regular = ChatSession {
            id: "regular".into(),
            title: "Regular Session".into(),
            model_id: "claude".into(),
            connection_id: None,
            forked_from: None,
            created_at: 1000,
            updated_at: 2000,
            messages: vec![],
        };

        save_chat_session(&regular).expect("save regular");

        let loaded = get_chat_session("regular").expect("load regular");
        assert_eq!(loaded.forked_from, None);

        // Verify listing shows None
        let listed = list_chat_sessions().expect("list");
        let regular_meta = listed.iter().find(|s| s.id == "regular").unwrap();
        assert_eq!(regular_meta.forked_from, None);
    }

    #[test]
    fn delete_forked_session_works() {
        let _lock = crate::storage::config::test_env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _guard = setup_temp_config();

        let original = sample_session("orig-del", "Original", 100);
        let forked = sample_forked_session("fork-del", "To Delete", "orig-del", 200);

        save_chat_session(&original).expect("save original");
        save_chat_session(&forked).expect("save forked");

        // Delete the forked session
        delete_chat_session("fork-del").expect("delete forked");

        // Verify it's gone
        let listed = list_chat_sessions().expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "orig-del");

        // Verify original still exists with correct fork info
        assert_eq!(listed[0].forked_from, None);
    }
}
