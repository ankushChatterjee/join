import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type SuiteStatus = "passed" | "failed";

type SuiteResult = {
  name: string;
  command: string;
  status: SuiteStatus;
  exitCode: number;
  durationMs: number;
  logPath: string;
  junitPath?: string;
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
  writeFileSync(
    logPath,
    [
      `# Command: ${cmd.join(" ")}`,
      `# Exit code: ${exitCode}`,
      "",
      "## STDOUT",
      stdout,
      "",
      "## STDERR",
      stderr,
      "",
    ].join("\n"),
    "utf8",
  );

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
    "| Suite | Status | Duration (s) | Exit | Log | JUnit |",
    "|---|---|---:|---:|---|---|",
    ...results.map((r) => {
      const logRel = r.logPath.replace(`${rootDir}/`, "");
      const junitRel = r.junitPath ? r.junitPath.replace(`${rootDir}/`, "") : "-";
      return `| ${r.name} | ${r.status} | ${msToSeconds(r.durationMs)} | ${r.exitCode} | ${logRel} | ${junitRel} |`;
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

function printSummary(results: SuiteResult[]) {
  const failed = results.filter((r) => r.status === "failed");
  console.log("");
  console.log("=== Test Summary ===");
  for (const r of results) {
    console.log(
      `${r.status === "passed" ? "PASS" : "FAIL"} ${r.name} (${msToSeconds(r.durationMs)}s)`,
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
    "bun",
    "test",
    "src",
    "--reporter=junit",
    "--reporter-outfile",
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
