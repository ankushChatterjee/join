// ============================================================================
// AI Error Formatting
// ============================================================================

const EMPTY_ERROR = "An unknown error occurred";
const OBJECT_OBJECT = "[object Object]";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cleanMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === OBJECT_OBJECT) return null;
  return trimmed;
}

function getObjectValue(value: unknown, key: string): unknown {
  if (!isRecord(value)) return undefined;
  return value[key];
}

function parseJsonString(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function stringifySafely(value: unknown): string | null {
  if (!isRecord(value)) return null;

  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      value,
      (key, nestedValue) => {
        if (key.toLowerCase().includes("key") || key.toLowerCase().includes("token")) {
          return "[redacted]";
        }
        if (typeof nestedValue === "object" && nestedValue !== null) {
          if (seen.has(nestedValue)) return "[circular]";
          seen.add(nestedValue);
        }
        return nestedValue;
      },
      2
    );
  } catch {
    return null;
  }
}

function formatProviderBody(value: unknown): string | null {
  if (typeof value === "string") {
    const parsed = parseJsonString(value);
    if (parsed) return formatProviderBody(parsed);
    return cleanMessage(value);
  }

  if (!isRecord(value)) return null;

  const nestedError = getObjectValue(value, "error");
  if (nestedError) {
    const nested = formatProviderBody(nestedError);
    if (nested) return nested;
  }

  const message =
    cleanMessage(getObjectValue(value, "message")) ??
    cleanMessage(getObjectValue(value, "errorMessage")) ??
    cleanMessage(getObjectValue(value, "detail")) ??
    cleanMessage(getObjectValue(value, "statusText"));

  const code = cleanMessage(getObjectValue(value, "code"));
  const type = cleanMessage(getObjectValue(value, "type"));
  const status = cleanMessage(getObjectValue(value, "status"));

  if (message) {
    const tags = [status, type, code].filter(Boolean);
    return tags.length ? `${message} (${tags.join(", ")})` : message;
  }

  return stringifySafely(value);
}

export function formatAiError(error: unknown): string {
  const direct = cleanMessage(error);
  if (direct) return direct;

  if (error instanceof Error) {
    const message = cleanMessage(error.message);
    const cause = getObjectValue(error, "cause");
    const formattedCause = cause ? formatAiError(cause) : null;
    if (message && formattedCause && formattedCause !== message) {
      return `${message}: ${formattedCause}`;
    }
    if (message) return message;
    if (formattedCause) return formattedCause;
  }

  if (isRecord(error)) {
    const body =
      getObjectValue(error, "responseBody") ??
      getObjectValue(error, "body") ??
      getObjectValue(error, "data");
    const bodyMessage = body ? formatProviderBody(body) : null;

    const message =
      cleanMessage(getObjectValue(error, "message")) ??
      cleanMessage(getObjectValue(error, "errorMessage")) ??
      cleanMessage(getObjectValue(error, "statusText"));

    const nestedError = getObjectValue(error, "error");
    const nestedMessage = nestedError ? formatProviderBody(nestedError) : null;

    const statusCode = getObjectValue(error, "statusCode") ?? getObjectValue(error, "status");
    const status = typeof statusCode === "number" || typeof statusCode === "string"
      ? `HTTP ${statusCode}`
      : null;

    const best = message ?? nestedMessage ?? bodyMessage;
    if (best && status) return `${status}: ${best}`;
    if (best) return best;

    const cause = getObjectValue(error, "cause");
    if (cause) return formatAiError(cause);

    const json = stringifySafely(error);
    if (json) return json;
  }

  return cleanMessage(String(error)) ?? EMPTY_ERROR;
}

export function toAiError(error: unknown): Error {
  if (error instanceof Error && cleanMessage(error.message)) {
    return error;
  }

  const normalized = new Error(formatAiError(error));
  (normalized as Error & { cause?: unknown }).cause = error;
  return normalized;
}
