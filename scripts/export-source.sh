#!/bin/bash

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_NAME="$(basename "$PROJECT_ROOT")"
TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
OUTPUT_DIR="$PROJECT_ROOT/exports"
OUTPUT_FILE="$OUTPUT_DIR/${PROJECT_NAME}_source_${TIMESTAMP}.zip"

mkdir -p "$OUTPUT_DIR"

cd "$PROJECT_ROOT"

zip -r "$OUTPUT_FILE" . \
  -x "node_modules/*" \
  -x ".git/*" \
  -x ".expo/*" \
  -x "ios/build/*" \
  -x "android/build/*" \
  -x "__MACOSX/*" \
  -x "*.DS_Store" \
  -x "*.zip" \
  -x "exports/*" \
  -x "project-photo-update-tool_BACKUP_*/*" \
  -x "project_photo_update_refactor_phase1/*" \
  -x "project_vision_ai_v0_*/*"

echo ""
echo "Source export created:"
echo "$OUTPUT_FILE"
echo ""
echo "Upload this ZIP to ChatGPT when you want code changes made."
