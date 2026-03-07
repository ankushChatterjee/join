import { describe, expect, it } from "vitest";
import { sanitizeExternalUrl } from "./urlSafety";

describe("sanitizeExternalUrl", () => {
  it("allows https links", () => {
    expect(sanitizeExternalUrl("https://example.com/path?q=1")).toBe("https://example.com/path?q=1");
  });

  it("allows mailto links", () => {
    expect(sanitizeExternalUrl("mailto:test@example.com")).toBe("mailto:test@example.com");
  });

  it("blocks javascript links", () => {
    expect(sanitizeExternalUrl("javascript:alert(1)")).toBeNull();
  });

  it("blocks data links", () => {
    expect(sanitizeExternalUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("blocks file links", () => {
    expect(sanitizeExternalUrl("file:///tmp/secret")).toBeNull();
  });

  it("blocks relative links", () => {
    expect(sanitizeExternalUrl("/admin")).toBeNull();
    expect(sanitizeExternalUrl("../x")).toBeNull();
    expect(sanitizeExternalUrl("//evil.com")).toBeNull();
  });
});
