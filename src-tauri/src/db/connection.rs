use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use sqlx::{
    mysql::MySqlPoolOptions, postgres::PgPoolOptions, sqlite::SqlitePoolOptions, MySqlPool, PgPool,
    SqlitePool,
};
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("Connection not found: {0}")]
    ConnectionNotFound(String),
    #[error("Connection failed: {0}")]
    ConnectionFailed(String),
    #[error("Query execution failed: {0}")]
    QueryFailed(String),
    #[error("Database error: {0}")]
    SqlxError(#[from] sqlx::Error),
}

impl Serialize for DbError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseType {
    Postgresql,
    Mysql,
    Sqlite,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub db_type: DatabaseType,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub database: String,
    pub username: Option<String>,
    // Password is NOT stored here - it's in the OS keychain
    #[serde(default)]
    pub ssl_mode: Option<String>, // "disable", "prefer", "require"
}

impl ConnectionConfig {
    pub fn new(
        name: String,
        db_type: DatabaseType,
        host: Option<String>,
        port: Option<u16>,
        database: String,
        username: Option<String>,
        ssl_mode: Option<String>,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            db_type,
            host,
            port,
            database,
            username,
            ssl_mode,
        }
    }

    pub fn build_connection_string(&self, password: Option<&str>) -> String {
        match self.db_type {
            DatabaseType::Postgresql => {
                let host = self.host.as_deref().unwrap_or("localhost");
                let port = self.port.unwrap_or(5432);
                let user = self.username.as_deref().unwrap_or("postgres");
                let pass = password.unwrap_or("");
                let ssl = self.ssl_mode.as_deref().unwrap_or("prefer");
                format!(
                    "postgres://{}:{}@{}:{}/{}?sslmode={}",
                    user, pass, host, port, self.database, ssl
                )
            }
            DatabaseType::Mysql => {
                let host = self.host.as_deref().unwrap_or("localhost");
                let port = self.port.unwrap_or(3306);
                let user = self.username.as_deref().unwrap_or("root");
                let pass = password.unwrap_or("");
                let ssl = self.ssl_mode.as_deref().unwrap_or("preferred");
                format!(
                    "mysql://{}:{}@{}:{}/{}?ssl-mode={}",
                    user, pass, host, port, self.database, ssl
                )
            }
            DatabaseType::Sqlite => {
                // For SQLite, database is the file path
                format!("sqlite:{}", self.database)
            }
        }
    }
}

/// Native database pool enum - provides full type support for each database
#[derive(Clone)]
pub enum DatabasePool {
    Postgres(PgPool),
    MySql(MySqlPool),
    Sqlite(SqlitePool),
}

impl DatabasePool {
    pub async fn close(&self) {
        match self {
            DatabasePool::Postgres(pool) => pool.close().await,
            DatabasePool::MySql(pool) => pool.close().await,
            DatabasePool::Sqlite(pool) => pool.close().await,
        }
    }
}

// Global connection pool manager
pub static CONNECTION_POOLS: Lazy<Arc<RwLock<HashMap<String, DatabasePool>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

pub async fn create_pool(
    config: &ConnectionConfig,
    password: Option<&str>,
) -> Result<DatabasePool, DbError> {
    let connection_string = config.build_connection_string(password);

    let pool = match config.db_type {
        DatabaseType::Postgresql => {
            let pool = PgPoolOptions::new()
                .max_connections(5)
                .connect(&connection_string)
                .await
                .map_err(|e| DbError::ConnectionFailed(e.to_string()))?;
            DatabasePool::Postgres(pool)
        }
        DatabaseType::Mysql => {
            let pool = MySqlPoolOptions::new()
                .max_connections(5)
                .connect(&connection_string)
                .await
                .map_err(|e| DbError::ConnectionFailed(e.to_string()))?;
            DatabasePool::MySql(pool)
        }
        DatabaseType::Sqlite => {
            let pool = SqlitePoolOptions::new()
                .max_connections(5)
                .connect(&connection_string)
                .await
                .map_err(|e| DbError::ConnectionFailed(e.to_string()))?;
            DatabasePool::Sqlite(pool)
        }
    };

    Ok(pool)
}

pub async fn connect(config: &ConnectionConfig, password: Option<&str>) -> Result<(), DbError> {
    let pool = create_pool(config, password).await?;

    let mut pools = CONNECTION_POOLS.write().await;
    pools.insert(config.id.clone(), pool);

    Ok(())
}

pub async fn disconnect(connection_id: &str) -> Result<(), DbError> {
    let mut pools = CONNECTION_POOLS.write().await;

    if let Some(pool) = pools.remove(connection_id) {
        pool.close().await;
    }

    Ok(())
}

pub async fn get_pool(connection_id: &str) -> Result<DatabasePool, DbError> {
    let pools = CONNECTION_POOLS.read().await;

    pools
        .get(connection_id)
        .cloned()
        .ok_or_else(|| DbError::ConnectionNotFound(connection_id.to_string()))
}

pub async fn is_connected(connection_id: &str) -> bool {
    let pools = CONNECTION_POOLS.read().await;
    pools.contains_key(connection_id)
}

pub async fn test_connection(
    config: &ConnectionConfig,
    password: Option<&str>,
) -> Result<(), DbError> {
    let pool = create_pool(config, password).await?;

    // Test the connection with a simple query
    match &pool {
        DatabasePool::Postgres(p) => {
            sqlx::query("SELECT 1")
                .execute(p)
                .await
                .map_err(|e| DbError::ConnectionFailed(e.to_string()))?;
        }
        DatabasePool::MySql(p) => {
            sqlx::query("SELECT 1")
                .execute(p)
                .await
                .map_err(|e| DbError::ConnectionFailed(e.to_string()))?;
        }
        DatabasePool::Sqlite(p) => {
            sqlx::query("SELECT 1")
                .execute(p)
                .await
                .map_err(|e| DbError::ConnectionFailed(e.to_string()))?;
        }
    }

    pool.close().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_postgres_connection_string_with_defaults() {
        let config = ConnectionConfig {
            id: "id".into(),
            name: "name".into(),
            db_type: DatabaseType::Postgresql,
            host: None,
            port: None,
            database: "app_db".into(),
            username: None,
            ssl_mode: None,
        };

        let conn = config.build_connection_string(Some("secret"));
        assert_eq!(
            conn,
            "postgres://postgres:secret@localhost:5432/app_db?sslmode=prefer"
        );
    }

    #[test]
    fn builds_mysql_connection_string_with_defaults() {
        let config = ConnectionConfig {
            id: "id".into(),
            name: "name".into(),
            db_type: DatabaseType::Mysql,
            host: None,
            port: None,
            database: "app_db".into(),
            username: None,
            ssl_mode: None,
        };

        let conn = config.build_connection_string(Some("secret"));
        assert_eq!(
            conn,
            "mysql://root:secret@localhost:3306/app_db?ssl-mode=preferred"
        );
    }

    #[tokio::test]
    async fn sqlite_connection_lifecycle_works() {
        let config = ConnectionConfig {
            id: "test-sqlite-conn".into(),
            name: "sqlite".into(),
            db_type: DatabaseType::Sqlite,
            host: None,
            port: None,
            database: ":memory:".into(),
            username: None,
            ssl_mode: None,
        };

        connect(&config, None).await.expect("connect should work");
        assert!(is_connected(&config.id).await);
        test_connection(&config, None)
            .await
            .expect("test_connection should work");
        disconnect(&config.id)
            .await
            .expect("disconnect should work");
        assert!(!is_connected(&config.id).await);
    }
}
