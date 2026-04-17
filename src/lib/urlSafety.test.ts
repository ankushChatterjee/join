import { describe, expect, it } from "bun:test";
import { sanitizeExternalUrl } from "./urlSafety";

describe("external URL safety", () => {
  it("allows https and mailto URLs", () => {
    expect(sanitizeExternalUrl(" https://example.com/path?q=1 ")).toBe("https://example.com/path?q=1");
    expect(sanitizeExternalUrl("mailto:test@example.com")).toBe("mailto:test@example.com");
  });

  it("rejects relative, protocol-relative, javascript, data, and http URLs", () => {
    expect(sanitizeExternalUrl("")).toBeNull();
    expect(sanitizeExternalUrl("/local")).toBeNull();
    expect(sanitizeExternalUrl("../local")).toBeNull();
    expect(sanitizeExternalUrl("//example.com")).toBeNull();
    expect(sanitizeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeExternalUrl("data:text/html,hi")).toBeNull();
    expect(sanitizeExternalUrl("http://example.com")).toBeNull();
  });
});
