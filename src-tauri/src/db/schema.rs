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
    pub comment: Option<String>,
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
pub struct ForeignKeyInfo {
    pub constraint_name: String,
    pub column_name: String,
    pub foreign_table_schema: String,
    pub foreign_table_name: String,
    pub foreign_column_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionInfo {
    pub name: String,
    pub return_type: Option<String>,
    pub schema: Option<String>,
    /// Unique identifier for the function (includes argument types for overloaded functions)
    pub specific_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomTypeInfo {
    pub name: String,
    pub schema: Option<String>,
    pub type_kind: String, // "enum", "composite", "domain", "set"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeFieldInfo {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeDetailInfo {
    pub name: String,
    pub schema: Option<String>,
    pub type_kind: String,
    pub values: Option<Vec<String>>,        // For ENUM/SET
    pub fields: Option<Vec<TypeFieldInfo>>, // For composite types
    pub base_type: Option<String>,          // For domains
    pub constraint: Option<String>,         // For domains
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionArgInfo {
    pub name: Option<String>,
    pub data_type: String,
    pub mode: String, // IN, OUT, INOUT, VARIADIC
    pub has_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionDetailInfo {
    pub name: String,
    pub schema: Option<String>,
    pub return_type: Option<String>,
    pub arguments: Vec<FunctionArgInfo>,
    pub language: Option<String>,
    pub definition: Option<String>,
    pub is_aggregate: bool,
    pub volatility: Option<String>, // IMMUTABLE, STABLE, VOLATILE
    pub description: Option<String>,
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
                    CASE 
                        WHEN c.data_type = 'USER-DEFINED' THEN c.udt_name
                        WHEN c.data_type = 'ARRAY' THEN SUBSTRING(c.udt_name FROM 2) || '[]'
                        ELSE c.data_type
                    END as data_type,
                    (c.is_nullable = 'YES') as is_nullable,
                    COALESCE(tc.constraint_type = 'PRIMARY KEY', false) as is_primary_key,
                    pgd.description as comment
                FROM information_schema.columns c
                LEFT JOIN information_schema.key_column_usage kcu 
                    ON c.table_schema = kcu.table_schema 
                    AND c.table_name = kcu.table_name 
                    AND c.column_name = kcu.column_name
                LEFT JOIN information_schema.table_constraints tc 
                    ON kcu.constraint_name = tc.constraint_name 
                    AND tc.constraint_type = 'PRIMARY KEY'
                LEFT JOIN pg_catalog.pg_class pc 
                    ON pc.relname = c.table_name
                    AND pc.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = c.table_schema)
                LEFT JOIN pg_catalog.pg_description pgd 
                    ON pgd.objoid = pc.oid 
                    AND pgd.objsubid = c.ordinal_position
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
                comment: row.try_get("comment").ok(),
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
                comment: None,
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
                comment: None,
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

pub async fn get_foreign_keys(
    connection_id: &str,
    table: &str,
    schema: Option<&str>,
) -> Result<Vec<ForeignKeyInfo>, DbError> {
    let pool = get_pool(connection_id).await?;

    match pool {
        DatabasePool::Postgres(pool) => {
            let schema_name = schema.unwrap_or("public");
            let query = format!(
                "SELECT
                    rc.constraint_name,
                    kcu.column_name,
                    ccu.table_schema AS foreign_table_schema,
                    ccu.table_name AS foreign_table_name,
                    ccu.column_name AS foreign_column_name
                FROM information_schema.referential_constraints rc
                JOIN information_schema.key_column_usage kcu
                    ON kcu.constraint_name = rc.constraint_name
                    AND kcu.table_schema = rc.constraint_schema
                JOIN information_schema.constraint_column_usage ccu
                    ON ccu.constraint_name = rc.unique_constraint_name
                    AND ccu.table_schema = rc.unique_constraint_schema
                WHERE kcu.table_schema = '{}' AND kcu.table_name = '{}'
                ORDER BY rc.constraint_name, kcu.ordinal_position",
                schema_name, table
            );

            let rows = sqlx::query(&query)
                .fetch_all(&pool)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?;

            Ok(rows.iter().map(|row| ForeignKeyInfo {
                constraint_name: row.get("constraint_name"),
                column_name: row.get("column_name"),
                foreign_table_schema: row.get("foreign_table_schema"),
                foreign_table_name: row.get("foreign_table_name"),
                foreign_column_name: row.get("foreign_column_name"),
            }).collect())
        }
        DatabasePool::MySql(pool) => {
            let schema_clause = schema
                .map(|s| format!("TABLE_SCHEMA = '{}'", s))
                .unwrap_or_else(|| "TABLE_SCHEMA = DATABASE()".to_string());
            let query = format!(
                "SELECT
                    CAST(CONSTRAINT_NAME AS CHAR) as constraint_name,
                    CAST(COLUMN_NAME AS CHAR) as column_name,
                    CAST(REFERENCED_TABLE_SCHEMA AS CHAR) as foreign_table_schema,
                    CAST(REFERENCED_TABLE_NAME AS CHAR) as foreign_table_name,
                    CAST(REFERENCED_COLUMN_NAME AS CHAR) as foreign_column_name
                FROM information_schema.KEY_COLUMN_USAGE
                WHERE {} AND TABLE_NAME = '{}'
                  AND REFERENCED_TABLE_NAME IS NOT NULL
                ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION",
                schema_clause, table
            );

            let rows = sqlx::query(&query)
                .fetch_all(&pool)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?;

            Ok(rows.iter().map(|row| ForeignKeyInfo {
                constraint_name: row.get("constraint_name"),
                column_name: row.get("column_name"),
                foreign_table_schema: row.get("foreign_table_schema"),
                foreign_table_name: row.get("foreign_table_name"),
                foreign_column_name: row.get("foreign_column_name"),
            }).collect())
        }
        DatabasePool::Sqlite(pool) => {
            // PRAGMA foreign_key_list returns: id, seq, table, from, to, on_update, on_delete, match
            let query = format!("PRAGMA foreign_key_list('{}')", table);

            let rows = sqlx::query(&query)
                .fetch_all(&pool)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?;

            Ok(rows.iter().enumerate().map(|(i, row)| {
                let foreign_table: String = row.get("table");
                let from_col: String = row.get("from");
                let to_col: String = row.get("to");
                ForeignKeyInfo {
                    constraint_name: format!("fk_{}_{}", table, i),
                    column_name: from_col,
                    foreign_table_schema: "main".to_string(),
                    foreign_table_name: foreign_table,
                    foreign_column_name: to_col,
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
                    n.nspname as schema,
                    p.proname || '(' || COALESCE(pg_catalog.pg_get_function_identity_arguments(p.oid), '') || ')' as specific_name
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
                specific_name: row.get("specific_name"),
            }).collect())
        }
        DatabasePool::MySql(pool) => {
            let query = match schema {
                Some(s) if !s.is_empty() => format!(
                    "SELECT 
                        CAST(ROUTINE_NAME AS CHAR) as name,
                        CAST(DATA_TYPE AS CHAR) as return_type,
                        CAST(ROUTINE_SCHEMA AS CHAR) as `schema`,
                        CAST(SPECIFIC_NAME AS CHAR) as specific_name
                    FROM information_schema.ROUTINES 
                    WHERE ROUTINE_SCHEMA = '{}' AND ROUTINE_TYPE = 'FUNCTION'
                    ORDER BY ROUTINE_NAME",
                    s
                ),
                _ => "SELECT 
                        CAST(ROUTINE_NAME AS CHAR) as name,
                        CAST(DATA_TYPE AS CHAR) as return_type,
                        CAST(ROUTINE_SCHEMA AS CHAR) as `schema`,
                        CAST(SPECIFIC_NAME AS CHAR) as specific_name
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
                specific_name: row.get("specific_name"),
            }).collect())
        }
        DatabasePool::Sqlite(_) => {
            // SQLite doesn't expose user-defined functions through SQL queries
            Ok(vec![])
        }
    }
}

pub async fn get_custom_types(
    connection_id: &str,
    schema: Option<&str>,
) -> Result<Vec<CustomTypeInfo>, DbError> {
    let pool = get_pool(connection_id).await?;

    match pool {
        DatabasePool::Postgres(pool) => {
            let schema_name = schema.unwrap_or("public");
            let query = format!(
                "SELECT 
                    t.typname as name,
                    n.nspname as schema,
                    CASE 
                        WHEN t.typtype = 'e' THEN 'enum'
                        WHEN t.typtype = 'c' THEN 'composite'
                        WHEN t.typtype = 'd' THEN 'domain'
                        ELSE 'other'
                    END as type_kind
                FROM pg_type t
                JOIN pg_namespace n ON n.oid = t.typnamespace
                WHERE n.nspname = '{}'
                  AND t.typtype IN ('e', 'c', 'd')
                  AND NOT EXISTS (
                      SELECT 1 FROM pg_class c WHERE c.reltype = t.oid AND c.relkind = 'r'
                  )
                ORDER BY t.typname",
                schema_name
            );

            let rows = sqlx::query(&query)
                .fetch_all(&pool)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?;

            Ok(rows
                .iter()
                .map(|row| CustomTypeInfo {
                    name: row.get("name"),
                    schema: row.try_get("schema").ok(),
                    type_kind: row.get("type_kind"),
                })
                .collect())
        }
        DatabasePool::MySql(pool) => {
            // MySQL doesn't have standalone types, but we can extract ENUM/SET definitions from columns
            let query = match schema {
                Some(s) if !s.is_empty() => format!(
                    "SELECT DISTINCT
                        CAST(COLUMN_TYPE AS CHAR) as column_type,
                        CAST(DATA_TYPE AS CHAR) as data_type,
                        CAST(TABLE_SCHEMA AS CHAR) as `schema`
                    FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = '{}' 
                      AND DATA_TYPE IN ('enum', 'set')
                    ORDER BY COLUMN_TYPE",
                    s
                ),
                _ => "SELECT DISTINCT
                        CAST(COLUMN_TYPE AS CHAR) as column_type,
                        CAST(DATA_TYPE AS CHAR) as data_type,
                        CAST(TABLE_SCHEMA AS CHAR) as `schema`
                    FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE() 
                      AND DATA_TYPE IN ('enum', 'set')
                    ORDER BY COLUMN_TYPE"
                    .to_string(),
            };

            let rows = sqlx::query(&query)
                .fetch_all(&pool)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?;

            Ok(rows
                .iter()
                .map(|row| {
                    let column_type: String = row.get("column_type");
                    let data_type: String = row.get("data_type");
                    CustomTypeInfo {
                        name: column_type.clone(),
                        schema: row.try_get("schema").ok(),
                        type_kind: data_type.to_lowercase(),
                    }
                })
                .collect())
        }
        DatabasePool::Sqlite(_) => {
            // SQLite doesn't have custom types
            Ok(vec![])
        }
    }
}

pub async fn get_type_details(
    connection_id: &str,
    type_name: &str,
    schema: Option<&str>,
) -> Result<TypeDetailInfo, DbError> {
    let pool = get_pool(connection_id).await?;

    match pool {
        DatabasePool::Postgres(pool) => {
            let schema_name = schema.unwrap_or("public");

            // First, get the type info to determine its kind
            let type_query = format!(
                "SELECT 
                    t.typname as name,
                    n.nspname as schema,
                    t.typtype::text as typtype,
                    t.typbasetype,
                    pg_catalog.format_type(t.typbasetype, t.typtypmod) as base_type_name
                FROM pg_type t
                JOIN pg_namespace n ON n.oid = t.typnamespace
                WHERE n.nspname = '{}' AND t.typname = '{}'",
                schema_name, type_name
            );

            let type_row = sqlx::query(&type_query)
                .fetch_optional(&pool)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?
                .ok_or_else(|| DbError::QueryFailed(format!("Type '{}' not found", type_name)))?;

            let typtype: String = type_row.get("typtype");

            match typtype.as_str() {
                "e" => {
                    // ENUM type - get values
                    let values_query = format!(
                        "SELECT e.enumlabel as value
                        FROM pg_enum e
                        JOIN pg_type t ON t.oid = e.enumtypid
                        JOIN pg_namespace n ON n.oid = t.typnamespace
                        WHERE n.nspname = '{}' AND t.typname = '{}'
                        ORDER BY e.enumsortorder",
                        schema_name, type_name
                    );

                    let value_rows = sqlx::query(&values_query)
                        .fetch_all(&pool)
                        .await
                        .map_err(|e| DbError::QueryFailed(e.to_string()))?;

                    let values: Vec<String> =
                        value_rows.iter().map(|r| r.get("value")).collect();

                    Ok(TypeDetailInfo {
                        name: type_name.to_string(),
                        schema: Some(schema_name.to_string()),
                        type_kind: "enum".to_string(),
                        values: Some(values),
                        fields: None,
                        base_type: None,
                        constraint: None,
                    })
                }
                "c" => {
                    // Composite type - get fields
                    let fields_query = format!(
                        "SELECT 
                            a.attname as name,
                            pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type
                        FROM pg_attribute a
                        JOIN pg_type t ON t.typrelid = a.attrelid
                        JOIN pg_namespace n ON n.oid = t.typnamespace
                        WHERE n.nspname = '{}' AND t.typname = '{}' AND a.attnum > 0
                        ORDER BY a.attnum",
                        schema_name, type_name
                    );

                    let field_rows = sqlx::query(&fields_query)
                        .fetch_all(&pool)
                        .await
                        .map_err(|e| DbError::QueryFailed(e.to_string()))?;

                    let fields: Vec<TypeFieldInfo> = field_rows
                        .iter()
                        .map(|r| TypeFieldInfo {
                            name: r.get("name"),
                            data_type: r.get("data_type"),
                        })
                        .collect();

                    Ok(TypeDetailInfo {
                        name: type_name.to_string(),
                        schema: Some(schema_name.to_string()),
                        type_kind: "composite".to_string(),
                        values: None,
                        fields: Some(fields),
                        base_type: None,
                        constraint: None,
                    })
                }
                "d" => {
                    // Domain type - get base type and constraint
                    let base_type: Option<String> = type_row.try_get("base_type_name").ok();

                    // Get domain constraint if any
                    let constraint_query = format!(
                        "SELECT pg_get_constraintdef(c.oid) as constraint_def
                        FROM pg_constraint c
                        JOIN pg_type t ON t.oid = c.contypid
                        JOIN pg_namespace n ON n.oid = t.typnamespace
                        WHERE n.nspname = '{}' AND t.typname = '{}'",
                        schema_name, type_name
                    );

                    let constraint_row = sqlx::query(&constraint_query)
                        .fetch_optional(&pool)
                        .await
                        .map_err(|e| DbError::QueryFailed(e.to_string()))?;

                    let constraint: Option<String> =
                        constraint_row.and_then(|r| r.try_get("constraint_def").ok());

                    Ok(TypeDetailInfo {
                        name: type_name.to_string(),
                        schema: Some(schema_name.to_string()),
                        type_kind: "domain".to_string(),
                        values: None,
                        fields: None,
                        base_type,
                        constraint,
                    })
                }
                _ => Err(DbError::QueryFailed(format!(
                    "Unknown type kind: {}",
                    typtype
                ))),
            }
        }
        DatabasePool::MySql(_pool) => {
            // For MySQL, the type_name is the full column_type like "enum('a','b','c')"
            let type_kind = if type_name.to_lowercase().starts_with("enum") {
                "enum"
            } else if type_name.to_lowercase().starts_with("set") {
                "set"
            } else {
                return Err(DbError::QueryFailed(format!(
                    "Unknown MySQL type: {}",
                    type_name
                )));
            };

            // Parse values from the type definition
            // e.g., "enum('value1','value2')" -> ["value1", "value2"]
            let values = parse_mysql_enum_set_values(type_name);

            Ok(TypeDetailInfo {
                name: type_name.to_string(),
                schema: schema.map(|s| s.to_string()),
                type_kind: type_kind.to_string(),
                values: Some(values),
                fields: None,
                base_type: None,
                constraint: None,
            })
        }
        DatabasePool::Sqlite(_) => Err(DbError::QueryFailed(
            "SQLite does not support custom types".to_string(),
        )),
    }
}

/// Parse MySQL ENUM or SET values from column type definition
/// e.g., "enum('a','b','c')" -> ["a", "b", "c"]
fn parse_mysql_enum_set_values(type_def: &str) -> Vec<String> {
    // Find the content between parentheses
    if let Some(start) = type_def.find('(') {
        if let Some(end) = type_def.rfind(')') {
            let content = &type_def[start + 1..end];
            // Split by comma and remove quotes
            return content
                .split(',')
                .map(|s| s.trim().trim_matches('\'').to_string())
                .collect();
        }
    }
    vec![]
}

pub async fn get_function_details(
    connection_id: &str,
    function_name: &str,
    schema: Option<&str>,
) -> Result<FunctionDetailInfo, DbError> {
    let pool = get_pool(connection_id).await?;

    match pool {
        DatabasePool::Postgres(pool) => {
            let schema_name = schema.unwrap_or("public");

            // Get function details including arguments and definition
            let query = format!(
                r#"SELECT 
                    p.proname as name,
                    n.nspname as schema,
                    pg_catalog.pg_get_function_result(p.oid) as return_type,
                    pg_catalog.pg_get_function_arguments(p.oid) as arguments_text,
                    l.lanname as language,
                    pg_catalog.pg_get_functiondef(p.oid) as definition,
                    p.prokind = 'a' as is_aggregate,
                    CASE p.provolatile
                        WHEN 'i' THEN 'IMMUTABLE'
                        WHEN 's' THEN 'STABLE'
                        WHEN 'v' THEN 'VOLATILE'
                    END as volatility,
                    d.description
                FROM pg_catalog.pg_proc p
                JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                JOIN pg_catalog.pg_language l ON l.oid = p.prolang
                LEFT JOIN pg_catalog.pg_description d ON d.objoid = p.oid AND d.classoid = 'pg_proc'::regclass
                WHERE n.nspname = '{}' AND p.proname = '{}'
                LIMIT 1"#,
                schema_name, function_name
            );

            let row = sqlx::query(&query)
                .fetch_optional(&pool)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?
                .ok_or_else(|| {
                    DbError::QueryFailed(format!("Function '{}' not found", function_name))
                })?;

            // Parse arguments from the arguments_text
            let arguments_text: Option<String> = row.try_get("arguments_text").ok();
            let arguments = parse_postgres_function_arguments(arguments_text.as_deref());

            Ok(FunctionDetailInfo {
                name: row.get("name"),
                schema: row.try_get("schema").ok(),
                return_type: row.try_get("return_type").ok(),
                arguments,
                language: row.try_get("language").ok(),
                definition: row.try_get("definition").ok(),
                is_aggregate: row.try_get("is_aggregate").unwrap_or(false),
                volatility: row.try_get("volatility").ok(),
                description: row.try_get("description").ok(),
            })
        }
        DatabasePool::MySql(pool) => {
            let query = match schema {
                Some(s) if !s.is_empty() => format!(
                    r#"SELECT 
                        CAST(ROUTINE_NAME AS CHAR) as name,
                        CAST(ROUTINE_SCHEMA AS CHAR) as `schema`,
                        CAST(DATA_TYPE AS CHAR) as return_type,
                        CAST(ROUTINE_DEFINITION AS CHAR) as definition,
                        CAST(ROUTINE_COMMENT AS CHAR) as description
                    FROM information_schema.ROUTINES 
                    WHERE ROUTINE_SCHEMA = '{}' AND ROUTINE_NAME = '{}' AND ROUTINE_TYPE = 'FUNCTION'
                    LIMIT 1"#,
                    s, function_name
                ),
                _ => format!(
                    r#"SELECT 
                        CAST(ROUTINE_NAME AS CHAR) as name,
                        CAST(ROUTINE_SCHEMA AS CHAR) as `schema`,
                        CAST(DATA_TYPE AS CHAR) as return_type,
                        CAST(ROUTINE_DEFINITION AS CHAR) as definition,
                        CAST(ROUTINE_COMMENT AS CHAR) as description
                    FROM information_schema.ROUTINES 
                    WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = '{}' AND ROUTINE_TYPE = 'FUNCTION'
                    LIMIT 1"#,
                    function_name
                ),
            };

            let row = sqlx::query(&query)
                .fetch_optional(&pool)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?
                .ok_or_else(|| {
                    DbError::QueryFailed(format!("Function '{}' not found", function_name))
                })?;

            // Get function parameters
            let params_query = match schema {
                Some(s) if !s.is_empty() => format!(
                    r#"SELECT 
                        CAST(PARAMETER_NAME AS CHAR) as name,
                        CAST(DATA_TYPE AS CHAR) as data_type,
                        CAST(PARAMETER_MODE AS CHAR) as mode
                    FROM information_schema.PARAMETERS
                    WHERE SPECIFIC_SCHEMA = '{}' AND SPECIFIC_NAME = '{}' AND ORDINAL_POSITION > 0
                    ORDER BY ORDINAL_POSITION"#,
                    s, function_name
                ),
                _ => format!(
                    r#"SELECT 
                        CAST(PARAMETER_NAME AS CHAR) as name,
                        CAST(DATA_TYPE AS CHAR) as data_type,
                        CAST(PARAMETER_MODE AS CHAR) as mode
                    FROM information_schema.PARAMETERS
                    WHERE SPECIFIC_SCHEMA = DATABASE() AND SPECIFIC_NAME = '{}' AND ORDINAL_POSITION > 0
                    ORDER BY ORDINAL_POSITION"#,
                    function_name
                ),
            };

            let param_rows = sqlx::query(&params_query)
                .fetch_all(&pool)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?;

            let arguments: Vec<FunctionArgInfo> = param_rows
                .iter()
                .map(|r| FunctionArgInfo {
                    name: r.try_get("name").ok(),
                    data_type: r.get("data_type"),
                    mode: r.try_get("mode").unwrap_or_else(|_| "IN".to_string()),
                    has_default: false,
                })
                .collect();

            Ok(FunctionDetailInfo {
                name: row.get("name"),
                schema: row.try_get("schema").ok(),
                return_type: row.try_get("return_type").ok(),
                arguments,
                language: Some("SQL".to_string()),
                definition: row.try_get("definition").ok(),
                is_aggregate: false,
                volatility: None,
                description: row.try_get("description").ok(),
            })
        }
        DatabasePool::Sqlite(_) => Err(DbError::QueryFailed(
            "SQLite does not support user-defined functions via SQL".to_string(),
        )),
    }
}

/// Parse PostgreSQL function arguments from pg_get_function_arguments output
/// e.g., "a integer, b text DEFAULT 'hello'" -> Vec<FunctionArgInfo>
fn parse_postgres_function_arguments(args_text: Option<&str>) -> Vec<FunctionArgInfo> {
    let Some(text) = args_text else {
        return vec![];
    };

    if text.trim().is_empty() {
        return vec![];
    }

    // Split by comma, but be careful about commas inside parentheses (e.g., numeric(10,2))
    let mut arguments = Vec::new();
    let mut current = String::new();
    let mut paren_depth = 0;

    for ch in text.chars() {
        match ch {
            '(' => {
                paren_depth += 1;
                current.push(ch);
            }
            ')' => {
                paren_depth -= 1;
                current.push(ch);
            }
            ',' if paren_depth == 0 => {
                if !current.trim().is_empty() {
                    if let Some(arg) = parse_single_postgres_argument(&current) {
                        arguments.push(arg);
                    }
                }
                current.clear();
            }
            _ => current.push(ch),
        }
    }

    // Don't forget the last argument
    if !current.trim().is_empty() {
        if let Some(arg) = parse_single_postgres_argument(&current) {
            arguments.push(arg);
        }
    }

    arguments
}

/// Parse a single PostgreSQL function argument
/// e.g., "a integer" or "OUT result text" or "b text DEFAULT 'hello'"
fn parse_single_postgres_argument(arg: &str) -> Option<FunctionArgInfo> {
    let trimmed = arg.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Check for mode prefix
    let (mode, rest) = if trimmed.to_uppercase().starts_with("OUT ") {
        ("OUT".to_string(), trimmed[4..].trim())
    } else if trimmed.to_uppercase().starts_with("INOUT ") {
        ("INOUT".to_string(), trimmed[6..].trim())
    } else if trimmed.to_uppercase().starts_with("VARIADIC ") {
        ("VARIADIC".to_string(), trimmed[9..].trim())
    } else if trimmed.to_uppercase().starts_with("IN ") {
        ("IN".to_string(), trimmed[3..].trim())
    } else {
        ("IN".to_string(), trimmed)
    };

    // Check for DEFAULT
    let has_default = rest.to_uppercase().contains(" DEFAULT ");
    let without_default = if has_default {
        rest.split_once(" DEFAULT ")
            .or_else(|| rest.split_once(" default "))
            .map(|(before, _)| before)
            .unwrap_or(rest)
    } else {
        rest
    };

    // Split into name and type
    let parts: Vec<&str> = without_default.split_whitespace().collect();
    if parts.is_empty() {
        return None;
    }

    // If only one part, it's just the type (no name)
    let (name, data_type) = if parts.len() == 1 {
        (None, parts[0].to_string())
    } else {
        // First part is name, rest is type
        (Some(parts[0].to_string()), parts[1..].join(" "))
    };

    Some(FunctionArgInfo {
        name,
        data_type,
        mode,
        has_default,
    })
}

#[cfg(test)]
mod tests {
    use super::{parse_mysql_enum_set_values, parse_postgres_function_arguments, ColumnInfo};
    use serde_json;

    #[test]
    fn parses_mysql_enum_values() {
        let values = parse_mysql_enum_set_values("enum('pending','paid','shipped')");
        assert_eq!(values, vec!["pending", "paid", "shipped"]);
    }

    #[test]
    fn parses_mysql_set_values() {
        let values = parse_mysql_enum_set_values("set('a','b','c')");
        assert_eq!(values, vec!["a", "b", "c"]);
    }

    #[test]
    fn column_info_serializes_with_comment() {
        let col = ColumnInfo {
            name: "status".to_string(),
            data_type: "text".to_string(),
            is_nullable: true,
            is_primary_key: false,
            comment: Some("Order status column".to_string()),
        };
        let json = serde_json::to_string(&col).unwrap();
        let parsed: ColumnInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, "status");
        assert_eq!(parsed.comment, Some("Order status column".to_string()));
    }

    #[test]
    fn column_info_serializes_without_comment() {
        let col = ColumnInfo {
            name: "id".to_string(),
            data_type: "integer".to_string(),
            is_nullable: false,
            is_primary_key: true,
            comment: None,
        };
        let json = serde_json::to_string(&col).unwrap();
        let parsed: ColumnInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, "id");
        assert_eq!(parsed.comment, None);
    }

    #[test]
    fn parses_postgres_function_arguments_with_modes_and_defaults() {
        let parsed = parse_postgres_function_arguments(Some(
            "a integer, OUT result text, b numeric(10,2) DEFAULT 0, VARIADIC tags text[]",
        ));

        assert_eq!(parsed.len(), 4);
        assert_eq!(parsed[0].name.as_deref(), Some("a"));
        assert_eq!(parsed[0].data_type, "integer");
        assert_eq!(parsed[0].mode, "IN");
        assert!(!parsed[0].has_default);

        assert_eq!(parsed[1].name.as_deref(), Some("result"));
        assert_eq!(parsed[1].data_type, "text");
        assert_eq!(parsed[1].mode, "OUT");
        assert!(!parsed[1].has_default);

        assert_eq!(parsed[2].name.as_deref(), Some("b"));
        assert_eq!(parsed[2].data_type, "numeric(10,2)");
        assert_eq!(parsed[2].mode, "IN");
        assert!(parsed[2].has_default);

        assert_eq!(parsed[3].name.as_deref(), Some("tags"));
        assert_eq!(parsed[3].data_type, "text[]");
        assert_eq!(parsed[3].mode, "VARIADIC");
    }
}
