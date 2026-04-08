use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use super::path_safety::{safe_join, validate_id};
use super::project::get_project_root;
use super::ConfigError;

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

fn get_chats_dir(project_root: &Path) -> PathBuf {
    let dir = project_root.join("chats");
    fs::create_dir_all(&dir).ok();
    dir
}

fn get_chat_session_path(project_root: &Path, session_id: &str) -> Result<PathBuf, ConfigError> {
    validate_id(session_id)?;
    safe_join(&get_chats_dir(project_root), &format!("{session_id}.json"))
}

fn get_chat_index_path(project_root: &Path) -> PathBuf {
    get_chats_dir(project_root).join("index.json")
}

fn load_chat_index(project_root: &Path) -> Result<Vec<ChatSessionMeta>, ConfigError> {
    let index_path = get_chat_index_path(project_root);
    if !index_path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(index_path)?;
    let metas = serde_json::from_str(&content)?;
    Ok(metas)
}

fn save_chat_index(project_root: &Path, metas: &[ChatSessionMeta]) -> Result<(), ConfigError> {
    let index_path = get_chat_index_path(project_root);
    let content = serde_json::to_string(metas)?;
    fs::write(index_path, content)?;
    Ok(())
}

pub fn list_chat_sessions(project_root: &str) -> Result<Vec<ChatSessionMeta>, ConfigError> {
    let project_root = get_project_root(project_root)?;
    let chats_dir = get_chats_dir(&project_root);
    if !chats_dir.exists() {
        return Ok(Vec::new());
    }

    let mut sessions = load_chat_index(&project_root)?;
    if !sessions.is_empty() {
        sessions.retain(|meta| {
            get_chat_session_path(&project_root, &meta.id)
                .map(|path| path.exists())
                .unwrap_or(false)
        });
        sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        save_chat_index(&project_root, &sessions)?;
        return Ok(sessions);
    }

    for entry in fs::read_dir(&chats_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "json") {
            let Ok(content) = fs::read_to_string(&path) else {
                continue;
            };
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
    }

    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    save_chat_index(&project_root, &sessions)?;
    Ok(sessions)
}

pub fn get_chat_session(project_root: &str, session_id: &str) -> Result<ChatSession, ConfigError> {
    let project_root = get_project_root(project_root)?;
    let path = get_chat_session_path(&project_root, session_id)?;
    if !path.exists() {
        return Err(ConfigError::IoError(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Chat session not found: {session_id}"),
        )));
    }
    let content = fs::read_to_string(&path)?;
    let session = serde_json::from_str(&content)?;
    Ok(session)
}

pub fn save_chat_session(project_root: &str, session: &ChatSession) -> Result<(), ConfigError> {
    let project_root = get_project_root(project_root)?;
    validate_id(&session.id)?;
    let path = get_chat_session_path(&project_root, &session.id)?;
    let content = serde_json::to_string_pretty(session)?;
    fs::write(&path, content)?;

    let mut metas = load_chat_index(&project_root).unwrap_or_default();
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
    save_chat_index(&project_root, &metas)?;
    Ok(())
}

pub fn delete_chat_session(project_root: &str, session_id: &str) -> Result<(), ConfigError> {
    let project_root = get_project_root(project_root)?;
    let path = get_chat_session_path(&project_root, session_id)?;
    if path.exists() {
        fs::remove_file(&path)?;
    }

    let mut metas = load_chat_index(&project_root).unwrap_or_default();
    metas.retain(|m| m.id != session_id);
    save_chat_index(&project_root, &metas)?;
    Ok(())
}
