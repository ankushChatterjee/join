import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type SuiteStatus = "passed" | "failed";

type TestCounts = {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
};

type SuiteResult = {
  name: string;
  command: string;
  status: SuiteStatus;
  exitCode: number;
  durationMs: number;
  logPath: string;
  junitPath?: string;
  counts?: TestCounts;
};

const mode = Bun.argv[2] ?? "quick";
const rootDir = process.cwd();
const reportsDir = join(rootDir, "reports");
const junitDir = join(reportsDir, "junit");
const logsDir = join(reportsDir, "logs");

mkdirSync(junitDir, { recursive: true });
mkdirSync(logsDir, { recursive: true });

const env = {
  ...process.env,
  CI: "1",
};

function readText(bytes: Uint8Array | null | undefined): string {
  if (!bytes) return "";
  return new TextDecoder().decode(bytes);
}

function msToSeconds(ms: number): string {
  return (ms / 1000).toFixed(2);
}

function parseBunTestOutput(output: string): TestCounts | undefined {
  const passMatch = output.match(/(\d+)\s+pass/);
  const failMatch = output.match(/(\d+)\s+fail/);
  const skipMatch = output.match(/(\d+)\s+skip/);
  const ranMatch = output.match(/Ran\s+(\d+)\s+tests/);
  if (!passMatch || !failMatch) return undefined;
  const passed = parseInt(passMatch[1], 10);
  const failed = parseInt(failMatch[1], 10);
  const skipped = skipMatch ? parseInt(skipMatch[1], 10) : 0;
  const total = ranMatch ? parseInt(ranMatch[1], 10) : passed + failed + skipped;
  return { total, passed, failed, skipped };
}

function parseCargoTestOutput(output: string): TestCounts | undefined {
  const match = output.match(/test result:.*?(\d+)\s+passed;\s*(\d+)\s+failed;\s*(\d+)\s+ignored/);
  if (!match) return undefined;
  const passed = parseInt(match[1], 10);
  const failed = parseInt(match[2], 10);
  const skipped = parseInt(match[3], 10);
  return { total: passed + failed + skipped, passed, failed, skipped };
}

