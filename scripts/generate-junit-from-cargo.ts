import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type ParsedCase = {
  name: string;
  status: "ok" | "FAILED" | "ignored";
  timeSeconds: number;
  failureMessage?: string;
};

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function getArg(flag: string, fallback?: string): string {
  const idx = Bun.argv.indexOf(flag);
  if (idx >= 0 && Bun.argv[idx + 1]) {
    return Bun.argv[idx + 1];
  }
  if (fallback != null) return fallback;
  throw new Error(`Missing required argument: ${flag}`);
}

const inputPath = getArg("--input");
const outputPath = getArg("--output");
const suiteName = getArg("--suite", "cargo-tests");

const raw = readFileSync(inputPath, "utf8");
const lines = raw.split(/\r?\n/);

const failureDetails = new Map<string, string>();
let activeFailureName: string | null = null;
const activeFailureLines: string[] = [];

for (const line of lines) {
  const sectionMatch = line.match(/^---- (.+?) stdout ----$/);
  if (sectionMatch) {
    if (activeFailureName) {
      failureDetails.set(activeFailureName, activeFailureLines.join("\n").trim());
      activeFailureLines.length = 0;
    }
    activeFailureName = sectionMatch[1];
    continue;
  }

  if (activeFailureName) {
    if (
      line.startsWith("failures:") ||
      line.startsWith("test result:") ||
      line.match(/^---- .+? stdout ----$/)
    ) {
      failureDetails.set(activeFailureName, activeFailureLines.join("\n").trim());
      activeFailureName = null;
      activeFailureLines.length = 0;
    } else {
      activeFailureLines.push(line);
    }
  }
}

if (activeFailureName) {
  failureDetails.set(activeFailureName, activeFailureLines.join("\n").trim());
}

const cases: ParsedCase[] = [];
for (const line of lines) {
  const match = line.match(/^test (.+?) \.\.\. (ok|FAILED|ignored)(?: \(([\d.]+)s\))?$/);
  if (!match) continue;
  const name = match[1];
  const status = match[2] as ParsedCase["status"];
  const timeSeconds = match[3] ? Number(match[3]) : 0;
  cases.push({
    name,
    status,
    timeSeconds: Number.isFinite(timeSeconds) ? timeSeconds : 0,
    failureMessage: status === "FAILED" ? failureDetails.get(name) ?? "Assertion failed" : undefined,
  });
}

const tests = cases.length;
const failures = cases.filter((c) => c.status === "FAILED").length;
const skipped = cases.filter((c) => c.status === "ignored").length;
const totalTime = cases.reduce((sum, c) => sum + c.timeSeconds, 0);

const testcaseXml = cases
  .map((c) => {
    const open = `<testcase name="${xmlEscape(c.name)}" classname="${xmlEscape(suiteName)}" time="${c.timeSeconds.toFixed(3)}">`;
    if (c.status === "FAILED") {
      return `${open}<failure message="failed">${xmlEscape(c.failureMessage ?? "failed")}</failure></testcase>`;
    }
    if (c.status === "ignored") {
      return `${open}<skipped/></testcase>`;
    }
    return `${open}</testcase>`;
  })
  .join("");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="${xmlEscape(suiteName)}" tests="${tests}" failures="${failures}" skipped="${skipped}" time="${totalTime.toFixed(3)}">
    ${testcaseXml}
  </testsuite>
</testsuites>
`;

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, xml, "utf8");

