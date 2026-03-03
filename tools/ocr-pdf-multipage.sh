#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  tools/ocr-pdf-multipage.sh <input.pdf> <output.txt> [lang] [scale]

Beispiel:
  tools/ocr-pdf-multipage.sh scanned_belege/beleg.pdf /private/tmp/beleg_ocr.txt eng 2.2
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 2 || $# -gt 4 ]]; then
  usage >&2
  exit 1
fi

INPUT_PDF="$1"
OUTPUT_TXT="$2"
LANG="${3:-eng}"
SCALE="${4:-2.2}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RENDER_SCRIPT="${SCRIPT_DIR}/render-pdf-pages.swift"

if [[ ! -f "$INPUT_PDF" ]]; then
  echo "Fehler: PDF nicht gefunden: $INPUT_PDF" >&2
  exit 1
fi

if [[ ! -f "$RENDER_SCRIPT" ]]; then
  echo "Fehler: Render-Script nicht gefunden: $RENDER_SCRIPT" >&2
  exit 1
fi

if ! command -v swift >/dev/null 2>&1; then
  echo "Fehler: swift nicht gefunden." >&2
  exit 1
fi

if ! command -v tesseract >/dev/null 2>&1; then
  echo "Fehler: tesseract nicht gefunden." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d /private/tmp/beleg_ocr_pages.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$(dirname "$OUTPUT_TXT")"
rm -f "$OUTPUT_TXT"

export CLANG_MODULE_CACHE_PATH="${CLANG_MODULE_CACHE_PATH:-/tmp/clang-module-cache}"
export SWIFT_MODULECACHE_PATH="${SWIFT_MODULECACHE_PATH:-/tmp/swift-module-cache}"
export TESSDATA_PREFIX="${TESSDATA_PREFIX:-/opt/homebrew/share/tessdata}"

swift "$RENDER_SCRIPT" "$INPUT_PDF" "$TMP_DIR" "$SCALE" >/dev/null

shopt -s nullglob
pages=( "$TMP_DIR"/page_*.png )
shopt -u nullglob

if [[ ${#pages[@]} -eq 0 ]]; then
  echo "Fehler: Keine Seitenbilder erzeugt." >&2
  exit 1
fi

page_no=0
for img in "${pages[@]}"; do
  page_no=$((page_no + 1))
  ocr_base="${img%.png}"
  tesseract "$img" "$ocr_base" -l "$LANG" >/dev/null 2>&1
  ocr_txt="${ocr_base}.txt"

  {
    echo "===== PAGE ${page_no} ====="
    if [[ -f "$ocr_txt" ]]; then
      cat "$ocr_txt"
    fi
    echo
  } >> "$OUTPUT_TXT"
done

echo "ok pages=${#pages[@]} output=${OUTPUT_TXT}"
