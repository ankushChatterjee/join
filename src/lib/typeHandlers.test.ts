import { describe, expect, it } from "vitest";
import {
  formatArrayPreview,
  formatCompositePreview,
  formatJsonPreview,
  getTypeHandler,
  isArrayType,
  isCompositeTypeValue,
  isJsonType,
  isJsonValue,
  parseCompositeTypeString,
} from "./typeHandlers";

describe("typeHandlers", () => {
  it("detects JSON types only for databases with native support", () => {
    expect(isJsonType("jsonb", "postgresql")).toBe(true);
    expect(isJsonType("json", "mysql")).toBe(true);
    expect(isJsonType("json", "sqlite")).toBe(false);
  });

  it("detects json-like values and generates previews", () => {
    expect(isJsonValue({ a: 1 })).toBe(true);
    expect(isJsonValue("[1,2,3]")).toBe(true);
    expect(isJsonValue("plain text")).toBe(false);
    expect(formatJsonPreview({ a: 1 })).toContain("{");
  });

  it("parses composite type strings with nested tuples", () => {
    const parsed = parseCompositeTypeString('(foo,"bar,baz",(nested,1),qux)');
    expect(parsed).toEqual(["foo", "bar,baz", "(nested,1)", "qux"]);
  });

  it("recognizes backend composite objects", () => {
    const value = {
      _type: "shipping_address_type",
      _raw: "(1 Main St,Austin)",
      _display: "composite" as const,
    };
    expect(isCompositeTypeValue(value)).toBe(true);
    expect(formatCompositePreview(value)).toContain("1 Main St");
  });

  it("handles array typing and previews", () => {
    expect(isArrayType("text[]", "postgresql")).toBe(true);
    expect(isArrayType("json", "mysql")).toBe(false);
    expect(formatArrayPreview([1, 2, 3])).toContain("[1, 2, 3]");
  });

  it("returns special handler for json values on supported dialects", () => {
    const handler = getTypeHandler({ nested: { ok: true } }, "jsonb", "postgresql");
    expect(handler).not.toBeNull();
    expect(handler?.isSpecialType).toBe(true);
    expect(handler?.typeLabel).toBe("json");
  });
});
