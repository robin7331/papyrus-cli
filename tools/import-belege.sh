#!/bin/bash

set -euo pipefail

if [[ $# -ne 0 ]]; then
  echo "Verwendung: $0" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${BUCHHALTUNG_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"

python3 - "$ROOT_DIR" <<'PY'
import json
import re
import shutil
import sqlite3
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import unquote


ALLOWED_YEARS = {2023, 2024, 2025, 2026}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SAFE_INVOICE_CHARS_RE = re.compile(r"[^A-Za-z0-9._-]+")
REPEATED_UNDERSCORES_RE = re.compile(r"_+")


class ImportErrorBase(Exception):
    pass


class ValidationError(ImportErrorBase):
    def __init__(self, message: str, code: str = "validation_error"):
        super().__init__(message)
        self.code = code


@dataclass
class PreparedReceipt:
    json_path: Path
    pdf_path: Path
    target_json_path: Path
    target_pdf_path: Path
    target_basename: str
    year: int
    document_date: str
    issuer_name: Optional[str]
    invoice_number: Optional[str]
    subject: Optional[str]
    summary_short: Optional[str]
    document_type: Optional[str]
    gross_amount_cents: Optional[int]
    net_amount_cents: Optional[int]
    vat_amount_cents: Optional[int]
    vat_rate_bps: Optional[int]
    vat_treatment: Optional[str]
    country_code: Optional[str]
    notes_json: str
    raw_json: str
    source_json_rel: str
    source_pdf_rel: str


def normalize_optional_string(value: Any, field_name: str, file_name: str) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValidationError(f"{file_name}: '{field_name}' muss ein String oder null sein")
    cleaned = value.strip()
    return cleaned or None


def normalize_optional_int(value: Any, field_name: str, file_name: str) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValidationError(f"{file_name}: '{field_name}' muss ein Integer oder null sein")
    return value


def read_json_payload(path: Path) -> tuple[str, Dict[str, Any]]:
    raw_text = path.read_text(encoding="utf-8")
    text = raw_text.strip()
    lines = text.splitlines()

    if lines and lines[0].startswith("```"):
        if len(lines) < 2 or not lines[-1].startswith("```"):
            raise ValidationError(f"{path.name}: JSON-Codeblock ist unvollstaendig")
        text = "\n".join(lines[1:-1]).strip()

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValidationError(f"{path.name}: JSON kann nicht geparst werden ({exc})") from exc

    if not isinstance(payload, dict):
        raise ValidationError(f"{path.name}: JSON-Wurzel muss ein Objekt sein")

    return raw_text, payload


def validate_document_date(value: Any, file_name: str) -> str:
    if not isinstance(value, str) or not DATE_RE.match(value):
        raise ValidationError(
            f"{file_name}: 'extracted.document_date' fehlt oder hat nicht das Format YYYY-MM-DD",
            code="invalid_document_date",
        )
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise ValidationError(f"{file_name}: 'extracted.document_date' ist kein gueltiges Datum", code="invalid_document_date") from exc
    return value


def normalize_invoice_number(value: Any, file_name: str) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValidationError(
            f"{file_name}: 'extracted.invoice_number' muss ein String oder null sein",
            code="invalid_invoice_number",
        )

    cleaned = value.strip()
    if not cleaned:
        return None

    sanitized = SAFE_INVOICE_CHARS_RE.sub("_", cleaned)
    sanitized = REPEATED_UNDERSCORES_RE.sub("_", sanitized).strip("_")
    if not sanitized:
        return None
    return sanitized


def safe_relative_path(path: Path, root_dir: Path) -> str:
    return str(path.resolve().relative_to(root_dir.resolve()))


def resolve_pdf_path(json_path: Path, payload: Dict[str, Any], scanned_dir: Path) -> Path:
    sibling_pdf = json_path.with_suffix(".pdf")
    if sibling_pdf.is_file():
        return sibling_pdf

    source_pdf = payload.get("source_pdf")
    decoded_source = None
    if isinstance(source_pdf, str) and source_pdf.strip():
        decoded_source = unquote(source_pdf.strip())

        candidate_path = Path(decoded_source)
        if not candidate_path.is_absolute():
            candidate_path = scanned_dir / candidate_path

        candidate_path = candidate_path.resolve(strict=False)
        scanned_root = scanned_dir.resolve()
        if candidate_path.is_file():
            try:
                candidate_path.relative_to(scanned_root)
                return candidate_path
            except ValueError:
                pass

        basename_candidate = scanned_dir / Path(decoded_source).name
        if basename_candidate.is_file():
            return basename_candidate

    raise ValidationError(
        f"{json_path.name}: PDF nicht aufloesbar (weder Schwesterdatei noch gueltiger source_pdf unter scanned_belege)",
        code="pdf_not_found",
    )


def ensure_schema(connection: sqlite3.Connection) -> None:
    connection.execute("PRAGMA foreign_keys = ON")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS belege (
            id INTEGER PRIMARY KEY,
            year INTEGER NOT NULL,
            document_date TEXT NOT NULL,
            issuer_name TEXT,
            invoice_number TEXT,
            subject TEXT,
            summary_short TEXT,
            document_type TEXT,
            gross_amount_cents INTEGER,
            net_amount_cents INTEGER,
            vat_amount_cents INTEGER,
            vat_rate_bps INTEGER,
            vat_treatment TEXT,
            country_code TEXT,
            notes_json TEXT NOT NULL,
            raw_json TEXT NOT NULL,
            target_basename TEXT NOT NULL,
            source_json_path TEXT NOT NULL,
            source_pdf_path TEXT NOT NULL,
            imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(source_json_path),
            UNIQUE(source_pdf_path),
            UNIQUE(target_basename)
        );

        CREATE INDEX IF NOT EXISTS idx_belege_year_document_date
            ON belege (year, document_date);

        CREATE INDEX IF NOT EXISTS idx_belege_invoice_number
            ON belege (invoice_number);
        """
    )


def load_existing_basenames(connection: sqlite3.Connection) -> set[str]:
    return {row[0] for row in connection.execute("SELECT target_basename FROM belege")}


def unique_archive_path(target_dir: Path, file_name: str) -> Path:
    candidate = target_dir / file_name
    if not candidate.exists():
        return candidate

    stem = Path(file_name).stem
    suffix = Path(file_name).suffix
    index = 2
    while True:
        candidate = target_dir / f"{stem}__{index}{suffix}"
        if not candidate.exists():
            return candidate
        index += 1


def locate_skipped_pdf(json_path: Path, scanned_dir: Path) -> Optional[Path]:
    sibling_pdf = json_path.with_suffix(".pdf")
    if sibling_pdf.exists():
        return sibling_pdf

    try:
        _, payload = read_json_payload(json_path)
    except ValidationError:
        return None

    source_pdf = payload.get("source_pdf")
    if not isinstance(source_pdf, str) or not source_pdf.strip():
        return None

    decoded_source = unquote(source_pdf.strip())
    candidate_path = Path(decoded_source)
    if not candidate_path.is_absolute():
        candidate_path = scanned_dir / candidate_path

    candidate_path = candidate_path.resolve(strict=False)
    scanned_root = scanned_dir.resolve()
    if candidate_path.is_file():
        try:
            candidate_path.relative_to(scanned_root)
            return candidate_path
        except ValueError:
            pass

    basename_candidate = scanned_dir / Path(decoded_source).name
    if basename_candidate.is_file():
        return basename_candidate

    return None


def archive_receipt_move(root_dir: Path, reason: str, json_path: Path, pdf_path: Optional[Path]) -> None:
    archive_dir = root_dir / "scanned_belege_not_imported" / reason
    archive_dir.mkdir(parents=True, exist_ok=True)

    if json_path.exists():
        json_target = unique_archive_path(archive_dir, json_path.name)
        shutil.move(str(json_path), str(json_target))

    if pdf_path is not None and pdf_path.exists():
        pdf_target = unique_archive_path(archive_dir, pdf_path.name)
        shutil.move(str(pdf_path), str(pdf_target))


def prepare_receipt(root_dir: Path, scanned_dir: Path, json_path: Path) -> PreparedReceipt:
    raw_json, payload = read_json_payload(json_path)

    year = payload.get("year")
    if isinstance(year, bool) or not isinstance(year, int):
        raise ValidationError(f"{json_path.name}: Top-Level 'year' fehlt oder ist kein Integer", code="invalid_year")
    if year not in ALLOWED_YEARS:
        raise ValidationError(
            f"{json_path.name}: Jahr {year} ist nicht erlaubt (nur 2023 bis 2026)",
            code="year_not_allowed",
        )

    extracted = payload.get("extracted")
    if not isinstance(extracted, dict):
        raise ValidationError(f"{json_path.name}: Top-Level 'extracted' fehlt oder ist kein Objekt", code="invalid_extracted")

    document_date = validate_document_date(extracted.get("document_date"), json_path.name)
    invoice_number = normalize_invoice_number(extracted.get("invoice_number"), json_path.name)

    pdf_path = resolve_pdf_path(json_path, payload, scanned_dir)
    year_dir = root_dir / str(year)
    belege_dir = year_dir / "belege"
    day = document_date[8:10]
    month = document_date[5:7]
    basename_suffix = invoice_number or "ohne_rechnungsnummer"
    target_basename = f"{day}-{month}-{basename_suffix}"
    target_json_path = belege_dir / f"{target_basename}.json"
    target_pdf_path = belege_dir / f"{target_basename}.pdf"

    notes_value = extracted.get("notes", [])
    if notes_value is None:
        notes_value = []
    notes_json = json.dumps(notes_value, ensure_ascii=False)

    try:
        source_json_rel = safe_relative_path(json_path, root_dir)
        source_pdf_rel = safe_relative_path(pdf_path, root_dir)
    except ValueError as exc:
        raise ValidationError(f"{json_path.name}: Quelldatei liegt nicht unterhalb des Repo-Roots", code="source_outside_root") from exc

    return PreparedReceipt(
        json_path=json_path,
        pdf_path=pdf_path,
        target_json_path=target_json_path,
        target_pdf_path=target_pdf_path,
        target_basename=target_basename,
        year=year,
        document_date=document_date,
        issuer_name=normalize_optional_string(extracted.get("issuer_name"), "extracted.issuer_name", json_path.name),
        invoice_number=invoice_number,
        subject=normalize_optional_string(extracted.get("subject"), "extracted.subject", json_path.name),
        summary_short=normalize_optional_string(extracted.get("summary_short"), "extracted.summary_short", json_path.name),
        document_type=normalize_optional_string(extracted.get("document_type"), "extracted.document_type", json_path.name),
        gross_amount_cents=normalize_optional_int(
            extracted.get("gross_amount_cents"), "extracted.gross_amount_cents", json_path.name
        ),
        net_amount_cents=normalize_optional_int(
            extracted.get("net_amount_cents"), "extracted.net_amount_cents", json_path.name
        ),
        vat_amount_cents=normalize_optional_int(
            extracted.get("vat_amount_cents"), "extracted.vat_amount_cents", json_path.name
        ),
        vat_rate_bps=normalize_optional_int(extracted.get("vat_rate_bps"), "extracted.vat_rate_bps", json_path.name),
        vat_treatment=normalize_optional_string(
            extracted.get("vat_treatment"), "extracted.vat_treatment", json_path.name
        ),
        country_code=normalize_optional_string(extracted.get("country_code"), "extracted.country_code", json_path.name),
        notes_json=notes_json,
        raw_json=raw_json,
        source_json_rel=source_json_rel,
        source_pdf_rel=source_pdf_rel,
    )


def move_file(source: Path, target: Path) -> None:
    subprocess.run(["mv", str(source), str(target)], check=True)


def best_effort_restore(source: Path, target: Path) -> None:
    if target.exists() and not source.exists():
        try:
            source.parent.mkdir(parents=True, exist_ok=True)
            move_file(target, source)
        except Exception as exc:  # noqa: BLE001
            print(f"  WARN: Rollback von {target.name} fehlgeschlagen: {exc}", file=sys.stderr)


def import_receipt(connection: sqlite3.Connection, receipt: PreparedReceipt) -> None:
    moved_json = False
    moved_pdf = False

    try:
        receipt.target_json_path.parent.mkdir(parents=True, exist_ok=True)

        move_file(receipt.json_path, receipt.target_json_path)
        moved_json = True
        move_file(receipt.pdf_path, receipt.target_pdf_path)
        moved_pdf = True

        with connection:
            connection.execute(
                """
                INSERT INTO belege (
                    year,
                    document_date,
                    issuer_name,
                    invoice_number,
                    subject,
                    summary_short,
                    document_type,
                    gross_amount_cents,
                    net_amount_cents,
                    vat_amount_cents,
                    vat_rate_bps,
                    vat_treatment,
                    country_code,
                    notes_json,
                    raw_json,
                    target_basename,
                    source_json_path,
                    source_pdf_path
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    receipt.year,
                    receipt.document_date,
                    receipt.issuer_name,
                    receipt.invoice_number,
                    receipt.subject,
                    receipt.summary_short,
                    receipt.document_type,
                    receipt.gross_amount_cents,
                    receipt.net_amount_cents,
                    receipt.vat_amount_cents,
                    receipt.vat_rate_bps,
                    receipt.vat_treatment,
                    receipt.country_code,
                    receipt.notes_json,
                    receipt.raw_json,
                    receipt.target_basename,
                    receipt.source_json_rel,
                    receipt.source_pdf_rel,
                ),
            )
    except Exception:
        if moved_pdf:
            best_effort_restore(receipt.pdf_path, receipt.target_pdf_path)
        if moved_json:
            best_effort_restore(receipt.json_path, receipt.target_json_path)
        raise


def main() -> int:
    root_dir = Path(sys.argv[1]).resolve()
    scanned_dir = root_dir / "scanned_belege"

    if not scanned_dir.is_dir():
        print(f"Ordner fehlt: {scanned_dir}", file=sys.stderr)
        return 1

    json_files = sorted(path for path in scanned_dir.iterdir() if path.is_file() and path.suffix.lower() == ".json")
    if not json_files:
        print("Keine JSON-Dateien in scanned_belege gefunden.")
        print("Import-Zusammenfassung: 0 importiert, 0 uebersprungen")
        return 0

    connections: Dict[int, sqlite3.Connection] = {}
    imported = 0
    skipped_messages: List[str] = []
    warning_messages: List[str] = []
    reserved_basenames: Dict[int, set[str]] = {}

    def get_connection(year: int) -> sqlite3.Connection:
        if year not in connections:
            year_dir = root_dir / str(year)
            year_dir.mkdir(parents=True, exist_ok=True)
            db_path = year_dir / "database.sqlite"
            connection = sqlite3.connect(db_path)
            ensure_schema(connection)
            connections[year] = connection
            reserved_basenames[year] = load_existing_basenames(connection)
        return connections[year]

    try:
        for json_path in json_files:
            print(f"Pruefe {json_path.relative_to(root_dir)}...")

            try:
                receipt = prepare_receipt(root_dir, scanned_dir, json_path)
                connection = get_connection(receipt.year)
                year_reserved = reserved_basenames[receipt.year]

                if receipt.target_basename in year_reserved:
                    raise ValidationError(
                        f"{json_path.name}: Zielbasename-Kollision fuer {receipt.year}/belege/{receipt.target_basename}",
                        code="target_basename_collision",
                    )
                if receipt.target_json_path.exists() or receipt.target_pdf_path.exists():
                    raise ValidationError(
                        f"{json_path.name}: Zieldatei existiert bereits fuer {receipt.year}/belege/{receipt.target_basename}",
                        code="target_file_exists",
                    )

                print(
                    f"  Importiere nach {receipt.year}/belege/{receipt.target_basename} "
                    f"({receipt.document_date}, Rechnung {receipt.invoice_number or 'ohne Rechnungsnummer'})..."
                )
                import_receipt(connection, receipt)
                reserved_basenames[receipt.year].add(receipt.target_basename)
                if receipt.invoice_number is None:
                    warning_messages.append(
                        f"{receipt.target_basename}: ohne Rechnungsnummer importiert ({receipt.source_json_rel})"
                    )
                imported += 1
            except ValidationError as exc:
                archive_receipt_move(root_dir, exc.code, json_path, locate_skipped_pdf(json_path, scanned_dir))
                skipped_messages.append(str(exc))
                print(f"  Uebersprungen: {exc}")
            except Exception as exc:  # noqa: BLE001
                message = f"{json_path.name}: Import fehlgeschlagen ({exc})"
                archive_receipt_move(root_dir, "import_error", json_path, locate_skipped_pdf(json_path, scanned_dir))
                skipped_messages.append(message)
                print(f"  Uebersprungen: {message}")
    finally:
        for connection in connections.values():
            connection.close()

    print("")
    print(
        f"Import-Zusammenfassung: {imported} importiert, {len(skipped_messages)} uebersprungen"
    )
    if skipped_messages:
        print("Uebersprungene Belege:")
        for message in skipped_messages:
            print(f"- {message}")
    if warning_messages:
        print("Warnungen:")
        for message in warning_messages:
            print(f"- {message}")

    return 0


raise SystemExit(main())
PY
