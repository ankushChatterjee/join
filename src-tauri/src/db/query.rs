use rust_decimal::Decimal;
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
            let rows = sqlx::raw_sql(sql)
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
                    type_name: std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        col.type_info().name().to_string()
                    }))
                    .unwrap_or_else(|_| "unknown".to_string()),
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
            let rows = sqlx::raw_sql(sql)
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
            let rows = sqlx::raw_sql(sql)
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
            // Some custom PostgreSQL types can surface unresolved OIDs in sqlx;
            // guard name resolution so result conversion stays resilient.
            let type_name = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                col.type_info().name().to_uppercase()
            }))
            .unwrap_or_else(|_| "UNKNOWN".to_string());
            let is_array_like = type_name.ends_with("[]") || type_name.starts_with('_');
            
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
            // PostgreSQL NUMERIC / DECIMAL (arbitrary precision)
            if let Ok(v) = row.try_get::<Decimal, _>(i) {
                // Serialize as a JSON number string to preserve full precision
                // (JSON Number can lose precision for very large decimals)
                return json!(v.to_string());
            }
            if let Ok(v) = row.try_get::<bool, _>(i) {
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
            
            // PostgreSQL arrays - try common array types (only on array-like OIDs)
            if is_array_like {
                // Integer arrays
                if let Ok(v) = row.try_get::<Vec<i64>, _>(i) {
                    return json!(v);
                }
                if let Ok(v) = row.try_get::<Vec<i32>, _>(i) {
                    return json!(v);
                }
                if let Ok(v) = row.try_get::<Vec<i16>, _>(i) {
                    return json!(v);
                }
                // Float arrays
                if let Ok(v) = row.try_get::<Vec<f64>, _>(i) {
                    return json!(v);
                }
                if let Ok(v) = row.try_get::<Vec<f32>, _>(i) {
                    return json!(v);
                }
                // String/text arrays
                if let Ok(v) = row.try_get::<Vec<String>, _>(i) {
                    return json!(v);
                }
                // Boolean arrays
                if let Ok(v) = row.try_get::<Vec<bool>, _>(i) {
                    return json!(v);
                }
                // UUID arrays
                if let Ok(v) = row.try_get::<Vec<uuid::Uuid>, _>(i) {
                    return json!(v.iter().map(|u| u.to_string()).collect::<Vec<_>>());
                }
                // Timestamp arrays
                if let Ok(v) = row.try_get::<Vec<chrono::NaiveDateTime>, _>(i) {
                    return json!(v.iter().map(|t| t.to_string()).collect::<Vec<_>>());
                }
                if let Ok(v) = row.try_get::<Vec<chrono::DateTime<chrono::Utc>>, _>(i) {
                    return json!(v.iter().map(|t| t.to_string()).collect::<Vec<_>>());
                }
                // Date arrays
                if let Ok(v) = row.try_get::<Vec<chrono::NaiveDate>, _>(i) {
                    return json!(v.iter().map(|d| d.to_string()).collect::<Vec<_>>());
                }
                // Time arrays
                if let Ok(v) = row.try_get::<Vec<chrono::NaiveTime>, _>(i) {
                    return json!(v.iter().map(|t| t.to_string()).collect::<Vec<_>>());
                }
            }
            
            // For custom types (enums, composite types, domains), try to get raw bytes as text
            // PostgreSQL sends custom types in text format when using the simple query protocol
            if let Ok(raw) = row.try_get_raw(i) {
                // Try to decode as UTF-8 text from the raw value
                if let Ok(bytes) = raw.as_bytes() {
                    if let Ok(text) = std::str::from_utf8(bytes) {
                        // For composite types, convert (a,b,c) format to JSON object
                        if text.starts_with('(') && text.ends_with(')') {
                            return json!({
                                "_type": type_name.to_lowercase(),
                                "_raw": text,
                                "_display": "composite"
                            });
                        }
                        // For enums and other types, just return the text
                        return json!(text);
                    }
                }
            }

            // Fallback textual decode for types not covered above.
            if let Ok(v) = row.try_get::<String, _>(i) {
                return json!(v);
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
            // MySQL JSON type
            if let Ok(v) = row.try_get::<serde_json::Value, _>(i) {
                return v;
            }
            if let Ok(v) = row.try_get::<String, _>(i) {
                // Try to parse JSON arrays/objects stored as text
                let trimmed = v.trim();
                if (trimmed.starts_with('[') && trimmed.ends_with(']'))
                    || (trimmed.starts_with('{') && trimmed.ends_with('}'))
                {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&v) {
                        return parsed;
                    }
                }
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
                // Try to parse JSON arrays/objects stored as text
                let trimmed = v.trim();
                if (trimmed.starts_with('[') && trimmed.ends_with(']'))
                    || (trimmed.starts_with('{') && trimmed.ends_with('}'))
                {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&v) {
                        return parsed;
                    }
                }
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
