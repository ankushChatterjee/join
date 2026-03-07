use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::fs;
use thiserror::Error;

use crate::db::ConnectionConfig;
#[cfg(test)]
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),
    #[error("Config not found")]
    NotFound,
    #[error("Validation error: {0}")]
    ValidationError(String),
}

impl Serialize for ConfigError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    pub connections: Vec<ConnectionConfig>,
}

pub(super) fn get_join_config_dir() -> PathBuf {
    if let Ok(override_dir) = std::env::var("JOIN_CONFIG_DIR") {
        let dir = PathBuf::from(override_dir);
        fs::create_dir_all(&dir).ok();
        return dir;
    }

    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("join");

    fs::create_dir_all(&config_dir).ok();
    config_dir
}

#[cfg(test)]
pub(crate) fn test_env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn get_config_path() -> PathBuf {
    get_join_config_dir().join("connections.json")
}

pub fn load_config() -> Result<AppConfig, ConfigError> {
    let path = get_config_path();
    
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    
    let content = fs::read_to_string(&path)?;
    let config: AppConfig = serde_json::from_str(&content)?;
    
    Ok(config)
}

pub fn save_config(config: &AppConfig) -> Result<(), ConfigError> {
    let path = get_config_path();
    let content = serde_json::to_string_pretty(config)?;
    fs::write(&path, content)?;
    
    Ok(())
}

pub fn add_connection(connection: ConnectionConfig) -> Result<(), ConfigError> {
    let mut config = load_config()?;
    
    // Remove existing connection with same ID if it exists
    config.connections.retain(|c| c.id != connection.id);
    config.connections.push(connection);
    
    save_config(&config)
}

pub fn remove_connection(connection_id: &str) -> Result<(), ConfigError> {
    let mut config = load_config()?;
    config.connections.retain(|c| c.id != connection_id);
    save_config(&config)
}

pub fn get_connection(connection_id: &str) -> Result<ConnectionConfig, ConfigError> {
    let config = load_config()?;
    
    config
        .connections
        .into_iter()
        .find(|c| c.id == connection_id)
        .ok_or(ConfigError::NotFound)
}

pub fn list_connections() -> Result<Vec<ConnectionConfig>, ConfigError> {
    let config = load_config()?;
    Ok(config.connections)
}
