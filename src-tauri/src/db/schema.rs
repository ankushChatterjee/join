use serde::{Deserialize, Serialize};
use sqlx::Row;

use super::{get_pool, DatabasePool, DbError};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaInfo {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub schema: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub is_primary_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewInfo {
    pub name: String,
    pub schema: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexInfo {
    pub name: String,
    pub is_unique: bool,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionInfo {
    pub name: String,
    pub return_type: Option<String>,
    pub schema: Option<String>,
}

pub async fn get_schemas(connection_id: &str) -> Result<Vec<SchemaInfo>, DbError> {
    let pool = get_pool(connection_id).await?;
    
    match pool {
        DatabasePool::Postgres(pool) => {
            let rows = sqlx::query(
                "SELECT schema_name as name FROM information_schema.schemata 
                 WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                 ORDER BY schema_name"
            )
            .fetch_all(&pool)
            .await
            .map_err(|e| DbError::QueryFailed(e.to_string()))?;
            
            Ok(rows.iter().map(|row| SchemaInfo {
                name: row.get("name"),
            }).collect())
        }
        DatabasePool::MySql(pool) => {
            let rows = sqlx::query(
                "SELECT CAST(SCHEMA_NAME AS CHAR) as name FROM information_schema.SCHEMATA 
                 WHERE SCHEMA_NAME NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
                 ORDER BY SCHEMA_NAME"
            )
            .fetch_all(&pool)
            .await
            .map_err(|e| DbError::QueryFailed(e.to_string()))?;
            
            Ok(rows.iter().map(|row| SchemaInfo {
                name: row.get("name"),
            }).collect())
        }
        DatabasePool::Sqlite(_) => {
            // SQLite doesn't have schemas, return a default one
            Ok(vec![SchemaInfo { name: "main".to_string() }])
        }
    }
}

pub async fn get_tables(
    connection_id: &str,
    schema: Option<&str>,
) -> Result<Vec<TableInfo>, DbError> {
    let pool = get_pool(connection_id).await?;
    
    match pool {
        DatabasePool::Postgres(pool) => {
            let schema_name = schema.unwrap_or("public");
            let query = format!(
                "SELECT table_name as name, table_schema as schema 
                 FROM information_schema.tables 
                 WHERE table_schema = '{}' AND table_type = 'BASE TABLE'
                 ORDER BY table_name",
                schema_name
            );
            
            let rows = sqlx::query(&query)
                .fetch_all(&pool)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?;
            
            Ok(rows.iter().map(|row| TableInfo {
                name: row.get("name"),
                schema: row.try_get("schema").ok(),
            }).collect())
        }
        DatabasePool::MySql(pool) => {
            let query = match schema {
                Some(s) if !s.is_empty() => format!(
                    "SELECT CAST(TABLE_NAME AS CHAR) as name, CAST(TABLE_SCHEMA AS CHAR) as `schema` 
                     FROM information_schema.TABLES 
                     WHERE TABLE_SCHEMA = '{}' AND TABLE_TYPE = 'BASE TABLE'
                     ORDER BY TABLE_NAME",
                    s
                ),
                _ => "SELECT CAST(TABLE_NAME AS CHAR) as name, CAST(TABLE_SCHEMA AS CHAR) as `schema` 
                      FROM information_schema.TABLES 
                      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
                      ORDER BY TABLE_NAME".to_string(),
            };
            
            let rows = sqlx::query(&query)
                .fetch_all(&pool)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?;
            
            Ok(rows.iter().map(|row| TableInfo {
                name: row.get("name"),
                schema: row.try_get("schema").ok(),
            }).collect())
        }
        DatabasePool::Sqlite(pool) => {
            let rows = sqlx::query(
                "SELECT name, 'main' as schema FROM sqlite_master 
                 WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                 ORDER BY name"
            )
            .fetch_all(&pool)
            .await
            .map_err(|e| DbError::QueryFailed(e.to_string()))?;
            
            Ok(rows.iter().map(|row| TableInfo {
                name: row.get("name"),
                schema: row.try_get("schema").ok(),
            }).collect())
        }
    }
}

pub async fn get_columns(
    connection_id: &str,
    table: &str,
    schema: Option<&str>,
) -> Result<Vec<ColumnInfo>, DbError> {
    let pool = get_pool(connection_id).await?;
    
    match pool {
        DatabasePool::Postgres(pool) => {
            let schema_name = schema.unwrap_or("public");
            let query = format!(
                "SELECT 
                    c.column_name as name,
                    c.data_type as data_type,
                    (c.is_nullable = 'YES') as is_nullable,
                    COALESCE(tc.constraint_type = 'PRIMARY KEY', false) as is_primary_key
                FROM information_schema.columns c
                LEFT JOIN information_schema.key_column_usage kcu 
                    ON c.table_schema = kcu.table_schema 
                    AND c.table_name = kcu.table_name 
                    AND c.column_name = kcu.column_name
                LEFT JOIN information_schema.table_constraints tc 
                    ON kcu.constraint_name = tc.constraint_name 
                    AND tc.constraint_type = 'PRIMARY KEY'
                WHERE c.table_schema = '{}' AND c.table_name = '{}'
                ORDER BY c.ordinal_position",
                schema_name, table
            );
            
            let rows = sqlx::query(&query)
                .fetch_all(&pool)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?;
            
            Ok(rows.iter().map(|row| ColumnInfo {
                name: row.get("name"),
                data_type: row.get("data_type"),
                is_nullable: row.try_get("is_nullable").unwrap_or(true),
                is_primary_key: row.try_get("is_primary_key").unwrap_or(false),
            }).collect())
        }
        DatabasePool::MySql(pool) => {
            let schema_clause = schema
                .map(|s| format!("TABLE_SCHEMA = '{}'", s))
                .unwrap_or_else(|| "TABLE_SCHEMA = DATABASE()".to_string());
            let query = format!(
                "SELECT 
                    CAST(COLUMN_NAME AS CHAR) as name,
                    CAST(DATA_TYPE AS CHAR) as data_type,
                    (IS_NULLABLE = 'YES') as is_nullable,
                    (COLUMN_KEY = 'PRI') as is_primary_key
                FROM information_schema.COLUMNS
                WHERE {} AND TABLE_NAME = '{}'
                ORDER BY ORDINAL_POSITION",
                schema_clause, table
            );
            
            let rows = sqlx::query(&query)
                .fetch_all(&pool)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?;
            
            Ok(rows.iter().map(|row| ColumnInfo {
                name: row.get("name"),
                data_type: row.get("data_type"),
                is_nullable: row.try_get("is_nullable").unwrap_or(true),
                is_primary_key: row.try_get("is_primary_key").unwrap_or(false),
            }).collect())
        }
        DatabasePool::Sqlite(pool) => {
            let query = format!("PRAGMA table_info('{}')", table);
            
            let rows = sqlx::query(&query)
                .fetch_all(&pool)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?;
            
            Ok(rows.iter().map(|row| ColumnInfo {
                name: row.get("name"),
                data_type: row.get("type"),
                is_nullable: row.get::<i32, _>("notnull") == 0,
                is_primary_key: row.get::<i32, _>("pk") == 1,
            }).collect())
        }
    }
}

pub async fn get_views(
    connection_id: &str,
    schema: Option<&str>,
) -> Result<Vec<ViewInfo>, DbError> {
    let pool = get_pool(connection_id).await?;
    
    match pool {
        DatabasePool::Postgres(pool) => {
            let schema_name = schema.unwrap_or("public");
            let query = format!(
                "SELECT table_name as name, table_schema as schema 
                 FROM information_schema.tables 
                 WHERE table_schema = '{}' AND table_type = 'VIEW'
                 ORDER BY table_name",
                schema_name
            );
            
            let rows = sqlx::query(&query)
                .fetch_all(&pool)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?;
            
            Ok(rows.iter().map(|row| ViewInfo {
                name: row.get("name"),
                schema: row.try_get("schema").ok(),
            }).collect())
        }
        DatabasePool::MySql(pool) => {
            let query = match schema {
                Some(s) if !s.is_empty() => format!(
                    "SELECT CAST(TABLE_NAME AS CHAR) as name, CAST(TABLE_SCHEMA AS CHAR) as `schema` 
                     FROM information_schema.TABLES 
                     WHERE TABLE_SCHEMA = '{}' AND TABLE_TYPE = 'VIEW'
                     ORDER BY TABLE_NAME",
                    s
                ),
                _ => "SELECT CAST(TABLE_NAME AS CHAR) as name, CAST(TABLE_SCHEMA AS CHAR) as `schema` 
                      FROM information_schema.TABLES 
                      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'VIEW'
                      ORDER BY TABLE_NAME".to_string(),
            };
            
            let rows = sqlx::query(&query)
                .fetch_all(&pool)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?;
            
            Ok(rows.iter().map(|row| ViewInfo {
                name: row.get("name"),
                schema: row.try_get("schema").ok(),
            }).collect())
        }
        DatabasePool::Sqlite(pool) => {
            let rows = sqlx::query(
                "SELECT name, 'main' as schema FROM sqlite_master 
                 WHERE type = 'view' AND name NOT LIKE 'sqlite_%'
                 ORDER BY name"
            )
            .fetch_all(&pool)
            .await
            .map_err(|e| DbError::QueryFailed(e.to_string()))?;
            
            Ok(rows.iter().map(|row| ViewInfo {
                name: row.get("name"),
                schema: row.try_get("schema").ok(),
            }).collect())
        }
    }
}

pub async fn get_indexes(
    connection_id: &str,
    table: &str,
    schema: Option<&str>,
) -> Result<Vec<IndexInfo>, DbError> {
    let pool = get_pool(connection_id).await?;
    
    match pool {
        DatabasePool::Postgres(pool) => {
            let schema_name = schema.unwrap_or("public");
            let query = format!(
                "SELECT 
                    i.relname as name,
                    ix.indisunique as is_unique,
                    ix.indisprimary as is_primary
                FROM pg_class t
                JOIN pg_index ix ON t.oid = ix.indrelid
                JOIN pg_class i ON i.oid = ix.indexrelid
                JOIN pg_namespace n ON n.oid = t.relnamespace
                WHERE t.relname = '{}' AND n.nspname = '{}'
                ORDER BY i.relname",
                table, schema_name
            );
            
            let rows = sqlx::query(&query)
                .fetch_all(&pool)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?;
            
            Ok(rows.iter().map(|row| IndexInfo {
                name: row.get("name"),
                is_unique: row.try_get("is_unique").unwrap_or(false),
                is_primary: row.try_get("is_primary").unwrap_or(false),
            }).collect())
        }
        DatabasePool::MySql(pool) => {
            let schema_clause = schema
                .map(|s| format!("TABLE_SCHEMA = '{}'", s))
                .unwrap_or_else(|| "TABLE_SCHEMA = DATABASE()".to_string());
            let query = format!(
                "SELECT 
                    CAST(INDEX_NAME AS CHAR) as name,
                    (NON_UNIQUE = 0) as is_unique,
                    (INDEX_NAME = 'PRIMARY') as is_primary
                FROM information_schema.STATISTICS
                WHERE {} AND TABLE_NAME = '{}'
                GROUP BY INDEX_NAME, NON_UNIQUE
                ORDER BY INDEX_NAME",
                schema_clause, table
            );
            
            let rows = sqlx::query(&query)
                .fetch_all(&pool)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?;
            
            Ok(rows.iter().map(|row| IndexInfo {
                name: row.get("name"),
                is_unique: row.try_get("is_unique").unwrap_or(false),
                is_primary: row.try_get("is_primary").unwrap_or(false),
            }).collect())
        }
        DatabasePool::Sqlite(pool) => {
            let query = format!("PRAGMA index_list('{}')", table);
            
            let rows = sqlx::query(&query)
                .fetch_all(&pool)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?;
            
            Ok(rows.iter().map(|row| {
                let name: String = row.get("name");
                let unique: i32 = row.get("unique");
                let origin: String = row.try_get("origin").unwrap_or_default();
                IndexInfo {
                    name,
                    is_unique: unique == 1,
                    is_primary: origin == "pk",
                }
            }).collect())
        }
    }
}

pub async fn get_functions(
    connection_id: &str,
    schema: Option<&str>,
) -> Result<Vec<FunctionInfo>, DbError> {
    let pool = get_pool(connection_id).await?;
    
    match pool {
        DatabasePool::Postgres(pool) => {
            let schema_name = schema.unwrap_or("public");
            let query = format!(
                "SELECT 
                    p.proname as name,
                    pg_catalog.pg_get_function_result(p.oid) as return_type,
                    n.nspname as schema
                FROM pg_catalog.pg_proc p
                JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = '{}'
                  AND p.prokind = 'f'
                ORDER BY p.proname",
                schema_name
            );
            
            let rows = sqlx::query(&query)
                .fetch_all(&pool)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?;
            
            Ok(rows.iter().map(|row| FunctionInfo {
                name: row.get("name"),
                return_type: row.try_get("return_type").ok(),
                schema: row.try_get("schema").ok(),
            }).collect())
        }
        DatabasePool::MySql(pool) => {
            let query = match schema {
                Some(s) if !s.is_empty() => format!(
                    "SELECT 
                        CAST(ROUTINE_NAME AS CHAR) as name,
                        CAST(DATA_TYPE AS CHAR) as return_type,
                        CAST(ROUTINE_SCHEMA AS CHAR) as `schema`
                    FROM information_schema.ROUTINES 
                    WHERE ROUTINE_SCHEMA = '{}' AND ROUTINE_TYPE = 'FUNCTION'
                    ORDER BY ROUTINE_NAME",
                    s
                ),
                _ => "SELECT 
                        CAST(ROUTINE_NAME AS CHAR) as name,
                        CAST(DATA_TYPE AS CHAR) as return_type,
                        CAST(ROUTINE_SCHEMA AS CHAR) as `schema`
                    FROM information_schema.ROUTINES 
                    WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_TYPE = 'FUNCTION'
                    ORDER BY ROUTINE_NAME".to_string(),
            };
            
            let rows = sqlx::query(&query)
                .fetch_all(&pool)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?;
            
            Ok(rows.iter().map(|row| FunctionInfo {
                name: row.get("name"),
                return_type: row.try_get("return_type").ok(),
                schema: row.try_get("schema").ok(),
            }).collect())
        }
        DatabasePool::Sqlite(_) => {
            // SQLite doesn't expose user-defined functions through SQL queries
            Ok(vec![])
        }
    }
}
