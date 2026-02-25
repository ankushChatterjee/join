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

