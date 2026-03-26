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
            // Detect multi-statement SQL (contains ';' not just as a trailing terminator).
            // Prepared statements (query()) don't support multiple commands, so we fall back
            // to raw_sql for that case. Using query() is preferred because it uses the
            // extended query protocol which resolves custom type OIDs (e.g. ENUMs, composite
            // types) against pg_type, returning the real type name instead of "?".
            let is_multi_stmt = {
                let trimmed = sql.trim().trim_end_matches(';');
                trimmed.contains(';')
            };

            let rows = if is_multi_stmt {
                sqlx::raw_sql(sql)
                    .fetch_all(&pool)
                    .await
                    .map_err(|e| DbError::QueryFailed(e.to_string()))?
            } else {
                sqlx::query(sql)
                    .fetch_all(&pool)
                    .await
                    .map_err(|e| DbError::QueryFailed(e.to_string()))?
            };

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

            let result_rows: Vec<Vec<JsonValue>> = rows.iter().map(convert_pg_row).collect();

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

            let result_rows: Vec<Vec<JsonValue>> = rows.iter().map(convert_mysql_row).collect();

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

            let result_rows: Vec<Vec<JsonValue>> = rows.iter().map(convert_sqlite_row).collect();

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
            // PostgreSQL JSON/JSONB only.
            // Keep this narrowly scoped so non-JSON custom types (e.g. composite)
            // still flow through composite normalization logic below.
            if type_name == "JSON" || type_name == "JSONB" {
                if let Ok(v) = row.try_get::<serde_json::Value, _>(i) {
                    return v;
                }
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
                    // Check if this is binary composite format (contains null bytes)
                    if bytes.len() >= 4 && bytes[0..4].contains(&0) {
                        // Binary composite format: parse it
                        if let Some(parsed) = parse_binary_composite(bytes, &type_name) {
                            return parsed;
                        }
                    }

                    if let Ok(text) = std::str::from_utf8(bytes) {
                        // For composite types, normalize both raw "(...)" and quoted "\"(...)\"" forms.
                        if let Some(raw_composite) = normalize_composite_raw(text) {
                            return json!({
                                "_type": type_name.to_lowercase(),
                                "_raw": raw_composite,
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
                // Composite types can arrive here with the extended protocol as raw
                // "(...)" text. Normalize them to the same object shape used above.
                if let Some(raw_composite) = normalize_composite_raw(&v) {
                    return json!({
                        "_type": type_name.to_lowercase(),
                        "_raw": raw_composite,
                        "_display": "composite"
                    });
                }
                return json!(v);
            }

            // Fallback
            json!(format!("[{}]", type_name))
        })
        .collect()
}

fn normalize_composite_raw(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.starts_with('(') && trimmed.ends_with(')') {
        return Some(trimmed.to_string());
    }

    // Some decode paths can wrap the record text in quotes: "\"(a,b)\""
    if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        let inner = &trimmed[1..trimmed.len() - 1];
        if inner.starts_with('(') && inner.ends_with(')') {
            return Some(inner.to_string());
        }
    }

    None
}

/// Parse PostgreSQL binary composite format into a JSON representation.
/// Binary format: [4-byte field count][for each field: 4-byte type OID][4-byte length][data]
fn parse_binary_composite(bytes: &[u8], type_name: &str) -> Option<JsonValue> {
    if bytes.len() < 4 {
        return None;
    }

    // Read field count (big-endian u32)
    let field_count = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;

    let mut fields = Vec::with_capacity(field_count);
    let mut offset = 4;

    for _ in 0..field_count {
        // Need at least 8 more bytes (OID + length)
        if offset + 8 > bytes.len() {
            return None;
        }

        // Skip 4-byte type OID
        offset += 4;

        // Read 4-byte length (big-endian i32, -1 means NULL)
        let length = i32::from_be_bytes([
            bytes[offset],
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3],
        ]);
        offset += 4;

        if length < 0 {
            // NULL field
            fields.push("NULL".to_string());
        } else {
            let len = length as usize;
            if offset + len > bytes.len() {
                return None;
            }

            // Try to decode as UTF-8 text
            let field_data = &bytes[offset..offset + len];
            let field_str = std::str::from_utf8(field_data).unwrap_or("[binary]");
            fields.push(field_str.to_string());
            offset += len;
        }
    }

    // Build text representation: (field1,field2,...)
    let text_repr = format!("({})", fields.join(","));

    Some(json!({
        "_type": type_name.to_lowercase(),
        "_raw": text_repr,
        "_display": "composite"
    }))
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
                return json!(base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    &v
                ));
            }

            // Fallback
            json!(format!("[{}]", type_name))
        })
        .collect()
}
