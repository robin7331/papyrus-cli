#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  tools/import-scanned-belege-inbox.sh [--start-index N] [--end-index M] [--model NAME] [--reasoning LEVEL]

Beispiele:
  tools/import-scanned-belege-inbox.sh
  tools/import-scanned-belege-inbox.sh --start-index 1 --end-index 100
  tools/import-scanned-belege-inbox.sh --model gpt-5.3-codex --reasoning high

Hinweise:
  - Quelle ist immer: ./scanned_belege (Root-Buffer fuer unprozessierte Scans).
  - Pro PDF wird der Skill import-scanned-belege ausgefuehrt.
  - Bei Erfolg wird die Datei nach /<year>/belege/<YYYY-MM>/ abgelegt (PDF + .scan.json).
  - Fehlerfaelle werden nach ./scanned_belege_failed/<RUN_ID>/ verschoben.
  - Default reasoning: low (schneller, weniger Tool-Exploration).
EOF
}

START_INDEX="1"
END_INDEX=""
MODEL="gpt-5.3-codex"
REASONING="low"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --start-index)
      if [[ -z "${2:-}" ]]; then
        echo "Fehler: --start-index benoetigt einen Wert." >&2
        exit 1
      fi
      START_INDEX="$2"
      shift 2
      ;;
    --end-index)
      if [[ -z "${2:-}" ]]; then
        echo "Fehler: --end-index benoetigt einen Wert." >&2
        exit 1
      fi
      END_INDEX="$2"
      shift 2
      ;;
    --model)
      if [[ -z "${2:-}" ]]; then
        echo "Fehler: --model benoetigt einen Wert." >&2
        exit 1
      fi
      MODEL="$2"
      shift 2
      ;;
    --reasoning)
      if [[ -z "${2:-}" ]]; then
        echo "Fehler: --reasoning benoetigt einen Wert." >&2
        exit 1
      fi
      REASONING="$2"
      shift 2
      ;;
    -*)
      echo "Fehler: Unbekannte Option '$1'." >&2
      usage
      exit 1
      ;;
    *)
      echo "Fehler: Unerwartetes Argument '$1'." >&2
      usage
      exit 1
      ;;
  esac
done

if [[ ! "$START_INDEX" =~ ^[0-9]+$ || "$START_INDEX" -lt 1 ]]; then
  echo "Fehler: --start-index muss eine ganze Zahl >= 1 sein." >&2
  exit 1
fi

if [[ -n "$END_INDEX" && ( ! "$END_INDEX" =~ ^[0-9]+$ || "$END_INDEX" -lt 1 ) ]]; then
  echo "Fehler: --end-index muss eine ganze Zahl >= 1 sein." >&2
  exit 1
fi

if [[ -n "$REASONING" && ! "$REASONING" =~ ^(low|medium|high)$ ]]; then
  echo "Fehler: --reasoning muss 'low', 'medium' oder 'high' sein." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BUFFER_DIR="${ROOT_DIR}/scanned_belege"
FAILED_ROOT_DIR="${ROOT_DIR}/scanned_belege_failed"
DB_PATH="${ROOT_DIR}/datenbank.sqlite"
INSERTER="${ROOT_DIR}/tools/scanned-beleg-inserter/main.py"

# Stabilisiert Tooling in sandboxed Runs.
export UV_CACHE_DIR="${UV_CACHE_DIR:-/tmp/uv-cache}"
export TESSDATA_PREFIX="${TESSDATA_PREFIX:-/opt/homebrew/share/tessdata}"

if [[ ! -d "$BUFFER_DIR" ]]; then
  echo "Fehler: Buffer-Ordner nicht gefunden: $BUFFER_DIR" >&2
  exit 1
fi

if [[ ! -f "$INSERTER" ]]; then
  echo "Fehler: Inserter-Script nicht gefunden: $INSERTER" >&2
  exit 1
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "Fehler: 'codex' CLI nicht gefunden." >&2
  exit 1
fi

PDF_FILES=()
while IFS= read -r file; do
  PDF_FILES+=("$file")
done < <(find "$BUFFER_DIR" -maxdepth 1 -type f -name '*.pdf' | sort)

