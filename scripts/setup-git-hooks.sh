#!/usr/bin/env bash
set -euo pipefail

git config core.hooksPath .githooks
echo "[hooks] core.hooksPath set to .githooks"
