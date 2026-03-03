#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  tools/import-scanned-belege-year.sh <YEAR> [--start-index N] [--end-index M] [--model NAME] [--reasoning LEVEL]

Beispiele:
  tools/import-scanned-belege-year.sh 2023
  tools/import-scanned-belege-year.sh 2023 --start-index 1 --end-index 50
  tools/import-scanned-belege-year.sh 2023 --model gpt-5.3-codex --reasoning high

Hinweise:
  - Pro PDF wird der Skill `import-scanned-belege` aufgerufen.
  - Der Skill erzeugt JSON (*.scan.json) und fuehrt danach den Import aus.
  - OCR erfolgt mehrseitig (alle PDF-Seiten), nicht nur Seite 1.
EOF
}

YEAR=""
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
      if [[ -n "${YEAR}" ]]; then
        echo "Fehler: Mehrfaches YEAR-Argument: '$1'." >&2
        usage
        exit 1
      fi
      YEAR="$1"
      shift
      ;;
  esac
done

if [[ -z "${YEAR}" ]]; then
  usage
  exit 1
fi

if [[ ! "$YEAR" =~ ^20[0-9]{2}$ ]]; then
  echo "Fehler: YEAR muss wie 2023 aussehen." >&2
  exit 1
fi

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
INPUT_DIR="${ROOT_DIR}/${YEAR}/scanned_belege"
DB_PATH="${ROOT_DIR}/datenbank.sqlite"
INSERTER="${ROOT_DIR}/tools/scanned-beleg-inserter/main.py"
export UV_CACHE_DIR="${UV_CACHE_DIR:-/tmp/uv-cache}"
export TESSDATA_PREFIX="${TESSDATA_PREFIX:-/opt/homebrew/share/tessdata}"

if [[ ! -d "$INPUT_DIR" ]]; then
  echo "Fehler: Ordner nicht gefunden: $INPUT_DIR" >&2
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
done < <(find "$INPUT_DIR" -maxdepth 1 -type f -name '*.pdf' | sort)

TOTAL=${#PDF_FILES[@]}
if [[ "$TOTAL" -eq 0 ]]; then
  echo "Fehler: Keine PDFs in $INPUT_DIR gefunden." >&2
  exit 1
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
RUN_DIR="${ROOT_DIR}/logs/batch-import-scanned-belege/${YEAR}/${RUN_ID}"
mkdir -p "$RUN_DIR"
RUN_LOG="${RUN_DIR}/run.log"

log() {
  local msg="$1"
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$msg" | tee -a "$RUN_LOG"
}

CODEX_BASE_CMD=(codex exec --full-auto -C "$ROOT_DIR")
if [[ -n "$MODEL" ]]; then
  CODEX_BASE_CMD+=(--model "$MODEL")
fi
if [[ -n "$REASONING" ]]; then
  CODEX_BASE_CMD+=(-c "model_reasoning_effort=\"${REASONING}\"")
fi
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
failed=0
index=0
selected_index=0

log "Batch-Import gestartet (YEAR=${YEAR}, INPUT_DIR=${INPUT_DIR})"
log "Logs: ${RUN_DIR}"
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
  ocr_txt="/private/tmp/beleg_ocr_${RUN_ID}_${selected_index}.txt"

  log "START [${selected_index}/${SELECTED_TOTAL}] ${rel_pdf}"
  log "LIVE-OUTPUT -> ${file_log}"

  prompt="Nutze die Skills import-scanned-belege und pdf. Bearbeite genau diese Datei: ${rel_pdf}. Lies und interpretiere den Beleg. Erzeuge/aktualisiere exakt diese JSON-Datei: ${rel_json}. Verwende in dieser Umgebung direkt diese Pipeline und KEINE Tool-Probing-Runden: (1) OCR fuer ALLE PDF-Seiten mit: tools/ocr-pdf-multipage.sh \"${pdf}\" \"${ocr_txt}\" eng 2.2, (2) lies den kompletten OCR-Text aus \"${ocr_txt}\" inkl. aller PAGE-Bloecke, (3) JSON schreiben, (4) Import exakt mit: UV_CACHE_DIR=/tmp/uv-cache uv run tools/scanned-beleg-inserter/main.py import --beleg-file \"${json}\" --strict --db \"${DB_PATH}\" --relocate-raw-scan --source-buffer-root \"${INPUT_DIR}\". Keine Versuche mit pdfinfo/pdftotext/mutool/magick/Einzelseiten-OCR."

  set +e
  if [[ ${#CODEX_STREAM_PREFIX[@]} -gt 0 ]]; then
    "${CODEX_STREAM_PREFIX[@]}" "${CODEX_BASE_CMD[@]}" "$prompt" 2>&1 | tee "$file_log"
  else
    "${CODEX_BASE_CMD[@]}" "$prompt" 2>&1 | tee "$file_log"
  fi
  rc=${PIPESTATUS[0]}
  set -e

  if [[ $rc -ne 0 ]]; then
    log "FEHLER ${rel_pdf}: Codex Exit ${rc} (Log: ${file_log})"
    failed=$((failed + 1))
    break
  fi

  if [[ ! -f "$json" ]]; then
    log "FEHLER ${rel_pdf}: Kein JSON erzeugt (${rel_json})"
    failed=$((failed + 1))
    break
  fi

  log "OK ${rel_pdf} (JSON: ${rel_json}, Log: ${file_log})"
done

log "FERTIG range=${START_INDEX}-${END_INDEX} processed=${processed} failed=${failed}"

if [[ ${failed} -gt 0 ]]; then
  exit 1
fi

exit 0
