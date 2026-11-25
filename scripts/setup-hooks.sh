#!/usr/bin/env bash
# Enables the committed git hooks for this clone. Safe to run again. `npm install` in web/ runs it too.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
git config core.hooksPath .githooks
echo "git hooks enabled (.githooks). Skip one commit with: git commit --no-verify"
