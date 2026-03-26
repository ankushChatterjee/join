use join_lib::db::{
    connect, disconnect, execute_query, get_columns, get_custom_types, get_foreign_keys,
    get_function_details, get_functions, get_indexes, get_schemas, get_tables, get_type_details,
    is_connected, test_connection, ConnectionConfig, DatabaseType,
};
use uuid::Uuid;

fn unique_id(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4())
}

fn sqlite_memory_config() -> ConnectionConfig {
    ConnectionConfig {
        id: unique_id("sqlite-memory"),
        name: "sqlite-memory".into(),
        db_type: DatabaseType::Sqlite,
        host: None,
        port: None,
        database: ":memory:".into(),
        username: None,
        ssl_mode: None,
    }
}

fn sqlite_file_config() -> (ConnectionConfig, std::path::PathBuf) {
    let db_path = std::env::temp_dir().join(format!("{}.db", unique_id("join-sqlite-it")));
    std::fs::File::create(&db_path).expect("create sqlite temp file");
    let config = ConnectionConfig {
        id: unique_id("sqlite-file"),
        name: "sqlite-file".into(),
        db_type: DatabaseType::Sqlite,
        host: None,
        port: None,
        database: db_path.to_string_lossy().to_string(),
        username: None,
        ssl_mode: None,
    };
    (config, db_path)
}

#[tokio::test]
async fn sqlite_schema_and_metadata_integration() {
    let config = sqlite_memory_config();
    let connection_id = config.id.clone();

    connect(&config, None).await.expect("connect sqlite");

    execute_query(
        &connection_id,
        r#"
        PRAGMA foreign_keys = ON;
        CREATE TABLE customers (
          id INTEGER PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL
        );
        CREATE TABLE orders (
          id INTEGER PRIMARY KEY,
          customer_id INTEGER NOT NULL,
          total REAL NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          FOREIGN KEY (customer_id) REFERENCES customers(id)
        );
        CREATE INDEX idx_orders_customer_id ON orders(customer_id);
        CREATE VIEW order_summary AS
          SELECT o.id, c.email, o.total
          FROM orders o
          JOIN customers c ON c.id = o.customer_id;
        INSERT INTO customers (id, email, created_at)
        VALUES (1, 'alice@example.com', '2026-01-01T00:00:00Z');
        INSERT INTO orders (id, customer_id, total, status)
        VALUES (10, 1, 49.99, 'paid');
        "#,
    )
    .await
    .expect("seed sqlite schema");

    let query = execute_query(
        &connection_id,
        "SELECT o.id, c.email, o.total FROM orders o JOIN customers c ON c.id = o.customer_id",
    )
    .await
    .expect("query seeded rows");
    assert_eq!(query.row_count, 1);
    assert_eq!(query.columns.len(), 3);
    assert_eq!(query.rows[0][0].as_i64(), Some(10));
    assert_eq!(query.rows[0][1].as_str(), Some("alice@example.com"));

    let schemas = get_schemas(&connection_id).await.expect("schemas");
    assert_eq!(schemas.len(), 1);
    assert_eq!(schemas[0].name, "main");

    let tables = get_tables(&connection_id, Some("main"))
        .await
        .expect("tables");
    assert!(tables.iter().any(|t| t.name == "customers"));
    assert!(tables.iter().any(|t| t.name == "orders"));

    let order_columns = get_columns(&connection_id, "orders", Some("main"))
        .await
        .expect("columns");
    assert!(order_columns
        .iter()
        .any(|c| c.name == "id" && c.is_primary_key));
    assert!(order_columns
        .iter()
        .any(|c| c.name == "customer_id" && !c.is_nullable));
    assert!(order_columns
        .iter()
        .any(|c| c.name == "status" && c.data_type.eq_ignore_ascii_case("TEXT")));

    let indexes = get_indexes(&connection_id, "orders", Some("main"))
        .await
        .expect("indexes");
    assert!(indexes.iter().any(|i| i.name == "idx_orders_customer_id"));

    let fks = get_foreign_keys(&connection_id, "orders", Some("main"))
        .await
        .expect("foreign keys");
    assert_eq!(fks.len(), 1);
    assert_eq!(fks[0].column_name, "customer_id");
    assert_eq!(fks[0].foreign_table_schema, "main");
    assert_eq!(fks[0].foreign_table_name, "customers");
    assert_eq!(fks[0].foreign_column_name, "id");

    let views = join_lib::db::get_views(&connection_id, Some("main"))
        .await
        .expect("views");
    assert!(views.iter().any(|v| v.name == "order_summary"));

    let functions = get_functions(&connection_id, Some("main"))
        .await
        .expect("sqlite functions");
    assert!(functions.is_empty());

    let custom_types = get_custom_types(&connection_id, Some("main"))
        .await
        .expect("sqlite custom types");
    assert!(custom_types.is_empty());

    let type_detail_err = get_type_details(&connection_id, "anything", Some("main"))
        .await
        .expect_err("sqlite type details should fail");
    assert!(type_detail_err
        .to_string()
        .contains("SQLite does not support custom types"));

    let function_detail_err = get_function_details(&connection_id, "fn_name", Some("main"))
        .await
        .expect_err("sqlite function details should fail");
    assert!(function_detail_err
        .to_string()
        .contains("SQLite does not support user-defined functions via SQL"));

    disconnect(&connection_id).await.expect("disconnect sqlite");
}

#[tokio::test]
async fn sqlite_connection_lifecycle_and_not_found_errors() {
    let config = sqlite_memory_config();
    let connection_id = config.id.clone();

    connect(&config, None).await.expect("connect sqlite");
    assert!(is_connected(&connection_id).await);

    disconnect(&connection_id).await.expect("disconnect sqlite");
    assert!(!is_connected(&connection_id).await);

    let query_err = execute_query(&connection_id, "SELECT 1")
        .await
        .expect_err("query should fail when disconnected");
    assert!(query_err.to_string().contains("Connection not found"));

    let schema_err = get_schemas(&connection_id)
        .await
        .expect_err("schema lookup should fail when disconnected");
    assert!(schema_err.to_string().contains("Connection not found"));

    // Idempotent no-op disconnect for unknown ID should still succeed.
    disconnect("missing-connection-id")
        .await
        .expect("disconnect unknown should not fail");
}

#[tokio::test]
async fn sqlite_file_database_persists_between_connections() {
    let (config, db_path) = sqlite_file_config();
    let connection_id = config.id.clone();

    test_connection(&config, None)
        .await
        .expect("sqlite file test_connection");

    connect(&config, None).await.expect("connect sqlite file");
    execute_query(
        &connection_id,
        r#"
        CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
        INSERT INTO items (id, name) VALUES (1, 'persisted');
        "#,
    )
    .await
    .expect("seed sqlite file");
    disconnect(&connection_id)
        .await
        .expect("disconnect first session");

    connect(&config, None).await.expect("reconnect sqlite file");
    let persisted = execute_query(&connection_id, "SELECT id, name FROM items")
        .await
        .expect("query persisted rows");
    assert_eq!(persisted.row_count, 1);
    assert_eq!(persisted.rows[0][0].as_i64(), Some(1));
    assert_eq!(persisted.rows[0][1].as_str(), Some("persisted"));

    disconnect(&connection_id)
        .await
        .expect("disconnect second session");

    let _ = std::fs::remove_file(db_path);
}
