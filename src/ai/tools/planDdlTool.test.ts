import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock: any = vi.fn((..._args: any[]) => undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

let useAppStore: (typeof import("@/stores/appStore"))["useAppStore"];
let planDdl: (typeof import("./planDdlTool"))["planDdl"];

beforeAll(async () => {
  ({ useAppStore } = await import("@/stores/appStore"));
  ({ planDdl } = await import("./planDdlTool"));
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function baseExecutionContext(dialect = "postgresql") {
  return {
    runId: "run-1",
    sessionId: "session-1",
    targetConnectionId: "c1",
    targetConnectionDialect: dialect,
    activeEditorKind: "script",
    activeScriptId: null,
    activeResultTabId: null,
    savedResultId: null,
    metadataVersion: null,
    resultVersion: null,
    capturedAt: Date.now(),
    metadataIsFresh: true,
    metadataWarning: null,
  };
}

function baseAgentContext(dialect = "postgresql") {
  return { executionContext: baseExecutionContext(dialect) };
}

function connected(dialect: "postgresql" | "mysql" | "sqlite" = "postgresql") {
  return {
    id: "c1",
    name: "Main DB",
    db_type: dialect,
    host: "localhost",
    port: 5432,
    database: "testdb",
    username: "test",
    ssl_mode: "disable",
    is_connected: true,
  };
}

/** Invoke handler where "public" schema has orders + customers; users exists */
function baseInvoke(cmd: string, payload: any) {
  if (cmd === "get_tables" && payload.schema === "public") {
    return Promise.resolve([
      { name: "users", schema: "public" },
      { name: "customers", schema: "public" },
    ]);
  }
  if (cmd === "get_columns" && payload.table === "users") {
    return Promise.resolve([
      { name: "id", data_type: "bigint", is_nullable: false, is_primary_key: true },
      { name: "email", data_type: "text", is_nullable: false, is_primary_key: false },
    ]);
  }
  if (cmd === "get_columns") return Promise.resolve([]);
  if (cmd === "get_indexes") return Promise.resolve([]);
  if (cmd === "get_foreign_keys") return Promise.resolve([]);
  if (cmd === "get_custom_types") return Promise.resolve([]);
  return Promise.resolve([]);
}

// ---------------------------------------------------------------------------
// plan_ddl — input validation
// ---------------------------------------------------------------------------

describe("plan_ddl — input validation", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useAppStore.setState({ activeConnectionId: "c1", connections: [connected()] });
  });

  it("returns error when entities list is empty", async () => {
    const raw = await (planDdl as any).execute(
      { goal: "Create orders table", entities: [] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.status).toBe("error");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns error when entity names lack a schema prefix", async () => {
    const raw = await (planDdl as any).execute(
      { goal: "Create orders", entities: ["orders", "order_items"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.status).toBe("error");
    expect(parsed.error).toContain("schema prefix");
    expect(parsed.error).toContain("orders");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns error for a mix of unqualified and qualified names", async () => {
    const raw = await (planDdl as any).execute(
      { goal: "Create tables", entities: ["orders", "public.order_items"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.status).toBe("error");
    expect(parsed.error).toContain("schema prefix");
  });

  it("returns error when references list has unqualified names", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables" && payload.schema === "public") {
        return Promise.resolve([]); // nothing exists — CREATE mode
      }
      return Promise.resolve([]);
    });

    const raw = await (planDdl as any).execute(
      {
        goal: "Create orders referencing users",
        entities: ["public.orders"],
        references: ["users"],
      },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.status).toBe("error");
    expect(parsed.error).toContain("schema-qualified");
  });

  it("throws when no connection is available", async () => {
    useAppStore.setState({ activeConnectionId: null, connections: [] });

    await expect(
      (planDdl as any).execute(
        { goal: "Create orders", entities: ["public.orders"] },
        { experimental_context: { executionContext: { ...baseExecutionContext(), targetConnectionId: null } } }
      )
    ).rejects.toThrow("No resolved database connection");
  });
});

// ---------------------------------------------------------------------------
// plan_ddl — mode detection
// ---------------------------------------------------------------------------

describe("plan_ddl — mode detection", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useAppStore.setState({ activeConnectionId: "c1", connections: [connected()] });
  });

  it("selects CREATE mode when none of the entities exist", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables" && payload.schema === "public") {
        return Promise.resolve([]); // no existing tables
      }
      if (cmd === "get_custom_types") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const raw = await (planDdl as any).execute(
      { goal: "Create orders table", entities: ["public.orders"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.status).toBe("ready");
    expect(parsed.mode).toBe("create");
    expect(parsed.proposed_entities).toEqual(["public.orders"]);
  });

  it("selects ALTER mode when all entities already exist", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables" && payload.schema === "public") {
        return Promise.resolve([{ name: "orders", schema: "public" }]);
      }
      if (cmd === "get_columns") return Promise.resolve([]);
      if (cmd === "get_indexes") return Promise.resolve([]);
      if (cmd === "get_foreign_keys") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const raw = await (planDdl as any).execute(
      { goal: "Add a status column", entities: ["public.orders"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.status).toBe("ready");
    expect(parsed.mode).toBe("alter");
    expect(parsed.tables).toEqual(["public.orders"]);
  });

  it("returns error when entities are a mix of existing and non-existing tables", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables" && payload.schema === "public") {
        return Promise.resolve([
          { name: "orders", schema: "public" }, // exists
          // order_items does NOT exist
        ]);
      }
      return Promise.resolve([]);
    });

    const raw = await (planDdl as any).execute(
      { goal: "Mixed operation", entities: ["public.orders", "public.order_items"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.status).toBe("error");
    expect(parsed.error).toContain("Mixed entities");
    expect(parsed.already_exist).toContain("public.orders");
    expect(parsed.not_found).toContain("public.order_items");
  });
});

