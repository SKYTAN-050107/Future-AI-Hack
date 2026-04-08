#!/usr/bin/env bash
set -euo pipefail

# Block known sensitive file names/extensions from entering commits.
blocked_files_regex='(^|/)\.env($|\.)|(^|/)serviceAccount[^/]*\.json$|(^|/)firebase-adminsdk[^/]*\.json$|(^|/)\.runtimeconfig\.json$|\.(pem|p12|key|jks|keystore|pfx|crt|cer)$'

staged_files="$(git diff --cached --name-only --diff-filter=ACMR)"
if [[ -n "${staged_files}" ]]; then
  if echo "${staged_files}" | grep -Eiq "${blocked_files_regex}"; then
    echo "[secret-scan] Blocked: staged file path matches sensitive pattern."
    echo "[secret-scan] Remove it from index with: git rm --cached <file>"
    exit 1
  fi
fi

# Scan only added lines in staged diff to keep false positives lower.
staged_added_lines="$(git diff --cached -U0 -- . \
  | grep '^+' \
  | grep -v '^+++' \
  || true)"

if [[ -z "${staged_added_lines}" ]]; then
  exit 0
fi

# High-confidence token/key patterns.
if echo "${staged_added_lines}" | grep -Eq '(AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN (RSA|EC|OPENSSH|PGP)? ?PRIVATE KEY-----)'; then
  echo "[secret-scan] Blocked: possible secret detected in staged changes."
  exit 1
fi

# Generic assignment-style secrets with non-placeholder values.
if echo "${staged_added_lines}" | grep -Eiq '(password|passwd|secret|token|api[_-]?key|private[_-]?key)\s*[:=]\s*["'"'"'`]?[A-Za-z0-9_./+=-]{16,}["'"'"'`]?' \
  && ! echo "${staged_added_lines}" | grep -Eiq 'YOUR_|EXAMPLE|DUMMY|PLACEHOLDER'; then
  echo "[secret-scan] Blocked: suspicious credential assignment detected."
  exit 1
fi

echo "[secret-scan] OK"
