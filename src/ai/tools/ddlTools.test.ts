import { beforeAll, describe, expect, it } from "vitest";

let validateDdl: (typeof import("./ddlTools"))["validateDdl"];

beforeAll(async () => {
  ({ validateDdl } = await import("./ddlTools"));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function lint(ddl: string, dialect: "postgresql" | "mysql" | "sqlite" = "postgresql") {
  const raw = await (validateDdl as any).execute({ ddl, dialect });
  return JSON.parse(raw) as {
    safe: boolean;
    summary: { high: number; medium: number; low: number; total: number };
    checks: Array<{
      rule_id: string;
      severity: "HIGH" | "MEDIUM" | "LOW";
      table?: string;
      column?: string;
      message: string;
      suggestion: string;
    }>;
    note: string;
  };
}

function hasRule(result: Awaited<ReturnType<typeof lint>>, ruleId: string) {
  return result.checks.some((c) => c.rule_id === ruleId);
}

function highChecks(result: Awaited<ReturnType<typeof lint>>) {
  return result.checks.filter((c) => c.severity === "HIGH");
}

// ---------------------------------------------------------------------------
// Canonical clean DDL (should produce no HIGH checks)
// ---------------------------------------------------------------------------

const CANONICAL_DDL = `
CREATE TABLE public.orders (
  id          BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES public.users(id),
  status      TEXT NOT NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.orders (user_id);
`;

describe("validate_ddl — clean canonical DDL", () => {
  it("returns safe:true when DDL follows all best practices", async () => {
    const result = await lint(CANONICAL_DDL);
    expect(result.safe).toBe(true);
    expect(highChecks(result)).toHaveLength(0);
  });

  it("summary reflects zero HIGH findings", async () => {
    const result = await lint(CANONICAL_DDL);
    expect(result.summary.high).toBe(0);
    expect(result.summary.total).toBe(result.summary.medium + result.summary.low);
  });

  it("note indicates no HIGH issues found", async () => {
    const result = await lint(CANONICAL_DDL);
    expect(result.note).toContain("No HIGH-severity");
  });
});

// ---------------------------------------------------------------------------
// HIGH severity checks
// ---------------------------------------------------------------------------

describe("validate_ddl — HIGH: missing-primary-key", () => {
  it("flags a table with no PRIMARY KEY defined", async () => {
    const ddl = `
      CREATE TABLE public.orphan (
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    const result = await lint(ddl);

    expect(result.safe).toBe(false);
    expect(hasRule(result, "missing-primary-key")).toBe(true);
    const check = result.checks.find((c) => c.rule_id === "missing-primary-key")!;
    expect(check.severity).toBe("HIGH");
    expect(check.table).toBe("public.orphan");
  });

  it("does NOT flag a table with inline PRIMARY KEY", async () => {
    const ddl = `
      CREATE TABLE public.users (
        id BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    const result = await lint(ddl);
    expect(highChecks(result).filter((c) => c.rule_id === "missing-primary-key")).toHaveLength(0);
  });

  it("does NOT flag a table with table-level PRIMARY KEY constraint", async () => {
    const ddl = `
      CREATE TABLE public.order_items (
        order_id   BIGINT NOT NULL,
        product_id BIGINT NOT NULL,
        quantity   INT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (order_id, product_id)
      );
      CREATE INDEX ON public.order_items (order_id);
      CREATE INDEX ON public.order_items (product_id);
    `;
    const result = await lint(ddl);
    expect(highChecks(result).filter((c) => c.rule_id === "missing-primary-key")).toHaveLength(0);
  });

  it("flags every table that is missing a PRIMARY KEY in multi-table DDL", async () => {
    const ddl = `
      CREATE TABLE public.a (name TEXT);
      CREATE TABLE public.b (label TEXT);
    `;
    const result = await lint(ddl);

    const pkChecks = result.checks.filter((c) => c.rule_id === "missing-primary-key");
    expect(pkChecks).toHaveLength(2);
    const tables = pkChecks.map((c) => c.table);
    expect(tables).toContain("public.a");
    expect(tables).toContain("public.b");
  });
});

describe("validate_ddl — HIGH: fk-column-missing-index", () => {
  it("flags a FK column (inline REFERENCES) without a CREATE INDEX", async () => {
    const ddl = `
      CREATE TABLE public.orders (
        id      BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES public.users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    const result = await lint(ddl);

    expect(result.safe).toBe(false);
    const check = result.checks.find((c) => c.rule_id === "fk-column-missing-index");
    expect(check).toBeDefined();
    expect(check!.severity).toBe("HIGH");
    expect(check!.table).toBe("public.orders");
    expect(check!.column).toBe("user_id");
    expect(check!.suggestion).toContain("CREATE INDEX");
  });

  it("does NOT flag when a CREATE INDEX covers the FK column", async () => {
    const ddl = `
      CREATE TABLE public.orders (
        id      BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES public.users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX ON public.orders (user_id);
    `;
    const result = await lint(ddl);
    const fkIndexChecks = highChecks(result).filter((c) => c.rule_id === "fk-column-missing-index");
    expect(fkIndexChecks).toHaveLength(0);
  });

  it("does NOT flag when a UNIQUE INDEX covers the FK column", async () => {
    const ddl = `
      CREATE TABLE public.orders (
        id      BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES public.users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX ON public.orders (user_id);
    `;
    const result = await lint(ddl);
    const fkIndexChecks = highChecks(result).filter((c) => c.rule_id === "fk-column-missing-index");
    expect(fkIndexChecks).toHaveLength(0);
  });

  it("flags each FK column independently when multiple are unindexed", async () => {
    const ddl = `
      CREATE TABLE public.order_items (
        id         BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        order_id   BIGINT NOT NULL REFERENCES public.orders(id),
        product_id BIGINT NOT NULL REFERENCES public.products(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    const result = await lint(ddl);

    const fkChecks = result.checks.filter((c) => c.rule_id === "fk-column-missing-index");
    expect(fkChecks).toHaveLength(2);
    const cols = fkChecks.map((c) => c.column);
    expect(cols).toContain("order_id");
    expect(cols).toContain("product_id");
  });

  it("is resolved when all FK columns have CREATE INDEX statements", async () => {
    const ddl = `
      CREATE TABLE public.order_items (
        id         BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        order_id   BIGINT NOT NULL REFERENCES public.orders(id),
        product_id BIGINT NOT NULL REFERENCES public.products(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX ON public.order_items (order_id);
      CREATE INDEX ON public.order_items (product_id);
    `;
    const result = await lint(ddl);
    const fkChecks = highChecks(result).filter((c) => c.rule_id === "fk-column-missing-index");
    expect(fkChecks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// MEDIUM severity checks
// ---------------------------------------------------------------------------

describe("validate_ddl — MEDIUM: prefer-identity-over-serial", () => {
  it("flags SERIAL", async () => {
    const result = await lint(`CREATE TABLE public.t (id SERIAL PRIMARY KEY);`);
    expect(hasRule(result, "prefer-identity-over-serial")).toBe(true);
    expect(result.checks.find((c) => c.rule_id === "prefer-identity-over-serial")!.severity).toBe("MEDIUM");
  });

  it("flags BIGSERIAL", async () => {
    const result = await lint(`CREATE TABLE public.t (id BIGSERIAL PRIMARY KEY);`);
    expect(hasRule(result, "prefer-identity-over-serial")).toBe(true);
  });

  it("flags SMALLSERIAL", async () => {
    const result = await lint(`CREATE TABLE public.t (id SMALLSERIAL PRIMARY KEY);`);
    expect(hasRule(result, "prefer-identity-over-serial")).toBe(true);
  });

  it("does NOT flag IDENTITY columns", async () => {
    const result = await lint(
      `CREATE TABLE public.t (id BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY);`
    );
    expect(hasRule(result, "prefer-identity-over-serial")).toBe(false);
  });

  it("does NOT flag SERIAL for MySQL dialect", async () => {
    const result = await lint(`CREATE TABLE t (id SERIAL PRIMARY KEY);`, "mysql");
    expect(hasRule(result, "prefer-identity-over-serial")).toBe(false);
  });

  it("includes IDENTITY replacement suggestion", async () => {
    const result = await lint(`CREATE TABLE public.t (id SERIAL PRIMARY KEY);`);
    const check = result.checks.find((c) => c.rule_id === "prefer-identity-over-serial")!;
    expect(check.suggestion).toContain("IDENTITY");
  });
});

describe("validate_ddl — MEDIUM: prefer-uuid-v7-over-v4", () => {
  it("flags uuid_generate_v4() as PK default", async () => {
    const result = await lint(
      `CREATE TABLE public.events (id UUID DEFAULT uuid_generate_v4() PRIMARY KEY);`
    );
    expect(hasRule(result, "prefer-uuid-v7-over-v4")).toBe(true);
    expect(result.checks.find((c) => c.rule_id === "prefer-uuid-v7-over-v4")!.severity).toBe("MEDIUM");
  });

  it("suggestion mentions uuid_generate_v7", async () => {
    const result = await lint(
      `CREATE TABLE public.events (id UUID DEFAULT uuid_generate_v4() PRIMARY KEY);`
    );
    const check = result.checks.find((c) => c.rule_id === "prefer-uuid-v7-over-v4")!;
    expect(check.suggestion).toContain("uuid_generate_v7");
  });

  it("does NOT flag uuid_generate_v7", async () => {
    const result = await lint(
      `CREATE TABLE public.events (id UUID DEFAULT uuid_generate_v7() PRIMARY KEY);`
    );
    expect(hasRule(result, "prefer-uuid-v7-over-v4")).toBe(false);
  });
});

describe("validate_ddl — MEDIUM: prefer-text-over-varchar", () => {
  it("flags VARCHAR(n) with a length limit on PostgreSQL", async () => {
    const result = await lint(
      `CREATE TABLE public.products (id BIGINT NOT NULL PRIMARY KEY, name VARCHAR(255) NOT NULL);`
    );
    expect(hasRule(result, "prefer-text-over-varchar")).toBe(true);
    expect(result.checks.find((c) => c.rule_id === "prefer-text-over-varchar")!.severity).toBe("MEDIUM");
  });

  it("flags CHARACTER VARYING(n)", async () => {
    const result = await lint(
      `CREATE TABLE public.t (id BIGINT NOT NULL PRIMARY KEY, label CHARACTER VARYING(100) NOT NULL);`
    );
    expect(hasRule(result, "prefer-text-over-varchar")).toBe(true);
  });

  it("suggestion recommends TEXT", async () => {
    const result = await lint(`CREATE TABLE public.t (id BIGINT NOT NULL PRIMARY KEY, name VARCHAR(50));`);
    const check = result.checks.find((c) => c.rule_id === "prefer-text-over-varchar")!;
    expect(check.suggestion).toContain("TEXT");
  });

  it("does NOT flag plain TEXT columns", async () => {
    const result = await lint(
      `CREATE TABLE public.t (id BIGINT NOT NULL PRIMARY KEY, name TEXT NOT NULL);`
    );
    expect(hasRule(result, "prefer-text-over-varchar")).toBe(false);
  });

  it("does NOT flag VARCHAR(n) for MySQL dialect", async () => {
    const result = await lint(
      `CREATE TABLE t (id BIGINT NOT NULL PRIMARY KEY, name VARCHAR(255) NOT NULL);`,
      "mysql"
    );
    expect(hasRule(result, "prefer-text-over-varchar")).toBe(false);
  });

  it("does NOT flag VARCHAR(n) for SQLite dialect", async () => {
    const result = await lint(
      `CREATE TABLE t (id INTEGER PRIMARY KEY, name VARCHAR(255));`,
      "sqlite"
    );
    expect(hasRule(result, "prefer-text-over-varchar")).toBe(false);
  });
});

describe("validate_ddl — MEDIUM: column-naming-convention", () => {
  it("flags camelCase column names", async () => {
    const ddl = `
      CREATE TABLE public.orders (
        id BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        userId BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    const result = await lint(ddl);
    const check = result.checks.find(
      (c) => c.rule_id === "column-naming-convention" && c.column === "userId"
    );
    expect(check).toBeDefined();
    expect(check!.severity).toBe("MEDIUM");
  });

  it("flags PascalCase column names", async () => {
    const ddl = `
      CREATE TABLE public.orders (
        Id BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    const result = await lint(ddl);
    const check = result.checks.find(
      (c) => c.rule_id === "column-naming-convention" && c.column === "Id"
    );
    expect(check).toBeDefined();
  });

  it("does NOT flag valid snake_case names", async () => {
    const ddl = `
      CREATE TABLE public.orders (
        id BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        order_status TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX ON public.orders (user_id);
    `;
    const result = await lint(ddl);
    const namingChecks = result.checks.filter((c) => c.rule_id === "column-naming-convention");
    expect(namingChecks).toHaveLength(0);
  });

  it("includes a rename suggestion", async () => {
    const ddl = `
      CREATE TABLE public.t (
        id BIGINT NOT NULL PRIMARY KEY,
        myColumnName TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    const result = await lint(ddl);
    const check = result.checks.find(
      (c) => c.rule_id === "column-naming-convention" && c.column === "myColumnName"
    )!;
    expect(check.suggestion).toContain("my_column_name");
  });
});

describe("validate_ddl — MEDIUM: prefer-timestamptz", () => {
  it("flags TIMESTAMP without time zone for PostgreSQL", async () => {
    const ddl = `
      CREATE TABLE public.events (
        id          BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        happened_at TIMESTAMP NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    const result = await lint(ddl);
    const check = result.checks.find((c) => c.rule_id === "prefer-timestamptz");
    expect(check).toBeDefined();
    expect(check!.severity).toBe("MEDIUM");
    expect(check!.column).toBe("happened_at");
  });

  it("does NOT flag TIMESTAMPTZ", async () => {
    const ddl = `
      CREATE TABLE public.events (
        id         BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    const result = await lint(ddl);
    const tsChecks = result.checks.filter((c) => c.rule_id === "prefer-timestamptz");
    expect(tsChecks).toHaveLength(0);
  });

  it("does NOT flag TIMESTAMP WITH TIME ZONE", async () => {
    const ddl = `
      CREATE TABLE public.events (
        id         BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      );
    `;
    const result = await lint(ddl);
    const tsChecks = result.checks.filter((c) => c.rule_id === "prefer-timestamptz");
    expect(tsChecks).toHaveLength(0);
  });

  it("does NOT flag TIMESTAMP columns for MySQL", async () => {
    const result = await lint(
      `CREATE TABLE t (id BIGINT NOT NULL PRIMARY KEY, created_at TIMESTAMP NOT NULL);`,
      "mysql"
    );
    expect(hasRule(result, "prefer-timestamptz")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LOW severity checks
// ---------------------------------------------------------------------------

describe("validate_ddl — LOW: missing-audit-columns", () => {
  it("flags when both created_at and updated_at are absent", async () => {
    const ddl = `
      CREATE TABLE public.lean (
        id   BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        name TEXT NOT NULL
      );
    `;
    const result = await lint(ddl);
    const check = result.checks.find((c) => c.rule_id === "missing-audit-columns");
    expect(check).toBeDefined();
    expect(check!.severity).toBe("LOW");
    expect(check!.message).toContain("created_at");
    expect(check!.message).toContain("updated_at");
  });

  it("flags when only updated_at is missing", async () => {
    const ddl = `
      CREATE TABLE public.t (
        id         BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    const result = await lint(ddl);
    const check = result.checks.find((c) => c.rule_id === "missing-audit-columns");
    expect(check).toBeDefined();
    expect(check!.message).toContain("updated_at");
    expect(check!.message).not.toContain("created_at");
  });

  it("flags when only created_at is missing", async () => {
    const ddl = `
      CREATE TABLE public.t (
        id         BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    const result = await lint(ddl);
    const check = result.checks.find((c) => c.rule_id === "missing-audit-columns");
    expect(check).toBeDefined();
    expect(check!.message).toContain("created_at");
  });

  it("does NOT flag when both audit columns are present", async () => {
    const ddl = `
      CREATE TABLE public.t (
        id         BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    const result = await lint(ddl);
    expect(hasRule(result, "missing-audit-columns")).toBe(false);
  });

  it("includes DEFAULT now() in the suggestion", async () => {
    const ddl = `CREATE TABLE public.t (id BIGINT NOT NULL PRIMARY KEY);`;
    const result = await lint(ddl);
    const check = result.checks.find((c) => c.rule_id === "missing-audit-columns")!;
    expect(check.suggestion).toContain("DEFAULT now()");
  });
});

describe("validate_ddl — LOW: fk-column-missing-constraint", () => {
  it("flags an _id column with no REFERENCES clause", async () => {
    const ddl = `
      CREATE TABLE public.orders (
        id          BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        customer_id BIGINT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    const result = await lint(ddl);
    const check = result.checks.find(
      (c) => c.rule_id === "fk-column-missing-constraint" && c.column === "customer_id"
    );
    expect(check).toBeDefined();
    expect(check!.severity).toBe("LOW");
  });

  it("does NOT flag the id column itself as a missing FK", async () => {
    const ddl = `
      CREATE TABLE public.orders (
        id         BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    const result = await lint(ddl);
    const check = result.checks.find(
      (c) => c.rule_id === "fk-column-missing-constraint" && c.column === "id"
    );
    expect(check).toBeUndefined();
  });

  it("does NOT flag an _id column that already has a REFERENCES clause", async () => {
    const ddl = `
      CREATE TABLE public.orders (
        id      BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES public.users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX ON public.orders (user_id);
    `;
    const result = await lint(ddl);
    expect(hasRule(result, "fk-column-missing-constraint")).toBe(false);
  });
});

describe("validate_ddl — LOW: avoid-fixed-char", () => {
  it("flags CHAR(n) columns", async () => {
    const ddl = `
      CREATE TABLE public.codes (
        id   BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        code CHAR(5) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    const result = await lint(ddl);
    expect(hasRule(result, "avoid-fixed-char")).toBe(true);
    expect(result.checks.find((c) => c.rule_id === "avoid-fixed-char")!.severity).toBe("LOW");
  });
});

describe("validate_ddl — LOW: avoid-float-for-precision", () => {
  it("flags FLOAT columns", async () => {
    const ddl = `
      CREATE TABLE public.measurements (
        id    BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        value FLOAT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    const result = await lint(ddl);
    expect(hasRule(result, "avoid-float-for-precision")).toBe(true);
    expect(result.checks.find((c) => c.rule_id === "avoid-float-for-precision")!.severity).toBe("LOW");
  });

  it("flags REAL columns", async () => {
    const ddl = `
      CREATE TABLE public.t (
        id BIGINT NOT NULL PRIMARY KEY, score REAL NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    const result = await lint(ddl);
    expect(hasRule(result, "avoid-float-for-precision")).toBe(true);
  });

  it("flags DOUBLE PRECISION", async () => {
    const ddl = `
      CREATE TABLE public.t (
        id BIGINT NOT NULL PRIMARY KEY, ratio DOUBLE PRECISION,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    const result = await lint(ddl);
    expect(hasRule(result, "avoid-float-for-precision")).toBe(true);
  });

  it("does NOT flag NUMERIC / DECIMAL", async () => {
    const ddl = `
      CREATE TABLE public.prices (
        id    BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        price NUMERIC(10, 2) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    const result = await lint(ddl);
    expect(hasRule(result, "avoid-float-for-precision")).toBe(false);
  });

  it("suggestion recommends NUMERIC", async () => {
    const ddl = `
      CREATE TABLE public.t (id BIGINT NOT NULL PRIMARY KEY, price FLOAT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    const result = await lint(ddl);
    const check = result.checks.find((c) => c.rule_id === "avoid-float-for-precision")!;
    expect(check.suggestion).toContain("NUMERIC");
  });
});

// ---------------------------------------------------------------------------
// Summary and safe flag correctness
// ---------------------------------------------------------------------------

describe("validate_ddl — summary and safe flag", () => {
  it("safe is false when there is at least one HIGH check", async () => {
    const result = await lint(`CREATE TABLE public.t (name TEXT);`);
    expect(result.safe).toBe(false);
    expect(result.summary.high).toBeGreaterThan(0);
  });

  it("safe is true when there are only MEDIUM checks", async () => {
    const ddl = `
      CREATE TABLE public.t (
        id   SERIAL PRIMARY KEY,
        name VARCHAR(100),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    const result = await lint(ddl);
    // SERIAL → MEDIUM, VARCHAR(100) → MEDIUM, no HIGH
    expect(result.safe).toBe(true);
    expect(result.summary.high).toBe(0);
    expect(result.summary.medium).toBeGreaterThan(0);
  });

  it("summary.total equals sum of high + medium + low", async () => {
    const ddl = `
      CREATE TABLE public.t (
        name     VARCHAR(50),
        code     CHAR(3),
        price    FLOAT,
        happened TIMESTAMP
      );
    `;
    const result = await lint(ddl);
    expect(result.summary.total).toBe(
      result.summary.high + result.summary.medium + result.summary.low
    );
  });

  it("summary.total equals checks.length", async () => {
    const ddl = `CREATE TABLE public.t (id BIGINT NOT NULL PRIMARY KEY, price FLOAT);`;
    const result = await lint(ddl);
    expect(result.summary.total).toBe(result.checks.length);
  });

  it("note mentions HIGH count when issues exist", async () => {
    const result = await lint(`CREATE TABLE public.t (name TEXT);`);
    expect(result.note).toContain("HIGH-severity");
    expect(result.note).toContain("must be resolved");
  });
});

// ---------------------------------------------------------------------------
// Multi-table DDL
// ---------------------------------------------------------------------------

describe("validate_ddl — multi-table DDL", () => {
  it("analyzes every CREATE TABLE block independently", async () => {
    const ddl = `
      CREATE TABLE public.a (
        id         BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE public.b (
        label TEXT NOT NULL
      );
    `;
    const result = await lint(ddl);

    // Table b is missing PK and audit columns
    const pkChecks = result.checks.filter((c) => c.rule_id === "missing-primary-key");
    expect(pkChecks.map((c) => c.table)).toContain("public.b");
    expect(pkChecks.map((c) => c.table)).not.toContain("public.a");
  });

  it("CREATE INDEX in multi-table DDL resolves FK index for the correct table", async () => {
    const ddl = `
      CREATE TABLE public.orders (
        id      BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES public.users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE public.order_items (
        id         BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        order_id   BIGINT NOT NULL REFERENCES public.orders(id),
        product_id BIGINT NOT NULL REFERENCES public.products(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX ON public.orders (user_id);
      CREATE INDEX ON public.order_items (order_id);
      -- product_id intentionally NOT indexed
    `;
    const result = await lint(ddl);

    const fkChecks = highChecks(result).filter((c) => c.rule_id === "fk-column-missing-index");
    // Only product_id on order_items should be flagged
    expect(fkChecks).toHaveLength(1);
    expect(fkChecks[0].column).toBe("product_id");
    expect(fkChecks[0].table).toBe("public.order_items");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("validate_ddl — edge cases", () => {
  it("handles DDL with SQL comments gracefully", async () => {
    const ddl = `
      -- This is the orders table
      /* Used for storing customer orders */
      CREATE TABLE public.orders (
        id         BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    // Should not throw or produce garbage results
    const result = await lint(ddl);
    expect(result).toHaveProperty("safe");
    expect(result).toHaveProperty("checks");
    expect(highChecks(result).filter((c) => c.rule_id === "missing-primary-key")).toHaveLength(0);
  });

  it("returns safe:true with zero checks for empty DDL", async () => {
    const result = await lint("   ");
    expect(result.safe).toBe(true);
    expect(result.checks).toHaveLength(0);
  });

  it("handles IF NOT EXISTS syntax correctly", async () => {
    const ddl = `
      CREATE TABLE IF NOT EXISTS public.events (
        id         BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    const result = await lint(ddl);
    // Should detect the table and not flag missing PK
    expect(highChecks(result).filter((c) => c.rule_id === "missing-primary-key")).toHaveLength(0);
  });

  it("each check has the required fields: rule_id, severity, message, suggestion", async () => {
    const ddl = `CREATE TABLE public.t (name TEXT, price FLOAT);`;
    const result = await lint(ddl);

    for (const check of result.checks) {
      expect(check).toHaveProperty("rule_id");
      expect(check).toHaveProperty("severity");
      expect(check).toHaveProperty("message");
      expect(check).toHaveProperty("suggestion");
      expect(["HIGH", "MEDIUM", "LOW"]).toContain(check.severity);
      expect(typeof check.message).toBe("string");
      expect(typeof check.suggestion).toBe("string");
    }
  });
});
