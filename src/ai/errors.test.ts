import { describe, expect, it } from "bun:test";
import { formatAiError, toAiError } from "./errors";

describe("AI error formatting", () => {
  it("extracts provider messages from structured API errors", () => {
    const message = formatAiError({
      statusCode: 400,
      responseBody: JSON.stringify({
        error: {
          message: "Unsupported parameter: temperature",
          type: "invalid_request_error",
          code: "unsupported_parameter",
        },
      }),
    });

    expect(message).toBe(
      "HTTP 400: Unsupported parameter: temperature (invalid_request_error, unsupported_parameter)"
    );
  });

  it("uses nested causes when an Error message is object Object", () => {
    const original = new Error("[object Object]");
    (original as Error & { cause?: unknown }).cause = {
      error: { message: "The model is overloaded", code: "rate_limit_exceeded" },
    };

    expect(formatAiError(original)).toBe("The model is overloaded (rate_limit_exceeded)");
  });

  it("wraps raw objects as useful Error instances", () => {
    const normalized = toAiError({ message: "[object Object]", data: { error: { message: "Bad request" } } });

    expect(normalized).toBeInstanceOf(Error);
    expect(normalized.message).toBe("Bad request");
  });
});
