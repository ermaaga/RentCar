#!/usr/bin/env bash
# ABU-M0-10: a fake credential committed by mistake must be caught. The fixture is generated at
# run time (never committed), so the repository itself never contains a credential-looking string.
set -euo pipefail
IMAGE="${GITLEAKS_IMAGE:?set GITLEAKS_IMAGE to the pinned gitleaks image}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cat >"$WORK/config.toml" <<'CFG'
title = "selftest: defaults only, no allowlist"
[extend]
useDefault = true
CFG
printf 'aws_access_key_id = AKIAQ7Q3M5KXR2NBT4WZ\n' >"$WORK/leak.env"

echo "gitleaks must detect a fake committed credential"
if docker run --rm -v "$WORK:/scan" -w /scan "$IMAGE" detect --no-git --source /scan \
  --config /scan/config.toml --redact --no-banner --exit-code 1 >/dev/null 2>&1; then
  echo "FAIL: gitleaks did not detect the fake credential" >&2
  exit 1
fi
echo "OK: fake credential detected (scanner exits non-zero)"
