#!/usr/bin/env bash
set -euo pipefail

if command -v gitleaks >/dev/null 2>&1; then
  exec gitleaks git --redact --verbose --no-banner
fi

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  exec docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:latest git --redact --verbose --no-banner
fi

echo "Gitleaks is not installed. Install it with 'brew install gitleaks' or ensure Docker daemon is running." >&2
exit 127
