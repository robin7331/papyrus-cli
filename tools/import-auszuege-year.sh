#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  tools/import-auszuege-year.sh <YEAR> [--start-index N] [--end-index M] [--model NAME] [--reasoning LEVEL]

Beispiel:
  tools/import-auszuege-year.sh 2023
  tools/import-auszuege-year.sh 2023 --start-index 1 --end-index 25
  tools/import-auszuege-year.sh 2023 --start-index 26
  tools/import-auszuege-year.sh 2023 --model gpt-5.3-codex --reasoning high

Hinweise:
  - Indizes sind 1-basiert und beziehen sich auf die sortierte PDF-Liste.
  - Ohne --end-index laeuft der Import bis zum letzten Auszug.
  - Default model: gpt-5.3-codex
  - Default reasoning: low
  - --reasoning wird als codex config `model_reasoning_effort` gesetzt.
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

if [[ -d "${ROOT_DIR}/${YEAR}/auszuege" ]]; then
  STMT_DIR="${ROOT_DIR}/${YEAR}/auszuege"
elif [[ -d "${ROOT_DIR}/${YEAR}/Auszuege" ]]; then
  STMT_DIR="${ROOT_DIR}/${YEAR}/Auszuege"
else
  echo "Fehler: Kein Auszuege-Ordner fuer ${YEAR} gefunden." >&2
  exit 1
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "Fehler: 'codex' CLI nicht gefunden." >&2
  exit 1
fi

PDF_FILES=()
while IFS= read -r pdf_file; do
  PDF_FILES+=("${pdf_file}")
done < <(
  find "${STMT_DIR}" -maxdepth 1 -type f -name "Konto_*-Auszug_${YEAR}_*.pdf" | sort
)

if [[ ${#PDF_FILES[@]} -eq 0 ]]; then
  echo "Fehler: Keine PDF-Auszuege fuer ${YEAR} in ${STMT_DIR} gefunden." >&2
  exit 1
fi

total=${#PDF_FILES[@]}
if [[ -z "${END_INDEX}" ]]; then
  END_INDEX="${total}"
fi

if [[ "${START_INDEX}" -gt "${total}" ]]; then
  echo "Fehler: --start-index (${START_INDEX}) ist groesser als die Anzahl gefundener PDFs (${total})." >&2
  exit 1
fi

if [[ "${END_INDEX}" -gt "${total}" ]]; then
  echo "Fehler: --end-index (${END_INDEX}) ist groesser als die Anzahl gefundener PDFs (${total})." >&2
  exit 1
fi

if [[ "${START_INDEX}" -gt "${END_INDEX}" ]]; then
  echo "Fehler: --start-index (${START_INDEX}) darf nicht groesser als --end-index (${END_INDEX}) sein." >&2
  exit 1
fi

selected_total=$((END_INDEX - START_INDEX + 1))

RUN_ID="$(date +%Y%m%d_%H%M%S)_${START_INDEX}-${END_INDEX}_$$"
RUN_DIR="${ROOT_DIR}/logs/batch-import/${YEAR}/${RUN_ID}"
mkdir -p "${RUN_DIR}"
RUN_LOG="${RUN_DIR}/run.log"

log() {
  local msg="$1"
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$msg" | tee -a "${RUN_LOG}"
}

processed=0
skipped=0
failed=0
index=0
selected_index=0

CODEX_BASE_CMD=(codex exec --full-auto -C "${ROOT_DIR}")
if [[ -n "${MODEL}" ]]; then
  CODEX_BASE_CMD+=(--model "${MODEL}")
fi
if [[ -n "${REASONING}" ]]; then
  CODEX_BASE_CMD+=(-c "model_reasoning_effort=\"${REASONING}\"")
fi
if command -v stdbuf >/dev/null 2>&1; then
  CODEX_STREAM_PREFIX=(stdbuf -oL -eL)
else
  CODEX_STREAM_PREFIX=()
fi

log "Batch-Import gestartet (YEAR=${YEAR}, STMT_DIR=${STMT_DIR})"
log "Logs: ${RUN_DIR}"
log "Gefundene PDFs: ${total}"
log "Verarbeite Bereich: ${START_INDEX}-${END_INDEX} (Anzahl: ${selected_total})"
log "Codex Optionen: model=${MODEL} reasoning=${REASONING}"

for pdf in "${PDF_FILES[@]}"; do
  index=$((index + 1))

  if [[ "${index}" -lt "${START_INDEX}" ]]; then
    continue
  fi
  if [[ "${index}" -gt "${END_INDEX}" ]]; then
    break
  fi

  selected_index=$((selected_index + 1))
  json="${pdf%.pdf}.json"
  base="$(basename "${pdf}" .pdf)"
  file_log="${RUN_DIR}/${base}.log"
  rel_pdf="${pdf#${ROOT_DIR}/}"

  if [[ -f "${json}" ]]; then
    log "SKIP ${rel_pdf} (JSON existiert bereits)"
    skipped=$((skipped + 1))
    continue
  fi

  log "START [${selected_index}/${selected_total}] ${rel_pdf} (global ${index}/${total})"
  log "LIVE-OUTPUT -> ${file_log}"
  start_epoch="$(date +%s)"
  set +e
  if [[ ${#CODEX_STREAM_PREFIX[@]} -gt 0 ]]; then
    "${CODEX_STREAM_PREFIX[@]}" "${CODEX_BASE_CMD[@]}" \
      "Nutze den import-auszuege Skill und bearbeite genau diese Datei: ${rel_pdf}. Fuehre den Import mit 'uv run tools/raw-booking-inserter/main.py import ...' aus." \
      2>&1 | tee "${file_log}"
  else
    "${CODEX_BASE_CMD[@]}" \
      "Nutze den import-auszuege Skill und bearbeite genau diese Datei: ${rel_pdf}. Fuehre den Import mit 'uv run tools/raw-booking-inserter/main.py import ...' aus." \
      2>&1 | tee "${file_log}"
  fi
  rc=${PIPESTATUS[0]}
  set -e
  duration=$(( $(date +%s) - start_epoch ))

  if [[ $rc -ne 0 ]]; then
    log "FEHLER ${rel_pdf} (Exit ${rc}, Dauer ${duration}s), siehe ${file_log}"
    failed=$((failed + 1))
    break
  fi

  if [[ -f "${json}" ]]; then
    log "OK ${rel_pdf} (Dauer ${duration}s, Log: ${file_log})"
    processed=$((processed + 1))
  else
    log "FEHLER ${rel_pdf}: Kein JSON erzeugt trotz Exit 0 (Log: ${file_log})"
    failed=$((failed + 1))
    break
  fi
done

log "FERTIG range=${START_INDEX}-${END_INDEX} processed=${processed} skipped=${skipped} failed=${failed}"

if [[ ${failed} -gt 0 ]]; then
  exit 1
fi
