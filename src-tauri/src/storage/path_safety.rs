use std::fs;
use std::path::{Path, PathBuf};

use super::ConfigError;

pub fn validate_id(id: &str) -> Result<(), ConfigError> {
    if id.is_empty() {
        return Err(ConfigError::ValidationError(
            "identifier cannot be empty".to_string(),
        ));
    }
    if id.len() > 128 {
        return Err(ConfigError::ValidationError(
            "identifier is too long".to_string(),
        ));
    }
    if id.contains("..")
        || id.contains('/')
        || id.contains('\\')
        || id.starts_with('.')
        || id.starts_with('~')
        || id.contains('%')
    {
        return Err(ConfigError::ValidationError(
            "identifier contains invalid path characters".to_string(),
        ));
    }
    if !id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-')
    {
        return Err(ConfigError::ValidationError(
            "identifier may only contain letters, numbers, dot, underscore, and hyphen".to_string(),
        ));
    }
    Ok(())
}

fn canonicalize_or_self(path: &Path) -> Result<PathBuf, ConfigError> {
    match fs::canonicalize(path) {
        Ok(canonical) => Ok(canonical),
        Err(_) => Ok(path.to_path_buf()),
    }
}

pub fn safe_join(base: &Path, child: &str) -> Result<PathBuf, ConfigError> {
    validate_id(child)?;
    fs::create_dir_all(base)?;

    let base_canonical = canonicalize_or_self(base)?;
    let joined = base.join(child);

    let parent = joined.parent().unwrap_or(base);
    fs::create_dir_all(parent)?;
    let parent_canonical = canonicalize_or_self(parent)?;
    if !parent_canonical.starts_with(&base_canonical) {
        return Err(ConfigError::ValidationError(
            "resolved path escapes base directory".to_string(),
        ));
    }

    Ok(joined)
}

#[cfg(test)]
mod tests {
    use super::{safe_join, validate_id};

    #[test]
    fn validate_id_accepts_safe_values() {
        assert!(validate_id("conn-123").is_ok());
        assert!(validate_id("script_abc.1").is_ok());
    }

    #[test]
    fn validate_id_rejects_traversal_like_values() {
        assert!(validate_id("../x").is_err());
        assert!(validate_id("..\\x").is_err());
        assert!(validate_id("/abs").is_err());
        assert!(validate_id("%2e%2e%2fetc").is_err());
    }

    #[test]
    fn safe_join_rejects_invalid_child() {
        let base = std::env::temp_dir().join("join-safe-join");
        assert!(safe_join(&base, "../bad").is_err());
    }
}
