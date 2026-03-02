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
REASONING="medium"
ACCOUNT_ID="1"

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

if ! command -v uv >/dev/null 2>&1; then
  echo "Fehler: 'uv' CLI nicht gefunden." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Fehler: 'python3' nicht gefunden." >&2
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
DB_PATH="${ROOT_DIR}/datenbank.sqlite"

log() {
  local msg="$1"
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$msg" | tee -a "${RUN_LOG}"
}

processed=0
skipped=0
checked_json=0
db_complete_skipped=0
imported_from_existing_json=0
generated_json=0
imported_after_generation=0
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
log "DB-Abgleich: immer aktiv (db=${DB_PATH}, account_id=${ACCOUNT_ID})"

get_json_metadata() {
  local json_file="$1"
  python3 - "$json_file" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    payload = json.load(f)

statement_no = payload.get("statement_no")
rows = payload.get("rows")
if not isinstance(statement_no, str) or not statement_no.strip():
    raise ValueError("missing statement_no")
if not isinstance(rows, list) or len(rows) == 0:
    raise ValueError("missing rows")

opening_idx = None
closing_idx = None
for i, row in enumerate(rows):
    if not isinstance(row, dict):
        continue
    tx_type = row.get("typ")
    if isinstance(tx_type, str):
        tx_type = tx_type.strip()
    else:
        tx_type = ""
    if opening_idx is None and tx_type in {"Eroeffnungssaldo", "Eröffnungssaldo"}:
        opening_idx = i
    if tx_type == "Schlusssaldo":
        closing_idx = i

if opening_idx is None or closing_idx is None or closing_idx <= opening_idx:
    raise ValueError("invalid opening/closing structure")

movement_count = closing_idx - opening_idx - 1
print(f"{statement_no.strip()}\t{movement_count}")
PY
}

db_completeness_status() {
  local db_path="$1"
  local account_id="$2"
  local statement_no="$3"
  local movement_count="$4"
  python3 - "$db_path" "$account_id" "$statement_no" "$movement_count" <<'PY'
import os
import sqlite3
import sys

db_path, account_id_raw, statement_no, movement_count_raw = sys.argv[1:5]
account_id = int(account_id_raw)
movement_count = int(movement_count_raw)

if not os.path.exists(db_path):
    print("MISSING")
    raise SystemExit(0)

try:
    conn = sqlite3.connect(db_path)
except sqlite3.Error:
    print("MISSING")
    raise SystemExit(0)

try:
    cursor = conn.cursor()
    cursor.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='statement_docs' LIMIT 1"
    )
    if cursor.fetchone() is None:
        print("MISSING")
        raise SystemExit(0)

    cursor.execute(
        """
        SELECT sd.id
        FROM statement_docs sd
        JOIN source_files sf ON sf.id = sd.source_file_id
        WHERE sf.account_id = ? AND sd.statement_no = ?
        ORDER BY sd.id DESC
        LIMIT 1
        """,
        (account_id, statement_no),
    )
    row = cursor.fetchone()
    if row is None:
        print("MISSING")
        raise SystemExit(0)

    statement_doc_id = int(row[0])
    cursor.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='bank_transactions' LIMIT 1"
    )
    if cursor.fetchone() is None:
        print("INCOMPLETE:0")
        raise SystemExit(0)

    cursor.execute(
        "SELECT COUNT(*) FROM bank_transactions WHERE statement_doc_id = ?",
        (statement_doc_id,),
    )
    tx_count = int(cursor.fetchone()[0])
    if tx_count == movement_count:
        print("COMPLETE")
    else:
        print(f"INCOMPLETE:{tx_count}")
finally:
    conn.close()
PY
}

run_import_for_json() {
  local json_file="$1"
  local file_log="$2"
  local rc=0
  set +e
  uv run tools/raw-booking-inserter/main.py import \
    --bookings-file "${json_file}" \
    --strict \
    --account-id "${ACCOUNT_ID}" \
    --db "${DB_PATH}" \
    2>&1 | tee -a "${file_log}"
  rc=${PIPESTATUS[0]}
  set -e
  return "${rc}"
}

