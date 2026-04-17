import { describe, expect, it } from "bun:test";
import {
  analyzeSqlPlaceholders,
  applySqlParams,
  buildParamCacheKey,
  getParamDefaults,
  normalizeSqlForParamCache,
  setParamDefaults,
} from "./sqlParameters";

describe("sql parameter parsing", () => {
  it("normalizes whitespace and trailing semicolons for stable cache keys", () => {
    expect(normalizeSqlForParamCache("  SELECT   *  FROM users ; ; ")).toBe("SELECT * FROM users");
    expect(buildParamCacheKey("c1", "SELECT  * FROM users ;", "named")).toBe(
      buildParamCacheKey("c1", "SELECT * FROM   users", "named")
    );
  });

  it("builds named defaults and reuses submitted values", () => {
    const sql = "SELECT * FROM users WHERE id = :id AND org = :org";
    const analyzed = analyzeSqlPlaceholders(sql);
    expect(analyzed.error).toBeNull();
    expect(analyzed.spec?.mode).toBe("named");
    if (!analyzed.spec || analyzed.spec.mode !== "named") throw new Error("expected named spec");

    const key = buildParamCacheKey("c1", sql, "named");
    expect(getParamDefaults({}, key, analyzed.spec)).toEqual({
      mode: "named",
      values: { id: null, org: null },
    });

    const cache = setParamDefaults({}, key, { mode: "named", values: { id: "123", org: "acme" } });
    expect(getParamDefaults(cache, key, analyzed.spec)).toEqual({
      mode: "named",
      values: { id: "123", org: "acme" },
    });
  });

  it("builds positional defaults and substitutes by index", () => {
    const sql = "SELECT * FROM users WHERE id = ? AND org_id = ?";
    const analyzed = analyzeSqlPlaceholders(sql);
    expect(analyzed.error).toBeNull();
    expect(analyzed.spec?.mode).toBe("positional");
    if (!analyzed.spec || analyzed.spec.mode !== "positional") throw new Error("expected positional spec");

    const key = buildParamCacheKey("c1", sql, "positional");
    expect(getParamDefaults({}, key, analyzed.spec)).toEqual({
      mode: "positional",
      values: [null, null],
    });
    expect(applySqlParams(sql, analyzed.spec, { mode: "positional", values: ["12", "55"] })).toBe(
      "SELECT * FROM users WHERE id = '12' AND org_id = '55'"
    );
  });

  it("rejects mixed placeholder styles", () => {
    const analyzed = analyzeSqlPlaceholders("SELECT * FROM users WHERE id = :id AND org_id = ?");
    expect(analyzed.spec).toBeNull();
    expect(analyzed.error).toContain("Cannot mix");
  });

  it("ignores placeholders inside strings, comments, casts, operators, and dollar quotes", () => {
    const analyzed = analyzeSqlPlaceholders(
      "SELECT ':x' AS a, col::text, data ?? 'k', $$ :ignored ? $$ FROM t -- ?\nWHERE id = :id /* :noop ? */"
    );
    expect(analyzed.error).toBeNull();
    expect(analyzed.spec?.mode).toBe("named");
    if (!analyzed.spec || analyzed.spec.mode !== "named") throw new Error("expected named spec");
    expect(analyzed.spec.names).toEqual(["id"]);
  });

  it("escapes named values and reuses duplicate placeholders", () => {
    const sql = "SELECT * FROM t WHERE a = :id OR b = :id OR name = :name";
    const analyzed = analyzeSqlPlaceholders(sql);
    expect(analyzed.spec?.mode).toBe("named");
    if (!analyzed.spec || analyzed.spec.mode !== "named") throw new Error("expected named spec");

    expect(
      applySqlParams(sql, analyzed.spec, {
        mode: "named",
        values: { id: "42", name: "O'Brien" },
      })
    ).toBe("SELECT * FROM t WHERE a = '42' OR b = '42' OR name = 'O''Brien'");
  });
});
