import { describe, expect, it } from "vitest";
import {
  analyzeSqlPlaceholders,
  applySqlParams,
  buildParamCacheKey,
  getParamDefaults,
  normalizeSqlForParamCache,
  setParamDefaults,
} from "./sqlParameters";

describe("sqlParameters cache utils", () => {
  it("normalizes whitespace and trailing semicolons", () => {
    expect(normalizeSqlForParamCache("  SELECT   *  FROM users ; ; ")).toBe(
      "SELECT * FROM users"
    );
  });

  it("builds stable key for same normalized sql", () => {
    const a = buildParamCacheKey("c1", "SELECT  * FROM users ;", "named");
    const b = buildParamCacheKey("c1", "SELECT * FROM   users", "named");
    expect(a).toBe(b);
  });

  it("gets and sets named defaults", () => {
    const sql = "SELECT * FROM users WHERE id = :id AND org = :org";
    const analyzed = analyzeSqlPlaceholders(sql);
    expect(analyzed.error).toBeNull();
    expect(analyzed.spec?.mode).toBe("named");
    if (!analyzed.spec || analyzed.spec.mode !== "named") return;

    const key = buildParamCacheKey("c1", sql, "named");
    const emptyDefaults = getParamDefaults({}, key, analyzed.spec);
    expect(emptyDefaults).toEqual({
      mode: "named",
      values: { id: null, org: null },
    });

    const updatedCache = setParamDefaults({}, key, {
      mode: "named",
      values: { id: "123", org: "acme" },
    });
    const loaded = getParamDefaults(updatedCache, key, analyzed.spec);
    expect(loaded).toEqual({
      mode: "named",
      values: { id: "123", org: "acme" },
    });
  });

  it("gets and sets positional defaults", () => {
    const sql = "SELECT * FROM users WHERE id = ? AND org_id = ?";
    const analyzed = analyzeSqlPlaceholders(sql);
    expect(analyzed.error).toBeNull();
    expect(analyzed.spec?.mode).toBe("positional");
    if (!analyzed.spec || analyzed.spec.mode !== "positional") return;

    const key = buildParamCacheKey("c1", sql, "positional");
    const emptyDefaults = getParamDefaults({}, key, analyzed.spec);
    expect(emptyDefaults).toEqual({
      mode: "positional",
      values: [null, null],
    });

    const updatedCache = setParamDefaults({}, key, {
      mode: "positional",
      values: ["12", "55"],
    });
    const loaded = getParamDefaults(updatedCache, key, analyzed.spec);
    expect(loaded).toEqual({
      mode: "positional",
      values: ["12", "55"],
    });
  });
});

describe("sqlParameters parsing and substitution", () => {
  it("rejects mixed placeholder styles", () => {
    const analyzed = analyzeSqlPlaceholders(
      "SELECT * FROM users WHERE id = :id AND org_id = ?"
    );
    expect(analyzed.spec).toBeNull();
    expect(String(analyzed.error)).toContain("Cannot mix");
  });

  it("ignores placeholders inside strings and comments", () => {
    const analyzed = analyzeSqlPlaceholders(
      "SELECT ':x' AS a -- ?\n, col FROM t WHERE id = :id /* :noop ? */"
    );
    expect(analyzed.error).toBeNull();
    expect(analyzed.spec?.mode).toBe("named");
    if (!analyzed.spec || analyzed.spec.mode !== "named") return;
    expect(analyzed.spec.names).toEqual(["id"]);
  });

  it("reuses same named value for duplicate placeholder", () => {
    const sql = "SELECT * FROM t WHERE a = :id OR b = :id";
    const analyzed = analyzeSqlPlaceholders(sql);
    expect(analyzed.spec?.mode).toBe("named");
    if (!analyzed.spec || analyzed.spec.mode !== "named") return;
    const finalSql = applySqlParams(sql, analyzed.spec, {
      mode: "named",
      values: { id: "42" },
    });
    expect(finalSql).toBe("SELECT * FROM t WHERE a = '42' OR b = '42'");
  });

  it("substitutes positional values by index", () => {
    const sql = "SELECT * FROM t WHERE a = ? AND b = ?";
    const analyzed = analyzeSqlPlaceholders(sql);
    expect(analyzed.spec?.mode).toBe("positional");
    if (!analyzed.spec || analyzed.spec.mode !== "positional") return;
    const finalSql = applySqlParams(sql, analyzed.spec, {
      mode: "positional",
      values: ["x", "y"],
    });
    expect(finalSql).toBe("SELECT * FROM t WHERE a = 'x' AND b = 'y'");
  });
});
