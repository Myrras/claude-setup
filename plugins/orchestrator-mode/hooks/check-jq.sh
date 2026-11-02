#!/bin/sh
# SessionStart: warn when jq is missing (block-main-edits.sh needs it).
command -v jq >/dev/null 2>&1 && exit 0
printf '%s\n' '{"systemMessage":"orchestrator-mode: jq is not installed, so every file edit is blocked. Install jq first (macOS: brew install jq, Windows: winget install jqlang.jq, Linux: your package manager), then restart Claude from a new terminal."}'
