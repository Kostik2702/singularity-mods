#!/usr/bin/env bash
# Verifies the mission-control mod: control bytes, manifest and module scan, tests, types.
# Run from anywhere in Git Bash: tools/verify.sh
# Before any session has loaded the mod, point tsc at the engine's types:
#   CLAUDE_CODE_TYPES=<path to plugin-authoring/types/claude-code.d.ts> tools/verify.sh
set -u
cd "$(dirname "$0")/.." || exit 2
MOD=mission-control
TSC_PKG=typescript@5.6.3
mkdir -p .tmp
fail=0
step() { printf '\n== %s\n' "$1"; }

step "control bytes"
node tools/check-bytes.mjs "$MOD" docs tools README.md || fail=1

step "claude plugin validate"
claude plugin validate "$MOD" > .tmp/validate.log 2>&1
code=$?
cat .tmp/validate.log
[ $code -eq 0 ] || fail=1

step "claude plugin test"
claude plugin test "$MOD" > .tmp/test.log 2>&1
code=$?
tail -n 40 .tmp/test.log
[ $code -eq 0 ] || fail=1

step "tsc"
if [ -f "$MOD/.claude-plugin/types/tsconfig.json" ]; then
  npx -y -p "$TSC_PKG" tsc -p "$MOD"
  code=$?
elif [ -n "${CLAUDE_CODE_TYPES:-}" ] && [ -f "${CLAUDE_CODE_TYPES}" ]; then
  node tools/fallback-tsconfig.mjs "$CLAUDE_CODE_TYPES" "$MOD" > .tmp/tsconfig.fallback.json
  npx -y -p "$TSC_PKG" tsc -p .tmp/tsconfig.fallback.json
  code=$?
else
  echo "no engine types: load the mod in a session once, or set CLAUDE_CODE_TYPES"
  code=1
fi
[ $code -eq 0 ] || fail=1

if [ $fail -eq 0 ]; then printf '\n== verify: PASS\n'; else printf '\n== verify: FAIL\n'; fi
exit $fail