ensure_codex_cli() {
  if ! command -v codex >/dev/null 2>&1; then
    echo "Fehler: 'codex' CLI nicht gefunden, aber fuer fehlende JSON-Dateien erforderlich." >&2
    return 1
  fi
  return 0
}

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

  log "START [${selected_index}/${selected_total}] ${rel_pdf} (global ${index}/${total})"
  log "LIVE-OUTPUT -> ${file_log}"

  json_generated_this_file=0
  if [[ ! -f "${json}" ]]; then
    if ! ensure_codex_cli; then
      log "FEHLER ${rel_pdf}: Codex CLI nicht verfuegbar"
      failed=$((failed + 1))
      break
    fi
    log "GENERATE_JSON_THEN_IMPORT ${rel_pdf} (JSON fehlt)"
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
      log "FEHLER ${rel_pdf} (Codex Exit ${rc}, Dauer ${duration}s), siehe ${file_log}"
      failed=$((failed + 1))
      break
    fi

    if [[ ! -f "${json}" ]]; then
      log "FEHLER ${rel_pdf}: Kein JSON erzeugt trotz Codex Exit 0 (Log: ${file_log})"
      failed=$((failed + 1))
      break
    fi

    generated_json=$((generated_json + 1))
    json_generated_this_file=1
    log "JSON erzeugt fuer ${rel_pdf} (Dauer ${duration}s)"
  fi

  checked_json=$((checked_json + 1))
  set +e
  json_meta="$(get_json_metadata "${json}")"
  rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then
    log "FEHLER ${rel_pdf}: JSON-Metadaten konnten nicht gelesen werden (${json})"
    failed=$((failed + 1))
    break
  fi
  IFS=$'\t' read -r statement_no movement_count <<<"${json_meta}"

  set +e
  completeness="$(db_completeness_status "${DB_PATH}" "${ACCOUNT_ID}" "${statement_no}" "${movement_count}")"
  rc=$?
  set -e
  if [[ $rc -ne 0 || -z "${completeness}" ]]; then
    log "FEHLER ${rel_pdf}: DB-Abgleich fehlgeschlagen (statement_no=${statement_no})"
    failed=$((failed + 1))
    break
  fi

  if [[ "${completeness}" == "COMPLETE" ]]; then
    log "SKIP_DB_COMPLETE ${rel_pdf} (statement_no=${statement_no}, movements=${movement_count})"
    skipped=$((skipped + 1))
    db_complete_skipped=$((db_complete_skipped + 1))
    processed=$((processed + 1))
    continue
  fi

  if [[ "${completeness}" == MISSING* ]]; then
    log "IMPORT_JSON_MISSING_IN_DB ${rel_pdf} (statement_no=${statement_no}, movements=${movement_count})"
  elif [[ "${completeness}" == INCOMPLETE* ]]; then
    tx_count="${completeness#INCOMPLETE:}"
    log "IMPORT_JSON_INCOMPLETE_IN_DB ${rel_pdf} (statement_no=${statement_no}, expected_movements=${movement_count}, db_tx=${tx_count})"
  else
    log "FEHLER ${rel_pdf}: Unerwarteter DB-Status '${completeness}'"
    failed=$((failed + 1))
    break
  fi

  start_epoch="$(date +%s)"
  if ! run_import_for_json "${json}" "${file_log}"; then
    duration=$(( $(date +%s) - start_epoch ))
    log "FEHLER ${rel_pdf}: Import fehlgeschlagen (Dauer ${duration}s, Log: ${file_log})"
    failed=$((failed + 1))
    break
  fi
  duration=$(( $(date +%s) - start_epoch ))

  if [[ "${json_generated_this_file}" -eq 1 ]]; then
    imported_after_generation=$((imported_after_generation + 1))
  else
    imported_from_existing_json=$((imported_from_existing_json + 1))
  fi
  processed=$((processed + 1))
  log "OK ${rel_pdf} (Import Dauer ${duration}s, Log: ${file_log})"
done

log "FERTIG range=${START_INDEX}-${END_INDEX} processed=${processed} skipped=${skipped} checked_json=${checked_json} db_complete_skipped=${db_complete_skipped} imported_from_existing_json=${imported_from_existing_json} generated_json=${generated_json} imported_after_generation=${imported_after_generation} failed=${failed}"

if [[ ${failed} -gt 0 ]]; then
  exit 1
fi