TOTAL=${#PDF_FILES[@]}
if [[ "$TOTAL" -eq 0 ]]; then
  echo "Hinweis: Keine PDFs in $BUFFER_DIR gefunden."
  exit 0
fi

if [[ -z "$END_INDEX" ]]; then
  END_INDEX="$TOTAL"
fi

if [[ "$START_INDEX" -gt "$TOTAL" ]]; then
  echo "Fehler: --start-index ($START_INDEX) ist groesser als Anzahl PDFs ($TOTAL)." >&2
  exit 1
fi

if [[ "$END_INDEX" -gt "$TOTAL" ]]; then
  echo "Fehler: --end-index ($END_INDEX) ist groesser als Anzahl PDFs ($TOTAL)." >&2
  exit 1
fi

if [[ "$START_INDEX" -gt "$END_INDEX" ]]; then
  echo "Fehler: --start-index darf nicht groesser als --end-index sein." >&2
  exit 1
fi

SELECTED_TOTAL=$((END_INDEX - START_INDEX + 1))
RUN_ID="$(date +%Y%m%d_%H%M%S)_${START_INDEX}-${END_INDEX}_$$"
RUN_DIR="${ROOT_DIR}/logs/batch-import-scanned-belege/inbox/${RUN_ID}"
FAILED_RUN_DIR="${FAILED_ROOT_DIR}/${RUN_ID}"
mkdir -p "$RUN_DIR" "$FAILED_RUN_DIR"
RUN_LOG="${RUN_DIR}/run.log"

log() {
  local msg="$1"
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$msg" | tee -a "$RUN_LOG"
}

move_to_failed() {
  local src="$1"
  if [[ ! -f "$src" ]]; then
    return 0
  fi
  local name
  name="$(basename "$src")"
  local dest="${FAILED_RUN_DIR}/${name}"
  local counter=2
  while [[ -e "$dest" ]]; do
    local stem="${name%.*}"
    local ext=""
    if [[ "$name" == *.* ]]; then
      ext=".${name##*.}"
      stem="${name%.*}"
    fi
    dest="${FAILED_RUN_DIR}/${stem}_${counter}${ext}"
    counter=$((counter + 1))
  done
  mv -f "$src" "$dest"
}

CODEX_BASE_CMD=(codex exec --full-auto -C "$ROOT_DIR")
if [[ -n "$MODEL" ]]; then
  CODEX_BASE_CMD+=(--model "$MODEL")
fi
if [[ -n "$REASONING" ]]; then
  CODEX_BASE_CMD+=(-c "model_reasoning_effort=\"${REASONING}\"")
fi
# MCP-Server fuer diesen Batch deaktivieren (reduziert Startup-Rauschen/Fehler).
CODEX_BASE_CMD+=(
  -c "mcp_servers.paper.enabled=false"
  -c "mcp_servers.laravel-boost.enabled=false"
  -c "mcp_servers.pencil.enabled=false"
  -c "mcp_servers.herd.enabled=false"
)
if command -v stdbuf >/dev/null 2>&1; then
  CODEX_STREAM_PREFIX=(stdbuf -oL -eL)
else
  CODEX_STREAM_PREFIX=()
fi

processed=0
created=0
deduplicated=0
failed=0
relocated=0
json_cleaned=0
index=0
selected_index=0

log "Inbox-Batch gestartet (BUFFER_DIR=${BUFFER_DIR})"
log "Logs: ${RUN_DIR}"
log "Failed-Ordner: ${FAILED_RUN_DIR}"
log "Gefundene PDFs: ${TOTAL}"
log "Verarbeite Bereich: ${START_INDEX}-${END_INDEX} (Anzahl: ${SELECTED_TOTAL})"
log "Codex Optionen: model=${MODEL} reasoning=${REASONING}"

for pdf in "${PDF_FILES[@]}"; do
  index=$((index + 1))
  if [[ "$index" -lt "$START_INDEX" ]]; then
    continue
  fi
  if [[ "$index" -gt "$END_INDEX" ]]; then
    break
  fi

  selected_index=$((selected_index + 1))
  processed=$((processed + 1))

  rel_pdf="${pdf#${ROOT_DIR}/}"
  json="${pdf%.pdf}.scan.json"
  rel_json="${json#${ROOT_DIR}/}"
  base="$(basename "$pdf" .pdf)"
  file_log="${RUN_DIR}/${base}.log"

  log "START [${selected_index}/${SELECTED_TOTAL}] ${rel_pdf}"
  log "LIVE-OUTPUT -> ${file_log}"

  prompt="Nutze die Skills import-scanned-belege und pdf. Bearbeite genau diese Datei: ${rel_pdf}. Lies und interpretiere den Beleg. Erzeuge/aktualisiere exakt diese JSON-Datei: ${rel_json}. Verwende in dieser Umgebung direkt diese Pipeline und KEINE Tool-Probing-Runden: (1) PDF->Bild mit sips nach /private/tmp, (2) OCR mit TESSDATA_PREFIX=/opt/homebrew/share/tessdata und tesseract -l eng, (3) JSON schreiben, (4) Import exakt mit: UV_CACHE_DIR=/tmp/uv-cache uv run tools/scanned-beleg-inserter/main.py import --beleg-file \"${json}\" --strict --db \"${DB_PATH}\" --relocate-raw-scan --source-buffer-root \"${BUFFER_DIR}\". Keine Versuche mit pdfinfo/pdftotext/mutool/magick/swift, ausser wenn die direkte Pipeline fehlschlaegt."

  set +e
  if [[ ${#CODEX_STREAM_PREFIX[@]} -gt 0 ]]; then
    "${CODEX_STREAM_PREFIX[@]}" "${CODEX_BASE_CMD[@]}" "$prompt" 2>&1 | tee "$file_log"
  else
    "${CODEX_BASE_CMD[@]}" "$prompt" 2>&1 | tee "$file_log"
  fi
  rc=${PIPESTATUS[0]}
  set -e

  run_ok=0
  if [[ ! -f "$pdf" ]]; then
    run_ok=1
  fi

  if [[ "$run_ok" -eq 1 ]]; then
    if rg -q '"created"\s*:\s*true' "$file_log"; then
      created=$((created + 1))
    fi
    if rg -q '"deduplicated"\s*:\s*true' "$file_log"; then
      deduplicated=$((deduplicated + 1))
    fi
    if rg -q '"raw_scan_relocated"\s*:\s*true' "$file_log"; then
      relocated=$((relocated + 1))
    fi
    if [[ -f "$json" ]]; then
      rm -f "$json"
      json_cleaned=$((json_cleaned + 1))
    fi
    if [[ "$rc" -ne 0 ]]; then
      log "WARN ${rel_pdf}: Codex Exit ${rc}, Datei wurde aber aus Buffer entfernt."
    else
      log "OK ${rel_pdf} (JSON aufgeraeumt, Log: ${file_log})"
    fi
    continue
  fi

  failed=$((failed + 1))
  log "FEHLER ${rel_pdf}: Datei blieb im Buffer (Codex Exit ${rc}). Verschiebe nach ${FAILED_RUN_DIR}"
  move_to_failed "$pdf"
  move_to_failed "$json"
done

remaining_pdf_count=$(find "$BUFFER_DIR" -maxdepth 1 -type f -name '*.pdf' | wc -l | tr -d ' ')
remaining_json_count=$(find "$BUFFER_DIR" -maxdepth 1 -type f -name '*.scan.json' | wc -l | tr -d ' ')

SUMMARY_JSON="${RUN_DIR}/summary.json"
cat >"$SUMMARY_JSON" <<EOF
{
  "run_id": "${RUN_ID}",
  "buffer_dir": "${BUFFER_DIR}",
  "failed_dir": "${FAILED_RUN_DIR}",
  "db_path": "${DB_PATH}",
  "processed": ${processed},
  "created": ${created},
  "deduplicated": ${deduplicated},
  "failed": ${failed},
  "relocated": ${relocated},
  "json_cleaned": ${json_cleaned},
  "remaining_buffer_pdfs": ${remaining_pdf_count},
  "remaining_buffer_scan_json": ${remaining_json_count}
}
EOF

log "FERTIG processed=${processed} created=${created} deduplicated=${deduplicated} failed=${failed} relocated=${relocated}"
log "Buffer-Rest: pdf=${remaining_pdf_count} scan_json=${remaining_json_count}"
log "Summary: ${SUMMARY_JSON}"

if [[ "$failed" -gt 0 || "$remaining_pdf_count" -gt 0 ]]; then
  exit 1
fi

exit 0
