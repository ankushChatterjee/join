use join_lib::db::{
    connect, disconnect, execute_query, get_columns, get_custom_types, get_foreign_keys,
    get_function_details, get_functions, get_indexes, get_schemas, get_tables, get_type_details,
    ConnectionConfig, DatabaseType,
};
use serde_json::Value;

fn test_config() -> ConnectionConfig {
    let host = std::env::var("PG_HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port = std::env::var("PG_PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(55432);
    let database = std::env::var("PG_DATABASE").unwrap_or_else(|_| "join_test".into());
    let username = std::env::var("PG_USER").unwrap_or_else(|_| "join".into());

    ConnectionConfig::new(
        "docker-postgres".into(),
        DatabaseType::Postgresql,
        Some(host),
        Some(port),
        database,
        Some(username),
        Some("disable".into()),
    )
}

#[tokio::test]
#[ignore = "requires docker postgres"]
async fn postgres_metadata_and_query_integration() {
    let config = test_config();
    let password = std::env::var("PG_PASSWORD").unwrap_or_else(|_| "join".into());
    let connection_id = config.id.clone();

    connect(&config, Some(&password))
        .await
        .expect("postgres connect");

    let schemas = get_schemas(&connection_id).await.expect("schemas");
    assert!(schemas.iter().any(|s| s.name == "public"));

    let tables = get_tables(&connection_id, Some("public"))
        .await
        .expect("tables");
    assert!(tables.iter().any(|t| t.name == "customers"));
    assert!(tables.iter().any(|t| t.name == "orders"));

    let columns = get_columns(&connection_id, "orders", Some("public"))
        .await
        .expect("columns");
    assert!(columns.iter().any(|c| c.name == "status" && c.data_type.contains("order_status")));
    assert!(columns.iter().any(|c| c.name == "tags"));

    let indexes = get_indexes(&connection_id, "orders", Some("public"))
        .await
        .expect("indexes");
    assert!(indexes.iter().any(|i| i.name.contains("idx_orders_customer_id")));

    let fks = get_foreign_keys(&connection_id, "orders", Some("public"))
        .await
        .expect("foreign keys");
    assert!(fks.iter().any(|fk| fk.foreign_table_name == "customers"));

    let functions = get_functions(&connection_id, Some("public"))
        .await
        .expect("functions");
    assert!(functions.iter().any(|f| f.name == "calculate_discount"));

    let function_detail = get_function_details(&connection_id, "calculate_discount", Some("public"))
        .await
        .expect("function detail");
    assert_eq!(function_detail.name, "calculate_discount");
    assert!(function_detail.return_type.unwrap_or_default().contains("numeric"));

    let custom_types = get_custom_types(&connection_id, Some("public"))
        .await
        .expect("custom types");
    assert!(custom_types.iter().any(|t| t.name == "order_status"));
    assert!(custom_types.iter().any(|t| t.name == "shipping_address_type"));
    assert!(custom_types.iter().any(|t| t.name == "positive_int"));

    let enum_detail = get_type_details(&connection_id, "order_status", Some("public"))
        .await
        .expect("enum detail");
    assert_eq!(enum_detail.type_kind, "enum");
    assert_eq!(
        enum_detail.values.unwrap_or_default(),
        vec!["pending", "paid", "shipped"]
    );

    let composite_detail = get_type_details(&connection_id, "shipping_address_type", Some("public"))
        .await
        .expect("composite detail");
    assert_eq!(composite_detail.type_kind, "composite");
    assert_eq!(composite_detail.fields.unwrap_or_default().len(), 2);

    let domain_detail = get_type_details(&connection_id, "positive_int", Some("public"))
        .await
        .expect("domain detail");
    assert_eq!(domain_detail.type_kind, "domain");
    assert!(domain_detail.base_type.unwrap_or_default().contains("integer"));

    let result = execute_query(
        &connection_id,
        "SELECT o.total, o.tags, o.shipping_address, c.metadata
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
         ORDER BY o.id
         LIMIT 1",
    )
    .await
    .expect("query");

    assert_eq!(result.row_count, 1);
    assert_eq!(result.columns.len(), 4);
    let row = &result.rows[0];
    assert!(matches!(&row[0], Value::String(_)));
    assert!(matches!(&row[1], Value::Array(_)));
    assert!(matches!(&row[3], Value::Object(_)));
    if let Value::Object(obj) = &row[2] {
        assert_eq!(obj.get("_display"), Some(&Value::String("composite".into())));
    } else {
        panic!("expected composite type object");
    }

    let all_types = execute_query(
        &connection_id,
        "SELECT
           c_smallint,
           c_int,
           c_bigint,
           c_real,
           c_double,
           c_numeric,
           c_bool,
           c_uuid,
           c_timestamp,
           c_timestamptz,
           c_date,
           c_time,
           c_jsonb,
           c_smallint_array,
           c_int_array,
           c_bigint_array,
           c_real_array,
           c_double_array,
           c_text_array,
           c_bool_array,
           c_uuid_array,
           c_timestamp_array,
           c_timestamptz_array,
           c_date_array,
           c_time_array,
           c_enum,
           c_composite,
           c_domain
         FROM all_supported_types
         ORDER BY id
         LIMIT 1",
    )
    .await
    .expect("all supported type query");

    assert_eq!(all_types.row_count, 1);
    assert_eq!(all_types.columns.len(), 28);
    let r = &all_types.rows[0];

    assert_eq!(r[0].as_i64(), Some(7));
    assert_eq!(r[1].as_i64(), Some(42));
    assert_eq!(r[2].as_i64(), Some(900719925474099));
    assert!((r[3].as_f64().expect("real as f64") - 3.25).abs() < 1e-6);
    assert!((r[4].as_f64().expect("double as f64") - 6.283185307).abs() < 1e-9);
    assert_eq!(r[5].as_str(), Some("1234567890.123456"));
    assert_eq!(r[6].as_bool(), Some(true));
    assert_eq!(r[7].as_str(), Some("123e4567-e89b-12d3-a456-426614174000"));
    assert_eq!(r[8].as_str(), Some("2026-01-02 03:04:05"));
    assert!(r[9].as_str().unwrap_or_default().contains("2026-01-02 03:04:05"));
    assert_eq!(r[10].as_str(), Some("2026-01-02"));
    assert_eq!(r[11].as_str(), Some("03:04:05"));

    let json_obj = r[12].as_object().expect("jsonb object");
    assert_eq!(json_obj.get("name"), Some(&Value::String("types-row".into())));
    assert_eq!(json_obj.get("ok"), Some(&Value::Bool(true)));
    assert_eq!(json_obj.get("count"), Some(&Value::Number(3.into())));

    assert_eq!(r[13].as_array().expect("smallint array").len(), 3);
    assert_eq!(r[14].as_array().expect("int array").len(), 3);
    assert_eq!(r[15].as_array().expect("bigint array").len(), 3);
    assert_eq!(r[16].as_array().expect("real array").len(), 2);
    assert_eq!(r[17].as_array().expect("double array").len(), 2);
    assert_eq!(r[18].as_array().expect("text array").len(), 2);
    assert_eq!(r[19].as_array().expect("bool array").len(), 3);
    assert_eq!(r[20].as_array().expect("uuid array").len(), 2);
    assert_eq!(r[21].as_array().expect("timestamp array").len(), 2);
    assert_eq!(r[22].as_array().expect("timestamptz array").len(), 2);
    assert_eq!(r[23].as_array().expect("date array").len(), 2);
    assert_eq!(r[24].as_array().expect("time array").len(), 2);

    assert_eq!(r[25].as_str(), Some("shipped"));
    if let Value::Object(obj) = &r[26] {
        assert_eq!(obj.get("_display"), Some(&Value::String("composite".into())));
        assert!(obj
            .get("_raw")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .contains("99 Data Way"));
    } else {
        panic!("expected composite type object in all_supported_types");
    }
    assert_eq!(r[27].as_i64(), Some(9));

    let bad = execute_query(&connection_id, "SELECT * FROM does_not_exist").await;
    assert!(bad.is_err());

    disconnect(&connection_id).await.expect("disconnect");
}
