use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use sqlx::{Column, Row, TypeInfo, ValueRef};
use std::time::Instant;

use super::{get_pool, DatabasePool, DbError};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<ColumnDef>,
    pub rows: Vec<Vec<JsonValue>>,
    pub row_count: usize,
    pub execution_time_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnDef {
    pub name: String,
    pub type_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_primary_key: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_indexed: Option<bool>,
}

pub async fn execute_query(connection_id: &str, sql: &str) -> Result<QueryResult, DbError> {
    let pool = get_pool(connection_id).await?;
    let start = Instant::now();
    
    match pool {
        DatabasePool::Postgres(pool) => {
            let rows = sqlx::query(sql)
                .fetch_all(&pool)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?;
            
            let execution_time_ms = start.elapsed().as_millis() as u64;
            
            if rows.is_empty() {
                return Ok(QueryResult {
                    columns: vec![],
                    rows: vec![],
                    row_count: 0,
                    execution_time_ms,
                });
            }
            
            let columns: Vec<ColumnDef> = rows[0]
                .columns()
                .iter()
                .map(|col| ColumnDef {
                    name: col.name().to_string(),
                    type_name: col.type_info().name().to_string(),
                    is_primary_key: None,
                    is_indexed: None,
                })
                .collect();
            
            let result_rows: Vec<Vec<JsonValue>> = rows
                .iter()
                .map(|row| convert_pg_row(row))
                .collect();
            
            let row_count = result_rows.len();
            
            Ok(QueryResult {
                columns,
                rows: result_rows,
                row_count,
                execution_time_ms,
            })
        }
        DatabasePool::MySql(pool) => {
            let rows = sqlx::query(sql)
                .fetch_all(&pool)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?;
            
            let execution_time_ms = start.elapsed().as_millis() as u64;
            
            if rows.is_empty() {
                return Ok(QueryResult {
                    columns: vec![],
                    rows: vec![],
                    row_count: 0,
                    execution_time_ms,
                });
            }
            
            let columns: Vec<ColumnDef> = rows[0]
                .columns()
                .iter()
                .map(|col| ColumnDef {
                    name: col.name().to_string(),
                    type_name: col.type_info().name().to_string(),
                    is_primary_key: None,
                    is_indexed: None,
                })
                .collect();
            
            let result_rows: Vec<Vec<JsonValue>> = rows
                .iter()
                .map(|row| convert_mysql_row(row))
                .collect();
            
            let row_count = result_rows.len();
            
            Ok(QueryResult {
                columns,
                rows: result_rows,
                row_count,
                execution_time_ms,
            })
        }
        DatabasePool::Sqlite(pool) => {
            let rows = sqlx::query(sql)
                .fetch_all(&pool)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?;
            
            let execution_time_ms = start.elapsed().as_millis() as u64;
            
            if rows.is_empty() {
                return Ok(QueryResult {
                    columns: vec![],
                    rows: vec![],
                    row_count: 0,
                    execution_time_ms,
                });
            }
            
            let columns: Vec<ColumnDef> = rows[0]
                .columns()
                .iter()
                .map(|col| ColumnDef {
                    name: col.name().to_string(),
                    type_name: col.type_info().name().to_string(),
                    is_primary_key: None,
                    is_indexed: None,
                })
                .collect();
            
            let result_rows: Vec<Vec<JsonValue>> = rows
                .iter()
                .map(|row| convert_sqlite_row(row))
                .collect();
            
            let row_count = result_rows.len();
            
            Ok(QueryResult {
                columns,
                rows: result_rows,
                row_count,
                execution_time_ms,
            })
        }
    }
}