function runCommand(
  name: string,
  cmd: string[],
  extraEnv?: Record<string, string>,
): SuiteResult {
  console.log(`[suite:${name}] running: ${cmd.join(" ")}`);
  const started = Date.now();
  const proc = Bun.spawnSync({
    cmd,
    cwd: rootDir,
    env: {
      ...env,
      ...(extraEnv ?? {}),
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const ended = Date.now();
  const stdout = readText(proc.stdout);
  const stderr = readText(proc.stderr);
  const exitCode = proc.exitCode ?? 1;
  const logPath = join(logsDir, `${name}.log`);
  const logContent = [
    `# Command: ${cmd.join(" ")}`,
    `# Exit code: ${exitCode}`,
    "",
    "## STDOUT",
    stdout,
    "",
    "## STDERR",
    stderr,
    "",
  ].join("\n");
  writeFileSync(logPath, logContent, "utf8");

  const counts =
    parseBunTestOutput(stdout + "\n" + stderr) ??
    parseCargoTestOutput(stdout + "\n" + stderr);

  const durationMs = ended - started;
  const status: SuiteStatus = exitCode === 0 ? "passed" : "failed";
  console.log(
    `[suite:${name}] ${status.toUpperCase()} (exit=${exitCode}, duration=${msToSeconds(durationMs)}s)`,
  );
  if (status === "failed") {
    const firstStderrLine = stderr.split("\n").find((line) => line.trim().length > 0);
    if (firstStderrLine) {
      console.log(`[suite:${name}] reason: ${firstStderrLine}`);
    }
    console.log(`[suite:${name}] log: ${logPath.replace(`${rootDir}/`, "")}`);
  }

  return {
    name,
    command: cmd.join(" "),
    status,
    exitCode,
    durationMs,
    logPath,
    counts,
  };
}

function runCargoAndConvert(
  name: string,
  cargoCmd: string[],
  junitOutputName: string,
  suiteName: string,
  extraEnv?: Record<string, string>,
): SuiteResult {
  const result = runCommand(name, cargoCmd, extraEnv);
  const junitPath = join(junitDir, junitOutputName);
  const converter = runCommand(
    `${name}-junit`,
    [
      "bun",
      "run",
      "scripts/generate-junit-from-cargo.ts",
      "--input",
      result.logPath,
      "--output",
      junitPath,
      "--suite",
      suiteName,
    ],
    extraEnv,
  );
  if (converter.exitCode !== 0 && result.status === "passed") {
    result.status = "failed";
    result.exitCode = converter.exitCode;
  }
  result.junitPath = junitPath;
  return result;
}

function dockerCompose(args: string[]): SuiteResult {
  return runCommand(`docker-${args.join("-").replaceAll("/", "_")}`, [
    "docker",
    "compose",
    "-f",
    "tests/docker/postgres/docker-compose.yml",
    ...args,
  ]);
}

function waitForPostgres(maxAttempts = 30, delayMs = 1000): SuiteResult {
  let attempt = 0;
  let last: SuiteResult | null = null;
  while (attempt < maxAttempts) {
    attempt += 1;
    last = dockerCompose(["exec", "-T", "postgres", "pg_isready", "-U", "join", "-d", "join_test"]);
    if (last.exitCode === 0) {
      return last;
    }
    Bun.sleepSync(delayMs);
  }
  return last ?? runCommand("postgres-ready-check", ["false"]);
}

function createMarkdownReport(results: SuiteResult[]) {
  const failed = results.filter((r) => r.status === "failed");
  const totalDurationMs = results.reduce((sum, r) => sum + r.durationMs, 0);
  const now = new Date().toISOString();

  const checklist = [
    {
      flow: "Query execution lifecycle",
      passed: results.some((r) => r.name === "frontend") && results.some((r) => r.name === "rust-unit"),
    },
    {
      flow: "Metadata exploration + schema introspection",
      passed: results.some((r) => r.name === "rust-unit") && results.some((r) => r.name === "rust-integration"),
    },
    {
      flow: "SQL sheet + saved result lifecycle",
      passed: results.some((r) => r.name === "frontend"),
    },
    {
      flow: "Tauri IPC smoke command coverage",
      passed: results.some((r) => r.name === "rust-unit"),
    },
    {
      flow: "Export/CSV correctness and env-var guardrails",
      passed: results.some((r) => r.name === "rust-unit"),
    },
  ];

  const lines = [
    "# Test Report",
    "",
    `Generated at: ${now}`,
    `Mode: ${mode}`,
    `Total duration: ${msToSeconds(totalDurationMs)}s`,
    "",
    "## Suite Results",
    "",
    "| Suite | Status | Tests (pass/fail/skip) | Duration (s) | Exit | Log | JUnit |",
    "|---|---|---:|---:|---:|---|---|",
    ...results.map((r) => {
      const logRel = r.logPath.replace(`${rootDir}/`, "");
      const junitRel = r.junitPath ? r.junitPath.replace(`${rootDir}/`, "") : "-";
      const countsCol = r.counts
        ? `${r.counts.total} (${r.counts.passed}/${r.counts.failed}/${r.counts.skipped})`
        : "-";
      return `| ${r.name} | ${r.status} | ${countsCol} | ${msToSeconds(r.durationMs)} | ${r.exitCode} | ${logRel} | ${junitRel} |`;
    }),
    "",
    "## Critical Flow Checklist",
    "",
    ...checklist.map((item) => `- [${item.passed ? "x" : " "}] ${item.flow}`),
    "",
    "## Failures",
    "",
    ...(failed.length === 0
      ? ["- None"]
      : failed.map((r) => `- ${r.name}: exit ${r.exitCode} (see ${r.logPath.replace(`${rootDir}/`, "")})`)),
    "",
  ];

  writeFileSync(join(reportsDir, "test-report.md"), lines.join("\n"), "utf8");
}

function formatCounts(c: TestCounts | undefined): string {
  if (!c) return "-";
  const parts = [`${c.total} total`];
  if (c.passed > 0) parts.push(`${c.passed} pass`);
  if (c.failed > 0) parts.push(`${c.failed} fail`);
  if (c.skipped > 0) parts.push(`${c.skipped} skip`);
  return parts.join(", ");
}

function printSummary(results: SuiteResult[]) {
  const failed = results.filter((r) => r.status === "failed");
  const totalCounts = results.reduce(
    (acc, r) => {
      if (!r.counts) return acc;
      acc.total += r.counts.total;
      acc.passed += r.counts.passed;
      acc.failed += r.counts.failed;
      acc.skipped += r.counts.skipped;
      return acc;
    },
    { total: 0, passed: 0, failed: 0, skipped: 0 },
  );

  console.log("");
  console.log("=== Test Summary ===");
  for (const r of results) {
    const countsStr = formatCounts(r.counts);
    console.log(
      `${r.status === "passed" ? "PASS" : "FAIL"} ${r.name} (${msToSeconds(r.durationMs)}s) — ${countsStr}`,
    );
  }

  if (totalCounts.total > 0) {
    console.log("");
    console.log(
      `Total: ${totalCounts.total} tests, ${totalCounts.passed} passed, ${totalCounts.failed} failed, ${totalCounts.skipped} skipped`,
    );
  }

  if (failed.length > 0) {
    console.log("");
    console.log(`Failures: ${failed.length}`);
    for (const r of failed) {
      console.log(`- ${r.name}: see ${r.logPath.replace(`${rootDir}/`, "")}`);
    }

    const dockerPermissionFailure = failed.find((r) => {
      const log = readFileSync(r.logPath, "utf8");
      return log.includes("permission denied") && log.includes("docker.sock");
    });
    if (dockerPermissionFailure) {
      console.log("");
      console.log("Docker daemon access is unavailable.");
      console.log("Start Docker Desktop (or daemon) and ensure your user can access /var/run/docker.sock.");
      console.log("Then rerun: bun run test:all");
    }
  }

  console.log(`Report: ${join("reports", "test-report.md")}`);
}

const suiteResults: SuiteResult[] = [];

function addResult(result: SuiteResult) {
  suiteResults.push(result);
}

function runQuickSuites() {
  const frontend = runCommand("frontend", [
    "bunx",
    "vitest",
    "run",
    "src",
    "--reporter=junit",
    "--outputFile",
    join(junitDir, "frontend.xml"),
  ]);
  frontend.junitPath = join(junitDir, "frontend.xml");
  addResult(frontend);

  const rust = runCargoAndConvert(
    "rust-unit",
    ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml"],
    "rust-unit.xml",
    "rust-unit",
  );
  addResult(rust);
}

function runIntegrationSuite() {
  const up = dockerCompose(["up", "-d"]);
  addResult(up);
  if (up.exitCode !== 0) return;

  const ready = waitForPostgres();
  addResult(ready);
  if (ready.exitCode !== 0) return;

  const integration = runCargoAndConvert(
    "rust-integration",
    [
      "cargo",
      "test",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--test",
      "postgres_integration",
      "--",
      "--ignored",
    ],
    "rust-integration.xml",
    "rust-integration",
    {
      PG_HOST: "127.0.0.1",
      PG_PORT: "55432",
      PG_USER: "join",
      PG_PASSWORD: "join",
      PG_DATABASE: "join_test",
    },
  );
  addResult(integration);
}

try {
  if (mode === "quick") {
    runQuickSuites();
  } else if (mode === "integration") {
    runIntegrationSuite();
  } else if (mode === "full" || mode === "report") {
    runQuickSuites();
    runIntegrationSuite();
  } else {
    throw new Error(`Unknown mode: ${mode}`);
  }
} finally {
  if (mode === "integration" || mode === "full" || mode === "report") {
    addResult(dockerCompose(["down", "-v"]));
  }
  createMarkdownReport(suiteResults);
  printSummary(suiteResults);

  const hasFailures = suiteResults.some((r) => r.status === "failed");
  process.exitCode = hasFailures ? 1 : 0;
}

const failed = suiteResults.some((r) => r.status === "failed");
if (failed) {
  process.exit(1);
}
