use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

use super::ConfigError;

const PROJECT_MANIFEST_FILE: &str = "join-project.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectManifest {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub created_at: i64,
    pub updated_at: i64,
}

fn manifest_path(root: &Path) -> PathBuf {
    root.join(PROJECT_MANIFEST_FILE)
}

pub fn ensure_project_dirs(root: &Path) -> Result<(), ConfigError> {
    fs::create_dir_all(root)?;
    for dir in ["connections", "scripts", "saved-results", "tabs", "chats", "history"] {
        fs::create_dir_all(root.join(dir))?;
    }
    Ok(())
}

fn load_manifest(root: &Path) -> Result<ProjectManifest, ConfigError> {
    let path = manifest_path(root);
    if !path.exists() {
        return Err(ConfigError::NotFound);
    }
    let content = fs::read_to_string(path)?;
    let manifest = serde_json::from_str(&content)?;
    Ok(manifest)
}

fn save_manifest(root: &Path, manifest: &ProjectManifest) -> Result<(), ConfigError> {
    ensure_project_dirs(root)?;
    let path = manifest_path(root);
    let content = serde_json::to_string_pretty(manifest)?;
    fs::write(path, content)?;
    Ok(())
}

pub fn create_project(parent_dir: &str, name: &str) -> Result<ProjectInfo, ConfigError> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err(ConfigError::ValidationError(
            "project name cannot be empty".to_string(),
        ));
    }

    let project_root = PathBuf::from(parent_dir).join(trimmed_name);
    if project_root.exists() && manifest_path(&project_root).exists() {
        return Err(ConfigError::ValidationError(
            "project already exists at that location".to_string(),
        ));
    }

    let now = chrono::Utc::now().timestamp_millis();
    let manifest = ProjectManifest {
        id: Uuid::new_v4().to_string(),
        name: trimmed_name.to_string(),
        created_at: now,
        updated_at: now,
    };
    save_manifest(&project_root, &manifest)?;
    Ok(ProjectInfo {
        id: manifest.id,
        name: manifest.name,
        root_path: project_root.to_string_lossy().to_string(),
        created_at: manifest.created_at,
        updated_at: manifest.updated_at,
    })
}

pub fn open_project(root_path: &str) -> Result<ProjectInfo, ConfigError> {
    let root = PathBuf::from(root_path);
    let manifest = load_manifest(&root)?;
    ensure_project_dirs(&root)?;
    Ok(ProjectInfo {
        id: manifest.id,
        name: manifest.name,
        root_path: root.to_string_lossy().to_string(),
        created_at: manifest.created_at,
        updated_at: manifest.updated_at,
    })
}

pub fn get_project_root(root_path: &str) -> Result<PathBuf, ConfigError> {
    let root = PathBuf::from(root_path);
    let _ = load_manifest(&root)?;
    ensure_project_dirs(&root)?;
    Ok(root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        std::env::temp_dir().join(format!("join-project-tests-{nanos}"))
    }

    #[test]
    fn create_and_open_project_roundtrip() {
        let root = temp_dir();
        fs::create_dir_all(&root).expect("temp root");

        let project = create_project(root.to_str().expect("path"), "Demo").expect("create");
        assert!(PathBuf::from(&project.root_path).join(PROJECT_MANIFEST_FILE).exists());

        let opened = open_project(&project.root_path).expect("open");
        assert_eq!(opened.name, "Demo");
        assert_eq!(opened.id, project.id);
    }
}