// ---------------------------------------------------------------------------
// plan_ddl — CREATE mode
// ---------------------------------------------------------------------------

describe("plan_ddl — CREATE mode", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useAppStore.setState({ activeConnectionId: "c1", connections: [connected()] });
  });

  it("returns proposed_entities matching the input", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables" && payload.schema === "public") return Promise.resolve([]);
      if (cmd === "get_custom_types") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const raw = await (planDdl as any).execute(
      { goal: "Order system", entities: ["public.orders", "public.order_items"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.proposed_entities).toEqual(["public.orders", "public.order_items"]);
    expect(parsed.naming_conflicts).toEqual([]);
  });

  it("fetches PK columns of referenced existing tables", async () => {
    invokeMock.mockImplementation(baseInvoke);

    // Nothing being created exists yet
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables" && payload.schema === "public") {
        // For the entities check, return nothing (they are new)
        // For the references check, return users
        return Promise.resolve([{ name: "users", schema: "public" }]);
      }
      if (cmd === "get_columns" && payload.table === "users") {
        return Promise.resolve([
          { name: "id", data_type: "bigint", is_nullable: false, is_primary_key: true },
          { name: "email", data_type: "text", is_nullable: false, is_primary_key: false },
        ]);
      }
      if (cmd === "get_custom_types") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const raw = await (planDdl as any).execute(
      {
        goal: "Orders belong to users",
        entities: ["public.orders"],
        references: ["public.users"],
      },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.mode).toBe("create");
    expect(parsed.referenced_existing_tables).toHaveLength(1);
    const ref = parsed.referenced_existing_tables[0];
    expect(ref.table).toBe("public.users");
    expect(ref.pk_columns).toHaveLength(1);
    expect(ref.pk_columns[0].name).toBe("id");
    expect(ref.pk_columns[0].data_type).toBe("bigint");
  });

  it("returns only PK columns (not all columns) for referenced tables", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables") return Promise.resolve([{ name: "users", schema: "public" }]);
      if (cmd === "get_columns" && payload.table === "users") {
        return Promise.resolve([
          { name: "id", data_type: "bigint", is_nullable: false, is_primary_key: true },
          { name: "name", data_type: "text", is_nullable: false, is_primary_key: false },
          { name: "email", data_type: "text", is_nullable: false, is_primary_key: false },
        ]);
      }
      if (cmd === "get_custom_types") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const raw = await (planDdl as any).execute(
      {
        goal: "Orders belong to users",
        entities: ["public.orders"],
        references: ["public.users"],
      },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    const ref = parsed.referenced_existing_tables[0];
    // Only the PK column should be returned, not email/name
    expect(ref.pk_columns.every((c: any) => c.name === "id")).toBe(true);
    expect(ref.pk_columns).toHaveLength(1);
  });

  it("handles composite PKs in referenced tables", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables") return Promise.resolve([{ name: "order_items", schema: "public" }]);
      if (cmd === "get_columns" && payload.table === "order_items") {
        return Promise.resolve([
          { name: "order_id", data_type: "bigint", is_nullable: false, is_primary_key: true },
          { name: "product_id", data_type: "bigint", is_nullable: false, is_primary_key: true },
          { name: "quantity", data_type: "int", is_nullable: false, is_primary_key: false },
        ]);
      }
      if (cmd === "get_custom_types") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const raw = await (planDdl as any).execute(
      {
        goal: "Shipment line items",
        entities: ["public.shipment_items"],
        references: ["public.order_items"],
      },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    const ref = parsed.referenced_existing_tables[0];
    expect(ref.pk_columns).toHaveLength(2);
    expect(ref.pk_columns.map((c: any) => c.name)).toContain("order_id");
    expect(ref.pk_columns.map((c: any) => c.name)).toContain("product_id");
  });

  it("surfaces reusable ENUM types on Postgres", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables") return Promise.resolve([]);
      if (cmd === "get_custom_types" && payload.schema === "public") {
        return Promise.resolve([
          { name: "order_status", schema: "public", type_kind: "enum" },
          { name: "payment_method", schema: "public", type_kind: "enum" },
        ]);
      }
      return Promise.resolve([]);
    });

    const raw = await (planDdl as any).execute(
      { goal: "Create orders table", entities: ["public.orders"] },
      { experimental_context: baseAgentContext("postgresql") }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.reusable_types).toHaveLength(2);
    const names = parsed.reusable_types.map((t: any) => t.name);
    expect(names).toContain("order_status");
    expect(names).toContain("payment_method");
  });

  it("does not fetch custom types for non-postgres dialects", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    await (planDdl as any).execute(
      { goal: "Create orders table", entities: ["public.orders"] },
      { experimental_context: baseAgentContext("mysql") }
    );

    const customTypeCalls = invokeMock.mock.calls.filter(
      ([cmd]: [string]) => cmd === "get_custom_types"
    );
    expect(customTypeCalls).toHaveLength(0);
  });

  it("returns empty pk_columns when referenced table does not exist", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables") return Promise.resolve([]); // nothing exists
      if (cmd === "get_custom_types") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const raw = await (planDdl as any).execute(
      {
        goal: "Orders belong to ghost_users",
        entities: ["public.orders"],
        references: ["public.ghost_users"],
      },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.mode).toBe("create");
    const ref = parsed.referenced_existing_tables[0];
    expect(ref.table).toBe("public.ghost_users");
    expect(ref.pk_columns).toHaveLength(0);
  });

  it("next_steps include FK type matching guidance when references are provided", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables") return Promise.resolve([{ name: "users", schema: "public" }]);
      if (cmd === "get_columns" && payload.table === "users") {
        return Promise.resolve([
          { name: "id", data_type: "uuid", is_nullable: false, is_primary_key: true },
        ]);
      }
      if (cmd === "get_custom_types") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const raw = await (planDdl as any).execute(
      {
        goal: "Orders belong to users",
        entities: ["public.orders"],
        references: ["public.users"],
      },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    const allSteps = parsed.next_steps.join(" ");
    expect(allSteps).toContain("public.users");
    expect(allSteps).toContain("uuid");
    expect(allSteps).toMatch(/Do NOT guess/i);
  });

  it("next_steps include validate_ddl reminder", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables") return Promise.resolve([]);
      if (cmd === "get_custom_types") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const raw = await (planDdl as any).execute(
      { goal: "Create orders", entities: ["public.orders"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    const allSteps = parsed.next_steps.join(" ");
    expect(allSteps).toContain("validate_ddl");
  });

  it("recommended rules always include schema-primary-keys and schema-constraints", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables") return Promise.resolve([]);
      if (cmd === "get_custom_types") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const raw = await (planDdl as any).execute(
      { goal: "Create a users table", entities: ["public.users"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.recommended_best_practice_rules).toContain("schema-primary-keys");
    expect(parsed.recommended_best_practice_rules).toContain("schema-constraints");
  });

  it("recommended rules include schema-foreign-key-indexes when references are provided", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables") return Promise.resolve([{ name: "users", schema: "public" }]);
      if (cmd === "get_columns") return Promise.resolve([
        { name: "id", data_type: "bigint", is_nullable: false, is_primary_key: true },
      ]);
      if (cmd === "get_custom_types") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const raw = await (planDdl as any).execute(
      {
        goal: "Orders belong to users",
        entities: ["public.orders"],
        references: ["public.users"],
      },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.recommended_best_practice_rules).toContain("schema-foreign-key-indexes");
  });

  it("recommended rules include schema-foreign-key-indexes when goal mentions FK keywords", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables") return Promise.resolve([]);
      if (cmd === "get_custom_types") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const raw = await (planDdl as any).execute(
      {
        goal: "Create orders table that references customers and has foreign key relationships",
        entities: ["public.orders"],
      },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.recommended_best_practice_rules).toContain("schema-foreign-key-indexes");
  });

  it("recommended rules include schema-partitioning when goal mentions partitioning", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables") return Promise.resolve([]);
      if (cmd === "get_custom_types") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const raw = await (planDdl as any).execute(
      { goal: "Create a range-partitioned events table by month", entities: ["public.events"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.recommended_best_practice_rules).toContain("schema-partitioning");
  });

  it("recommended rules include security-rls-basics when goal mentions RLS", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables") return Promise.resolve([]);
      if (cmd === "get_custom_types") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const raw = await (planDdl as any).execute(
      { goal: "Create a multi-tenant table with RLS policies", entities: ["public.tenant_data"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.recommended_best_practice_rules).toContain("security-rls-basics");
  });

  it("next_steps include get_postgres_best_practice call", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables") return Promise.resolve([]);
      if (cmd === "get_custom_types") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const raw = await (planDdl as any).execute(
      { goal: "Create orders", entities: ["public.orders"] },
      { experimental_context: baseAgentContext("postgresql") }
    );
    const parsed = JSON.parse(raw);

    const allSteps = parsed.next_steps.join(" ");
    expect(allSteps).toContain("get_postgres_best_practice");
  });

  it("next_steps mention ENUM reuse when reusable types exist", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables") return Promise.resolve([]);
      if (cmd === "get_custom_types") {
        return Promise.resolve([
          { name: "order_status", schema: "public", type_kind: "enum" },
        ]);
      }
      return Promise.resolve([]);
    });

    const raw = await (planDdl as any).execute(
      { goal: "Create orders table", entities: ["public.orders"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    const allSteps = parsed.next_steps.join(" ");
    expect(allSteps).toContain("order_status");
    expect(allSteps).toContain("ENUM");
  });
});

