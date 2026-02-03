use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::fs;
use thiserror::Error;

use crate::db::ConnectionConfig;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),
    #[error("Config not found")]
    NotFound,
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

fn get_config_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("join");
    
    fs::create_dir_all(&config_dir).ok();
    config_dir.join("connections.json")
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
