import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

type Status = "PASS" | "FAIL" | "TIMEOUT" | "SETUP";

type Counts = {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
};

type Result = {
  name: string;
  status: Status;
  durationMs: number;
  logPath: string;
  counts?: Counts;
  reason?: string;
};

const root = process.cwd();
const mode = Bun.argv[2] ?? "quick";
const reportsDir = join(root, "reports");
const logsDir = join(reportsDir, "logs");
const junitDir = join(reportsDir, "junit");
const tscBin = join(root, "node_modules", ".bin", "tsc");
const dockerCompose = ["docker", "compose", "-f", "tests/docker/postgres/docker-compose.yml"];

const timeoutMs = {
  frontend: envTimeout("TEST_TIMEOUT_FRONTEND_MS", 60_000),
  rust: envTimeout("TEST_TIMEOUT_RUST_MS", 120_000),
  docker: envTimeout("TEST_TIMEOUT_DOCKER_MS", 60_000),
  dockerStop: envTimeout("TEST_TIMEOUT_DOCKER_STOP_MS", 30_000),
  postgresProbe: envTimeout("TEST_TIMEOUT_POSTGRES_PROBE_MS", 5_000),
};

resetReports();

function envTimeout(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function resetReports() {
  rmSync(reportsDir, { recursive: true, force: true });
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(junitDir, { recursive: true });
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

function rel(path: string): string {
  return relative(root, path) || ".";
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function firstUsefulLine(text: string): string | undefined {
  return stripAnsi(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function runCommand(
  name: string,
  command: string[],
  timeout: number,
  options: { setup?: boolean; env?: Record<string, string> } = {},
): Result & { stdout: string; stderr: string } {
  const started = Date.now();
  const logPath = join(logsDir, `${name}.log`);

  console.log(`${name}: running (${seconds(timeout)} timeout)`);

  const child = spawnSync(command[0], command.slice(1), {
    cwd: root,
    env: { ...process.env, CI: "1", ...options.env },
    encoding: "utf8",
    timeout,
    killSignal: "SIGKILL",
    maxBuffer: 50 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const durationMs = Date.now() - started;
  const stdout = child.stdout ?? "";
  const stderr = child.stderr ?? "";
  const timedOut = child.error && "code" in child.error && child.error.code === "ETIMEDOUT";
  const status: Status = timedOut ? "TIMEOUT" : child.status === 0 ? "PASS" : options.setup ? "SETUP" : "FAIL";
  const reason =
    status === "PASS"
      ? undefined
      : timedOut
        ? `timed out after ${seconds(timeout)}`
        : firstUsefulLine(stderr) ?? firstUsefulLine(stdout) ?? child.error?.message ?? `exit ${child.status ?? "-"}`;

  writeFileSync(
    logPath,
    [
      `command: ${command.join(" ")}`,
      `exit: ${child.status ?? "-"}`,
      `duration: ${seconds(durationMs)}`,
      ...(reason ? [`reason: ${reason}`] : []),
      "",
      "stdout:",
      stdout,
      "",
      "stderr:",
      stderr,
      "",
    ].join("\n"),
    "utf8",
  );

  console.log(`${name}: ${status}${reason ? ` - ${reason}` : ""}`);
  return { name, status, durationMs, logPath, reason, stdout, stderr };
}

function countsFromCargo(output: string): Counts | undefined {
  const summaries = [...output.matchAll(/test result:.*?(\d+)\s+passed;\s*(\d+)\s+failed;\s*(\d+)\s+ignored/g)];
  if (summaries.length === 0) return undefined;

  return summaries.reduce(
    (counts, summary) => {
      const passed = Number(summary[1]);
      const failed = Number(summary[2]);
      const skipped = Number(summary[3]);
      counts.total += passed + failed + skipped;
      counts.passed += passed;
      counts.failed += failed;
      counts.skipped += skipped;
      return counts;
    },
    { total: 0, passed: 0, failed: 0, skipped: 0 },
  );
}

function countsFromBunTest(output: string): Counts | undefined {
  const total = Number(output.match(/Ran\s+(\d+)\s+tests?\s+across/)?.[1] ?? NaN);
  const passed = Number(output.match(/^\s*(\d+)\s+pass$/m)?.[1] ?? 0);
  const failed = Number(output.match(/^\s*(\d+)\s+fail$/m)?.[1] ?? 0);
  const skipped = Number(output.match(/^\s*(\d+)\s+skip$/m)?.[1] ?? 0);
  if (!Number.isFinite(total)) return undefined;
  return { total, passed, failed, skipped };
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function writeSuiteJunit(name: string, counts: Counts | undefined, durationMs: number) {
  if (!counts) return;

  const path = join(junitDir, `${name}.xml`);
  writeFileSync(
    path,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<testsuite name="${escapeXml(name)}" tests="${counts.total}" failures="${counts.failed}" errors="0" skipped="${counts.skipped}" time="${(
        durationMs / 1000
      ).toFixed(3)}">`,
      "</testsuite>",
      "",
    ].join("\n"),
    "utf8",
  );
}

function frontendTypecheck(): Result {
  const result = runCommand("frontend-typecheck", [tscBin, "--noEmit", "--pretty", "false"], timeoutMs.frontend);
  const counts = { total: 0, passed: 0, failed: 0, skipped: 0 };
  writeSuiteJunit(result.name, counts, result.durationMs);
  return { ...result, counts };
}

function frontendTests(): Result {
  const result = runCommand("frontend-tests", ["bun", "test", "src"], timeoutMs.frontend);
  const counts = countsFromBunTest(`${result.stdout}\n${result.stderr}`);
  writeSuiteJunit(result.name, counts, result.durationMs);
  return { ...result, counts };
}

function rustUnit(): Result {
  const result = runCommand("rust-unit", ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--lib"], timeoutMs.rust);
  const counts = countsFromCargo(`${result.stdout}\n${result.stderr}`);
  writeSuiteJunit(result.name, counts, result.durationMs);
  return { ...result, counts };
}

function rustSqlite(): Result {
  const result = runCommand(
    "rust-sqlite",
    ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--test", "sqlite_integration"],
    timeoutMs.rust,
  );
  const counts = countsFromCargo(`${result.stdout}\n${result.stderr}`);
  writeSuiteJunit(result.name, counts, result.durationMs);
  return { ...result, counts };
}

function postgresStart(): Result {
  return runCommand("postgres-start", [...dockerCompose, "up", "-d"], timeoutMs.docker, { setup: true });
}

function postgresStop(): Result {
  return runCommand("postgres-stop", [...dockerCompose, "down", "-v"], timeoutMs.dockerStop, { setup: true });
}

function postgresReady(): Result {
  const started = Date.now();
  const logPath = join(logsDir, "postgres-ready.log");
  const command = [...dockerCompose, "exec", "-T", "postgres", "pg_isready", "-U", "join", "-d", "join_test"];
  const attempts: string[] = [];

  console.log(`postgres-ready: waiting (${seconds(timeoutMs.docker)} timeout)`);
  while (Date.now() - started < timeoutMs.docker) {
    const probe = spawnSync(command[0], command.slice(1), {
      cwd: root,
      env: { ...process.env, CI: "1" },
      encoding: "utf8",
      timeout: timeoutMs.postgresProbe,
      killSignal: "SIGKILL",
      stdio: ["ignore", "pipe", "pipe"],
    });

    attempts.push(`exit=${probe.status ?? "-"} ${firstUsefulLine(`${probe.stdout ?? ""}\n${probe.stderr ?? ""}`) ?? ""}`.trim());
    if (probe.status === 0) {
      const durationMs = Date.now() - started;
      writeFileSync(logPath, attempts.join("\n"), "utf8");
      console.log("postgres-ready: PASS");
      return { name: "postgres-ready", status: "PASS", durationMs, logPath };
    }

    Bun.sleepSync(1_000);
  }

  const durationMs = Date.now() - started;
  const reason = `Postgres was not ready after ${seconds(timeoutMs.docker)}`;
  writeFileSync(logPath, attempts.join("\n"), "utf8");
  console.log(`postgres-ready: SETUP - ${reason}`);
  return { name: "postgres-ready", status: "SETUP", durationMs, logPath, reason };
}

function rustPostgres(): Result[] {
  const start = postgresStart();
  if (start.status !== "PASS") return [start];

  const ready = postgresReady();
  if (ready.status !== "PASS") return [ready];

  const result = runCommand(
    "rust-postgres",
    ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--test", "postgres_integration", "--", "--ignored"],
    timeoutMs.rust,
    {
      env: {
        PG_HOST: "127.0.0.1",
        PG_PORT: "55432",
        PG_USER: "join",
        PG_PASSWORD: "join",
        PG_DATABASE: "join_test",
      },
    },
  );
  const counts = countsFromCargo(`${result.stdout}\n${result.stderr}`);
  writeSuiteJunit(result.name, counts, result.durationMs);
  return [{ ...result, counts }];
}

function printSummary(results: Result[]) {
  const totals = results.reduce(
    (sum, result) => {
      if (!result.counts) return sum;
      sum.total += result.counts.total;
      sum.passed += result.counts.passed;
      sum.failed += result.counts.failed;
      sum.skipped += result.counts.skipped;
      return sum;
    },
    { total: 0, passed: 0, failed: 0, skipped: 0 },
  );

  console.log("");
  console.log("Suite                 Status    Total  Pass  Fail  Skip   Time    Log");
  console.log("--------------------  --------  -----  ----  ----  ----  ------  ---");
  for (const result of results) {
    console.log(
      `${result.name.padEnd(20)}  ${result.status.padEnd(8)}  ${String(result.counts?.total ?? "-").padStart(5)}  ${String(
        result.counts?.passed ?? "-",
      ).padStart(4)}  ${String(result.counts?.failed ?? "-").padStart(4)}  ${String(result.counts?.skipped ?? "-").padStart(
        4,
      )}  ${seconds(result.durationMs).padStart(6)}  ${rel(result.logPath)}`,
    );
  }
  console.log("");
  console.log(`Total: ${totals.total} tests, ${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped`);

  const failed = results.filter((result) => result.status !== "PASS");
  if (failed.length > 0) {
    console.log("");
    console.log("Failures:");
    for (const result of failed) {
      console.log(`- ${result.name}: ${result.reason ?? result.status} (${rel(result.logPath)})`);
    }
  }

  console.log("");
  console.log(`Artifacts: ${rel(logsDir)}, ${rel(junitDir)}`);
}

function main(): number {
  const results: Result[] = [];
  const usesPostgres = mode === "integration" || mode === "all" || mode === "report";

  try {
    if (mode === "quick") results.push(frontendTypecheck(), frontendTests(), rustUnit());
    else if (mode === "frontend") results.push(frontendTypecheck(), frontendTests());
    else if (mode === "rust") results.push(rustUnit(), rustSqlite());
    else if (mode === "integration") results.push(rustSqlite(), ...rustPostgres());
    else if (mode === "all" || mode === "report")
      results.push(frontendTypecheck(), frontendTests(), rustUnit(), rustSqlite(), ...rustPostgres());
    else {
      const logPath = join(logsDir, "test-runner.log");
      const reason = `Unknown mode: ${mode}`;
      writeFileSync(logPath, reason, "utf8");
      results.push({ name: "test-runner", status: "FAIL", durationMs: 0, logPath, reason });
    }
  } finally {
    if (usesPostgres) {
      const stop = postgresStop();
      if (stop.status !== "PASS") results.push(stop);
    }
    printSummary(results);
  }

  return results.some((result) => result.status !== "PASS") ? 1 : 0;
}

process.exit(main());
