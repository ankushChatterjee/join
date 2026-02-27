CREATE TYPE order_status AS ENUM ('pending', 'paid', 'shipped');

CREATE TYPE shipping_address_type AS (
  street TEXT,
  city TEXT
);

CREATE DOMAIN positive_int AS INTEGER CHECK (VALUE > 0);

CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  status order_status NOT NULL DEFAULT 'pending',
  total NUMERIC(12, 2) NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  shipping_address shipping_address_type,
  quantity positive_int NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_customer_id ON orders(customer_id);

CREATE VIEW order_summary AS
SELECT
  o.id,
  c.name AS customer_name,
  o.status,
  o.total
FROM orders o
JOIN customers c ON c.id = o.customer_id;

CREATE FUNCTION calculate_discount(amount NUMERIC)
RETURNS NUMERIC
LANGUAGE SQL
STABLE
AS $$
  SELECT round(amount * 0.10, 2);
$$;

INSERT INTO customers (name, metadata) VALUES
  ('Alice', '{"tier":"gold","active":true}'),
  ('Bob', '{"tier":"silver","active":false}');

INSERT INTO orders (customer_id, status, total, tags, shipping_address, quantity) VALUES
  (1, 'paid', 199.95, ARRAY['priority', 'gift'], ROW('1 Main St', 'Austin'), 2),
  (2, 'pending', 49.50, ARRAY['standard'], ROW('9 Side Ave', 'Dallas'), 1);

CREATE TABLE all_supported_types (
  id SERIAL PRIMARY KEY,
  c_smallint SMALLINT NOT NULL,
  c_int INTEGER NOT NULL,
  c_bigint BIGINT NOT NULL,
  c_real REAL NOT NULL,
  c_double DOUBLE PRECISION NOT NULL,
  c_numeric NUMERIC(20, 6) NOT NULL,
  c_bool BOOLEAN NOT NULL,
  c_uuid UUID NOT NULL,
  c_timestamp TIMESTAMP NOT NULL,
  c_timestamptz TIMESTAMPTZ NOT NULL,
  c_date DATE NOT NULL,
  c_time TIME NOT NULL,
  c_jsonb JSONB NOT NULL,
  c_smallint_array SMALLINT[] NOT NULL,
  c_int_array INTEGER[] NOT NULL,
  c_bigint_array BIGINT[] NOT NULL,
  c_real_array REAL[] NOT NULL,
  c_double_array DOUBLE PRECISION[] NOT NULL,
  c_text_array TEXT[] NOT NULL,
  c_bool_array BOOLEAN[] NOT NULL,
  c_uuid_array UUID[] NOT NULL,
  c_timestamp_array TIMESTAMP[] NOT NULL,
  c_timestamptz_array TIMESTAMPTZ[] NOT NULL,
  c_date_array DATE[] NOT NULL,
  c_time_array TIME[] NOT NULL,
  c_enum order_status NOT NULL,
  c_composite shipping_address_type NOT NULL,
  c_domain positive_int NOT NULL
);

INSERT INTO all_supported_types (
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
) VALUES (
  7,
  42,
  900719925474099,
  3.25,
  6.283185307,
  1234567890.123456,
  TRUE,
  '123e4567-e89b-12d3-a456-426614174000',
  '2026-01-02 03:04:05',
  '2026-01-02 03:04:05+00',
  '2026-01-02',
  '03:04:05',
  '{"name":"types-row","ok":true,"count":3}',
  ARRAY[1,2,3]::SMALLINT[],
  ARRAY[10,20,30]::INTEGER[],
  ARRAY[100,200,300]::BIGINT[],
  ARRAY[1.25,2.5]::REAL[],
  ARRAY[2.718281828,3.141592653]::DOUBLE PRECISION[],
  ARRAY['alpha','beta'],
  ARRAY[TRUE,FALSE,TRUE],
  ARRAY[
    '123e4567-e89b-12d3-a456-426614174001'::UUID,
    '123e4567-e89b-12d3-a456-426614174002'::UUID
  ],
  ARRAY['2026-01-02 03:04:05'::TIMESTAMP,'2026-01-03 04:05:06'::TIMESTAMP],
  ARRAY['2026-01-02 03:04:05+00'::TIMESTAMPTZ,'2026-01-03 04:05:06+00'::TIMESTAMPTZ],
  ARRAY['2026-01-02'::DATE,'2026-01-03'::DATE],
  ARRAY['03:04:05'::TIME,'04:05:06'::TIME],
  'shipped',
  ROW('99 Data Way', 'Austin')::shipping_address_type,
  9
);
