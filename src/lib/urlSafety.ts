export function sanitizeExternalUrl(href: string): string | null {
  const value = href.trim();
  if (!value) return null;

  // Reject relative URLs and protocol-relative URLs.
  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../") || value.startsWith("//")) {
    return null;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:") {
      return parsed.toString();
    }
    if (parsed.protocol === "mailto:") {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}
