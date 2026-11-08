#!/usr/bin/env bash
# Proves the custom Semgrep rules: the violating fixture must produce findings (exit != 0),
# the clean fixture and the real code must produce none. Runs in CI and locally (needs Docker).
set -euo pipefail
IMAGE="semgrep/semgrep@sha256:2e45517a85e13a9cca14a2a00df6bb48affd66b8ebfae1b0991cd57578362fb0"
RUN=(docker run --rm -v "$PWD:/src" -w /src "$IMAGE" semgrep --config .semgrep/rentcar.yml --metrics=off --error)

echo "1/2 violating fixture must fail"
if "${RUN[@]}" tests/security/semgrep-fixtures/violations/bad.ts; then
  echo "FAIL: rules did not detect the violating fixture" >&2
  exit 1
fi

echo "2/2 clean fixture and real code must pass"
"${RUN[@]}" tests/security/semgrep-fixtures/clean src scripts
echo "OK: custom Semgrep rules behave as specified"
