# Test Report

Generated at: 2026-02-25T18:26:13.550Z
Mode: full
Total duration: 5.45s

## Suite Results

| Suite | Status | Duration (s) | Exit | Log | JUnit |
|---|---|---:|---:|---|---|
| frontend | passed | 0.30 | 0 | reports/logs/frontend.log | reports/junit/frontend.xml |
| rust-unit | passed | 2.37 | 0 | reports/logs/rust-unit.log | reports/junit/rust-unit.xml |
| docker-up--d | passed | 1.52 | 0 | reports/logs/docker-up--d.log | - |
| docker-exec--T-postgres-pg_isready--U-join--d-join_test | passed | 0.19 | 0 | reports/logs/docker-exec--T-postgres-pg_isready--U-join--d-join_test.log | - |
| rust-integration | passed | 0.83 | 0 | reports/logs/rust-integration.log | reports/junit/rust-integration.xml |
| docker-down--v | passed | 0.25 | 0 | reports/logs/docker-down--v.log | - |

## Critical Flow Checklist

- [x] Query execution lifecycle
- [x] Metadata exploration + schema introspection
- [x] SQL sheet + saved result lifecycle
- [x] Tauri IPC smoke command coverage
- [x] Export/CSV correctness and env-var guardrails

## Failures

- None
