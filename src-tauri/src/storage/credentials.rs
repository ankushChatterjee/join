use keyring::Entry;
use serde::Serialize;
use thiserror::Error;

const SERVICE_NAME: &str = "com.ankush.join";

#[derive(Debug, Error)]
pub enum CredentialError {
    #[error("Storage error: {0}")]
    StorageError(String),
    #[error("Credential not found")]
    NotFound,
}

impl Serialize for CredentialError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub fn store_password(connection_id: &str, password: &str) -> Result<(), CredentialError> {
    let entry = Entry::new(SERVICE_NAME, connection_id)
        .map_err(|e| CredentialError::StorageError(e.to_string()))?;
    match entry.set_password(password) {
        Ok(()) => Ok(()),
        Err(error) if is_duplicate_item_error(&error) => {
            // Some keychain backends reject duplicate writes instead of overwriting.
            let _ = entry.delete_credential();
            entry
                .set_password(password)
                .map_err(|e| CredentialError::StorageError(e.to_string()))
        }
        Err(error) => Err(CredentialError::StorageError(error.to_string())),
    }
}

pub fn get_password(connection_id: &str) -> Result<String, CredentialError> {
    let entry = Entry::new(SERVICE_NAME, connection_id)
        .map_err(|e| CredentialError::StorageError(e.to_string()))?;
    entry.get_password().map_err(|e| match e {
        keyring::Error::NoEntry => CredentialError::NotFound,
        _ => CredentialError::StorageError(e.to_string()),
    })
}

pub fn delete_password(connection_id: &str) -> Result<(), CredentialError> {
    let entry = Entry::new(SERVICE_NAME, connection_id)
        .map_err(|e| CredentialError::StorageError(e.to_string()))?;
    // Ignore NoEntry errors on delete - it's fine if the password doesn't exist
    let _ = entry.delete_credential();
    Ok(())
}

fn is_duplicate_item_error(error: &keyring::Error) -> bool {
    let message = error.to_string().to_ascii_lowercase();
    message.contains("already exists")
        || message.contains("item already exists")
        || message.contains("duplicate item")
}
