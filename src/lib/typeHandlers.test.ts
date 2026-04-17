import { describe, expect, it } from "bun:test";
import {
  formatArrayItem,
  formatArrayPretty,
  formatArrayPreview,
  formatCompositePretty,
  formatCompositePreview,
  formatJsonPretty,
  formatJsonPreview,
  getTypeHandler,
  hasNativeJsonSupport,
  isArrayType,
  isArrayValue,
  isCompositeTypeValue,
  isJsonType,
  isJsonValue,
  parseCompositeTypeString,
} from "./typeHandlers";

describe("database type display helpers", () => {
  it("detects JSON support by dialect and type name", () => {
    expect(hasNativeJsonSupport("postgresql")).toBe(true);
    expect(hasNativeJsonSupport("mysql")).toBe(true);
    expect(hasNativeJsonSupport("sqlite")).toBe(false);
    expect(isJsonType("jsonb", "postgresql")).toBe(true);
    expect(isJsonType("json", "mysql")).toBe(true);
    expect(isJsonType("json", "sqlite")).toBe(false);
  });

  it("formats JSON previews and pretty output", () => {
    expect(isJsonValue({ a: 1 })).toBe(true);
    expect(isJsonValue("[1,2,3]")).toBe(true);
    expect(isJsonValue("plain text")).toBe(false);
    expect(formatJsonPreview({ a: 1 })).toBe('{"a":1}');
    expect(formatJsonPretty('{"a":1}')).toContain('\n  "a": 1\n');
  });

  it("parses and formats composite values", () => {
    const parsed = parseCompositeTypeString('(foo,"bar,baz",(nested,1),qux)');
    expect(parsed).toEqual(["foo", "bar,baz", "(nested,1)", "qux"]);

    const value = { _type: "shipping_address_type", _raw: "(1 Main St,Austin)", _display: "composite" as const };
    expect(isCompositeTypeValue(value)).toBe(true);
    expect(formatCompositePreview(value)).toContain("1 Main St");
    expect(formatCompositePretty(value)).toContain("Type: shipping_address_type");
  });

  it("detects and formats arrays", () => {
    expect(isArrayType("text[]", "postgresql")).toBe(true);
    expect(isArrayType("_int4", "postgresql")).toBe(true);
    expect(isArrayType("json", "mysql")).toBe(false);
    expect(isArrayValue([1, 2, 3])).toBe(true);
    expect(formatArrayPreview([1, 2, 3])).toBe("[1, 2, 3]");
    expect(formatArrayPreview(["a", "b", "c", "d", "e", "f"])).toBe('["a", "b", "c", "d", "e", …]');
    expect(formatArrayPretty([1, { ok: true }])).toContain('"ok": true');
    expect(formatArrayItem({ ok: true })).toBe('{"ok":true}');
  });

  it("returns special handlers only when the dialect supports them", () => {
    const handler = getTypeHandler({ nested: { ok: true } }, "jsonb", "postgresql");
    expect(handler?.isSpecialType).toBe(true);
    expect(handler?.typeLabel).toBe("json");
    expect(getTypeHandler({ nested: true }, "json", "sqlite")).toBeNull();
  });
});
