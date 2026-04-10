use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use super::config::{get_join_config_dir, ConfigError};
use super::project::{self, ProjectInfo};

const MAX_RECENT_PROJECTS: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppPreferences {
    #[serde(default)]
    pub selected_model_id: Option<String>,
    #[serde(default)]
    pub recent_projects: Vec<ProjectInfo>,
}

fn get_preferences_path() -> PathBuf {
    get_join_config_dir().join("preferences.json")
}

pub fn load_preferences() -> Result<AppPreferences, ConfigError> {
    let path = get_preferences_path();

    if !path.exists() {
        return Ok(AppPreferences::default());
    }

    let content = fs::read_to_string(&path)?;
    let prefs: AppPreferences = serde_json::from_str(&content)?;

    Ok(prefs)
}

pub fn save_preferences(prefs: &AppPreferences) -> Result<(), ConfigError> {
    let path = get_preferences_path();
    fs::create_dir_all(path.parent().unwrap_or(&get_join_config_dir()))?;
    let content = serde_json::to_string_pretty(prefs)?;
    fs::write(&path, content)?;

    Ok(())
}

pub fn get_selected_model_id() -> Result<Option<String>, ConfigError> {
    let prefs = load_preferences()?;
    Ok(prefs.selected_model_id)
}

pub fn set_selected_model_id(model_id: String) -> Result<(), ConfigError> {
    let mut prefs = load_preferences()?;
    prefs.selected_model_id = Some(model_id);
    save_preferences(&prefs)
}

pub fn remember_project(project: &ProjectInfo) -> Result<(), ConfigError> {
    let mut prefs = load_preferences()?;
    prefs
        .recent_projects
        .retain(|recent| recent.root_path != project.root_path);
    prefs.recent_projects.insert(0, project.clone());
    prefs.recent_projects.truncate(MAX_RECENT_PROJECTS);
    save_preferences(&prefs)
}

pub fn list_recent_projects() -> Result<Vec<ProjectInfo>, ConfigError> {
    let mut prefs = load_preferences()?;
    let mut projects = Vec::new();

    for recent in &prefs.recent_projects {
        if let Ok(project) = project::open_project(&recent.root_path) {
            projects.push(project);
        }
    }

    if projects.len() != prefs.recent_projects.len() {
        prefs.recent_projects = projects.clone();
        save_preferences(&prefs)?;
    }

    Ok(projects)
}
