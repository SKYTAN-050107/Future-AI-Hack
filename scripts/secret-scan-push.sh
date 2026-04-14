#!/usr/bin/env bash
set -euo pipefail

# Scan commits being pushed for sensitive file names and secret-like content.
# This complements pre-commit checks by validating the push range.

blocked_files_regex='(^|/)\.env($|\.)|(^|/)serviceAccount[^/]*\.json$|(^|/)firebase-adminsdk[^/]*\.json$|(^|/)service-account[^/]*\.json$|(^|/)\.runtimeconfig\.json$|\.(pem|p12|key|jks|keystore|pfx|crt|cer)$'

# Build rev ranges from stdin provided by pre-push hook.
ranges=()
while read -r local_ref local_sha remote_ref remote_sha; do
  [[ -z "${local_sha:-}" ]] && continue
  [[ "${local_sha}" =~ ^0+$ ]] && continue

  # After history rewrites, remote_sha may not exist locally anymore.
  # Fall back to scanning local_sha directly in that case.
  if [[ "${remote_sha:-}" =~ ^0+$ ]] || ! git cat-file -e "${remote_sha}^{commit}" 2>/dev/null; then
    ranges+=("${local_sha}")
  else
    ranges+=("${remote_sha}..${local_sha}")
  fi
done

if [[ ${#ranges[@]} -eq 0 ]]; then
  exit 0
fi

all_changed_files=""
all_added_lines=""

for range in "${ranges[@]}"; do
  changed_files="$(git diff --name-only --diff-filter=ACMR "${range}" 2>/dev/null || true)"
  if [[ -n "${changed_files}" ]]; then
    all_changed_files+=$'\n'"${changed_files}"
  fi

  # Only inspect added lines to lower false positives.
  added_lines="$(git log -p --no-merges --format= "${range}" -- . 2>/dev/null | grep '^+' | grep -v '^+++' || true)"
  if [[ -n "${added_lines}" ]]; then
    all_added_lines+=$'\n'"${added_lines}"
  fi
done

if [[ -n "${all_changed_files}" ]]; then
  blocked_candidates="$(echo "${all_changed_files}" | grep -Ei "${blocked_files_regex}" | grep -Eiv '(^|/)\.env\.(example|template|sample)$' | sort -u || true)"
  if [[ -n "${blocked_candidates}" ]]; then
    echo "[secret-scan] Blocked push: changed file path matches sensitive pattern."
    echo "${blocked_candidates}"
    exit 1
  fi
fi

if [[ -z "${all_added_lines}" ]]; then
  echo "[secret-scan] Push scan OK"
  exit 0
fi

if echo "${all_added_lines}" | grep -Eq '(AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN (RSA|EC|OPENSSH|PGP)? ?PRIVATE KEY-----)'; then
  echo "[secret-scan] Blocked push: high-confidence secret pattern detected."
  exit 1
fi

if echo "${all_added_lines}" | grep -Eiq '(password|passwd|secret|token|api[_-]?key|private[_-]?key)\s*[:=]\s*["'"'"'`]?[A-Za-z0-9_./+=-]{16,}["'"'"'`]?' \
  && ! echo "${all_added_lines}" | grep -Eiq 'YOUR_|EXAMPLE|DUMMY|PLACEHOLDER'; then
  echo "[secret-scan] Blocked push: suspicious credential assignment detected."
  exit 1
fi

echo "[secret-scan] Push scan OK"