fn convert_pg_row(row: &sqlx::postgres::PgRow) -> Vec<JsonValue> {
    row.columns()
        .iter()
        .enumerate()
        .map(|(i, col)| {
            let type_name = col.type_info().name().to_uppercase();
            
            // Handle NULL
            if let Ok(raw) = row.try_get_raw(i) {
                if raw.is_null() {
                    return JsonValue::Null;
                }
            }
            
            // Try common types
            if let Ok(v) = row.try_get::<i64, _>(i) {
                return json!(v);
            }
            if let Ok(v) = row.try_get::<i32, _>(i) {
                return json!(v);
            }
            if let Ok(v) = row.try_get::<i16, _>(i) {
                return json!(v);
            }
            if let Ok(v) = row.try_get::<f64, _>(i) {
                return json!(v);
            }
            if let Ok(v) = row.try_get::<f32, _>(i) {
                return json!(v);
            }
            if let Ok(v) = row.try_get::<bool, _>(i) {
                return json!(v);
            }
            if let Ok(v) = row.try_get::<String, _>(i) {
                return json!(v);
            }
            // PostgreSQL UUID
            if let Ok(v) = row.try_get::<uuid::Uuid, _>(i) {
                return json!(v.to_string());
            }
            // PostgreSQL timestamp
            if let Ok(v) = row.try_get::<chrono::NaiveDateTime, _>(i) {
                return json!(v.to_string());
            }
            if let Ok(v) = row.try_get::<chrono::DateTime<chrono::Utc>, _>(i) {
                return json!(v.to_string());
            }
            // PostgreSQL date
            if let Ok(v) = row.try_get::<chrono::NaiveDate, _>(i) {
                return json!(v.to_string());
            }
            // PostgreSQL time
            if let Ok(v) = row.try_get::<chrono::NaiveTime, _>(i) {
                return json!(v.to_string());
            }
            // PostgreSQL JSON/JSONB
            if let Ok(v) = row.try_get::<serde_json::Value, _>(i) {
                return v;
            }
            
            // Fallback
            json!(format!("[{}]", type_name))
        })
        .collect()
}

fn convert_mysql_row(row: &sqlx::mysql::MySqlRow) -> Vec<JsonValue> {
    row.columns()
        .iter()
        .enumerate()
        .map(|(i, col)| {
            let type_name = col.type_info().name().to_uppercase();
            
            // Handle NULL
            if let Ok(raw) = row.try_get_raw(i) {
                if raw.is_null() {
                    return JsonValue::Null;
                }
            }
            
            // Try common types
            if let Ok(v) = row.try_get::<i64, _>(i) {
                return json!(v);
            }
            if let Ok(v) = row.try_get::<i32, _>(i) {
                return json!(v);
            }
            if let Ok(v) = row.try_get::<f64, _>(i) {
                return json!(v);
            }
            if let Ok(v) = row.try_get::<bool, _>(i) {
                return json!(v);
            }
            if let Ok(v) = row.try_get::<String, _>(i) {
                return json!(v);
            }
            if let Ok(v) = row.try_get::<chrono::NaiveDateTime, _>(i) {
                return json!(v.to_string());
            }
            if let Ok(v) = row.try_get::<chrono::NaiveDate, _>(i) {
                return json!(v.to_string());
            }
            if let Ok(v) = row.try_get::<chrono::NaiveTime, _>(i) {
                return json!(v.to_string());
            }
            
            // Fallback
            json!(format!("[{}]", type_name))
        })
        .collect()
}

fn convert_sqlite_row(row: &sqlx::sqlite::SqliteRow) -> Vec<JsonValue> {
    row.columns()
        .iter()
        .enumerate()
        .map(|(i, col)| {
            let type_name = col.type_info().name().to_uppercase();
            
            // Handle NULL
            if let Ok(raw) = row.try_get_raw(i) {
                if raw.is_null() {
                    return JsonValue::Null;
                }
            }
            
            // SQLite has dynamic typing, try common types
            if let Ok(v) = row.try_get::<i64, _>(i) {
                return json!(v);
            }
            if let Ok(v) = row.try_get::<f64, _>(i) {
                return json!(v);
            }
            if let Ok(v) = row.try_get::<bool, _>(i) {
                return json!(v);
            }
            if let Ok(v) = row.try_get::<String, _>(i) {
                return json!(v);
            }
            if let Ok(v) = row.try_get::<Vec<u8>, _>(i) {
                // Return blob as base64
                return json!(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &v));
            }
            
            // Fallback
            json!(format!("[{}]", type_name))
        })
        .collect()
}