// ---------------------------------------------------------------------------
// plan_ddl — ALTER mode
// ---------------------------------------------------------------------------

describe("plan_ddl — ALTER mode", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useAppStore.setState({ activeConnectionId: "c1", connections: [connected()] });
  });

  function ordersAlterInvoke(cmd: string, payload: any) {
    if (cmd === "get_tables" && payload.schema === "public") {
      return Promise.resolve([{ name: "orders", schema: "public" }]);
    }
    if (cmd === "get_columns" && payload.table === "orders") {
      return Promise.resolve([
        { name: "id", data_type: "bigint", is_nullable: false, is_primary_key: true },
        { name: "user_id", data_type: "bigint", is_nullable: false, is_primary_key: false },
        { name: "status", data_type: "text", is_nullable: false, is_primary_key: false },
        { name: "created_at", data_type: "timestamptz", is_nullable: false, is_primary_key: false },
      ]);
    }
    if (cmd === "get_indexes" && payload.table === "orders") {
      return Promise.resolve([
        { name: "orders_pkey", is_unique: true, is_primary: true },
        { name: "orders_user_id_idx", is_unique: false, is_primary: false },
      ]);
    }
    if (cmd === "get_foreign_keys" && payload.table === "orders") {
      return Promise.resolve([
        {
          constraint_name: "orders_user_id_fkey",
          column_name: "user_id",
          foreign_table_schema: "public",
          foreign_table_name: "users",
          foreign_column_name: "id",
        },
      ]);
    }
    return Promise.resolve([]);
  }

  it("fetches columns, indexes and foreign keys for each entity in parallel", async () => {
    invokeMock.mockImplementation(ordersAlterInvoke);

    await (planDdl as any).execute(
      { goal: "Add a shipping_address column", entities: ["public.orders"] },
      { experimental_context: baseAgentContext() }
    );

    const cmds = invokeMock.mock.calls.map(([cmd]: [string]) => cmd);
    expect(cmds).toContain("get_columns");
    expect(cmds).toContain("get_indexes");
    expect(cmds).toContain("get_foreign_keys");
  });

  it("returns current_state with correct table key and data shape", async () => {
    invokeMock.mockImplementation(ordersAlterInvoke);

    const raw = await (planDdl as any).execute(
      { goal: "Add a shipping_address column", entities: ["public.orders"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.current_state).toHaveProperty("public.orders");
    const state = parsed.current_state["public.orders"];

    expect(state.columns).toHaveLength(4);
    expect(state.columns[0]).toMatchObject({ name: "id", type: "bigint", primary_key: true });
    expect(state.indexes).toHaveLength(2);
    expect(state.foreign_keys).toHaveLength(1);
    expect(state.foreign_keys[0].constraint).toBe("orders_user_id_fkey");
    expect(state.foreign_keys[0].column).toBe("user_id");
    expect(state.foreign_keys[0].references).toBe("public.users(id)");
  });

  it("fetches state for multiple entities in parallel", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables" && payload.schema === "public") {
        return Promise.resolve([
          { name: "orders", schema: "public" },
          { name: "customers", schema: "public" },
        ]);
      }
      if (cmd === "get_columns" && payload.table === "orders") {
        return Promise.resolve([
          { name: "id", data_type: "bigint", is_nullable: false, is_primary_key: true },
        ]);
      }
      if (cmd === "get_columns" && payload.table === "customers") {
        return Promise.resolve([
          { name: "id", data_type: "bigint", is_nullable: false, is_primary_key: true },
          { name: "email", data_type: "text", is_nullable: false, is_primary_key: false },
        ]);
      }
      if (cmd === "get_indexes") return Promise.resolve([]);
      if (cmd === "get_foreign_keys") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const raw = await (planDdl as any).execute(
      { goal: "Add archive flags to both tables", entities: ["public.orders", "public.customers"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.current_state).toHaveProperty("public.orders");
    expect(parsed.current_state).toHaveProperty("public.customers");
    expect(parsed.current_state["public.customers"].columns).toHaveLength(2);
  });

  it("returns ddl_risk_guide with safe / risky / dangerous classification tiers", async () => {
    invokeMock.mockImplementation(ordersAlterInvoke);

    const raw = await (planDdl as any).execute(
      { goal: "Rename user_id to customer_id", entities: ["public.orders"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.ddl_risk_guide).toHaveProperty("safe");
    expect(parsed.ddl_risk_guide).toHaveProperty("risky");
    expect(parsed.ddl_risk_guide).toHaveProperty("dangerous");
    expect(Array.isArray(parsed.ddl_risk_guide.safe)).toBe(true);
    expect(Array.isArray(parsed.ddl_risk_guide.risky)).toBe(true);
    expect(Array.isArray(parsed.ddl_risk_guide.dangerous)).toBe(true);
  });

  it("risk guide categorises ADD COLUMN as safe", async () => {
    invokeMock.mockImplementation(ordersAlterInvoke);

    const raw = await (planDdl as any).execute(
      { goal: "Add shipping_address column", entities: ["public.orders"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    const safeOps = parsed.ddl_risk_guide.safe.join(" ");
    expect(safeOps).toContain("ADD COLUMN");
    expect(safeOps).toContain("CONCURRENTLY");
  });

  it("risk guide categorises DROP COLUMN as dangerous", async () => {
    invokeMock.mockImplementation(ordersAlterInvoke);

    const raw = await (planDdl as any).execute(
      { goal: "Remove legacy column", entities: ["public.orders"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    const dangerOps = parsed.ddl_risk_guide.dangerous.join(" ");
    expect(dangerOps).toContain("DROP COLUMN");
    expect(dangerOps).toContain("RENAME");
  });

  it("returns expand_contract_pattern string", async () => {
    invokeMock.mockImplementation(ordersAlterInvoke);

    const raw = await (planDdl as any).execute(
      { goal: "Rename user_id to customer_id", entities: ["public.orders"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(typeof parsed.expand_contract_pattern).toBe("string");
    expect(parsed.expand_contract_pattern).toContain("expand");
    expect(parsed.expand_contract_pattern).toContain("contract");
  });

  it("recommended rules include lock-deadlock-prevention and lock-short-transactions in ALTER mode", async () => {
    invokeMock.mockImplementation(ordersAlterInvoke);

    const raw = await (planDdl as any).execute(
      { goal: "Add a NOT NULL column", entities: ["public.orders"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.recommended_best_practice_rules).toContain("lock-deadlock-prevention");
    expect(parsed.recommended_best_practice_rules).toContain("lock-short-transactions");
  });

  it("next_steps include validate_ddl and add_cell guidance", async () => {
    invokeMock.mockImplementation(ordersAlterInvoke);

    const raw = await (planDdl as any).execute(
      { goal: "Add status column", entities: ["public.orders"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    const allSteps = parsed.next_steps.join(" ");
    expect(allSteps).toContain("validate_ddl");
    expect(allSteps).toContain("add_cell");
    expect(allSteps).toContain("expand");
    expect(allSteps).toContain("contract");
  });

  it("next_steps include get_postgres_best_practice for recommended rules", async () => {
    invokeMock.mockImplementation(ordersAlterInvoke);

    const raw = await (planDdl as any).execute(
      { goal: "Add column", entities: ["public.orders"] },
      { experimental_context: baseAgentContext("postgresql") }
    );
    const parsed = JSON.parse(raw);

    const allSteps = parsed.next_steps.join(" ");
    expect(allSteps).toContain("get_postgres_best_practice");
  });

  it("preserves column comment field in current_state", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables") return Promise.resolve([{ name: "users", schema: "public" }]);
      if (cmd === "get_columns") {
        return Promise.resolve([
          {
            name: "id",
            data_type: "bigint",
            is_nullable: false,
            is_primary_key: true,
            comment: "Primary key",
          },
        ]);
      }
      if (cmd === "get_indexes") return Promise.resolve([]);
      if (cmd === "get_foreign_keys") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const raw = await (planDdl as any).execute(
      { goal: "Alter users", entities: ["public.users"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    const idCol = parsed.current_state["public.users"].columns.find((c: any) => c.name === "id");
    expect(idCol.comment).toBe("Primary key");
  });
});

// ---------------------------------------------------------------------------
// plan_ddl — cross-schema entities
// ---------------------------------------------------------------------------

describe("plan_ddl — cross-schema entities", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useAppStore.setState({ activeConnectionId: "c1", connections: [connected()] });
  });

  it("CREATE mode: handles entities across multiple schemas", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables" && payload.schema === "public") return Promise.resolve([]);
      if (cmd === "get_tables" && payload.schema === "billing") return Promise.resolve([]);
      if (cmd === "get_custom_types") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const raw = await (planDdl as any).execute(
      { goal: "Create orders and invoices", entities: ["public.orders", "billing.invoices"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.mode).toBe("create");
    expect(parsed.proposed_entities).toContain("public.orders");
    expect(parsed.proposed_entities).toContain("billing.invoices");
  });

  it("ALTER mode: handles entities across multiple schemas", async () => {
    invokeMock.mockImplementation((cmd: string, payload: any) => {
      if (cmd === "get_tables" && payload.schema === "public") {
        return Promise.resolve([{ name: "orders", schema: "public" }]);
      }
      if (cmd === "get_tables" && payload.schema === "billing") {
        return Promise.resolve([{ name: "invoices", schema: "billing" }]);
      }
      if (cmd === "get_columns") return Promise.resolve([]);
      if (cmd === "get_indexes") return Promise.resolve([]);
      if (cmd === "get_foreign_keys") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const raw = await (planDdl as any).execute(
      { goal: "Add archive column", entities: ["public.orders", "billing.invoices"] },
      { experimental_context: baseAgentContext() }
    );
    const parsed = JSON.parse(raw);

    expect(parsed.mode).toBe("alter");
    expect(parsed.current_state).toHaveProperty("public.orders");
    expect(parsed.current_state).toHaveProperty("billing.invoices");
  });
});
