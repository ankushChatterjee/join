import { describe, expect, it } from "bun:test";
import { buildCompletionSchema } from "./completionSchema";

describe("SQL completion schema", () => {
  it("builds short and schema-qualified completions for tables and views", () => {
    const schema = buildCompletionSchema(
      {
        public: [{ name: "orders", schema: "public" }],
        archive: [{ name: "orders", schema: "archive" }],
      },
      {
        public: [{ name: "order_summary", schema: "public" }],
      },
      {
        "public.orders": [
          { name: "id", data_type: "integer", is_nullable: false, is_primary_key: true },
          { name: "customer_id", data_type: "integer", is_nullable: false, is_primary_key: false },
        ],
        "archive.orders": [{ name: "archived_at", data_type: "timestamp", is_nullable: false, is_primary_key: false }],
        "public.order_summary": [{ name: "total", data_type: "numeric", is_nullable: false, is_primary_key: false }],
      }
    );

    expect(schema.orders).toEqual(["id", "customer_id"]);
    expect(schema["public.orders"]).toEqual(["id", "customer_id"]);
    expect(schema["archive.orders"]).toEqual(["archived_at"]);
    expect(schema.order_summary).toEqual(["total"]);
    expect(schema.id).toEqual([]);
    expect(schema.customer_id).toEqual([]);
    expect(schema.archived_at).toEqual([]);
  });

  it("does not let a view short name overwrite an existing table short name", () => {
    const schema = buildCompletionSchema(
      { public: [{ name: "users", schema: "public" }] },
      { reporting: [{ name: "users", schema: "reporting" }] },
      {
        "public.users": [{ name: "id", data_type: "integer", is_nullable: false, is_primary_key: true }],
        "reporting.users": [{ name: "display_name", data_type: "text", is_nullable: false, is_primary_key: false }],
      }
    );

    expect(schema.users).toEqual(["id"]);
    expect(schema["reporting.users"]).toEqual(["display_name"]);
  });
});
