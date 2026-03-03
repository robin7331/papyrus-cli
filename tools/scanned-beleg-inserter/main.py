#!/usr/bin/env python3
"""
scanned-beleg-inserter
======================

Validate and import one scanned receipt extraction JSON into `documents`.

Commands:
  python3 main.py validate --beleg-file /abs/path/file.scan.json [--strict]
  python3 main.py import --beleg-file /abs/path/file.scan.json [--db /abs/path/datenbank.sqlite] [--strict] [--relocate-raw-scan] [--source-buffer-root /abs/path/scanned_belege]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


EXIT_OK = 0
EXIT_VALIDATION_ERROR = 2
EXIT_TECHNICAL_ERROR = 3
DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "datenbank.sqlite"

ALLOWED_VAT_TREATMENTS = {
    "VAT_19",
    "VAT_0",
    "VAT_OSS",
    "VAT_EXPORT",
    "VAT_REVERSE_CHARGE",
    "VAT_UNKNOWN",
}

ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class ValidationProblem(Exception):
    pass


def now_iso() -> str:
    return datetime.now(tz=timezone.utc).replace(microsecond=0).isoformat()


def _safe_text(value: Any, max_len: int) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text[:max_len]


def _safe_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _safe_float_01(value: Any) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed < 0 or parsed > 1:
        return None
    return parsed


def _infer_year(source_pdf: Path, document_date: str | None, given_year: Any) -> int:
    if given_year is not None:
        year = _safe_int(given_year)
        if year is None or year < 2000 or year > 2100:
            raise ValidationProblem("year muss zwischen 2000 und 2100 liegen.")
        return year

    if document_date:
        return int(document_date[:4])

    parts = source_pdf.parts
    for i, part in enumerate(parts):
        if part.lower() == "scanned_belege" and i > 0 and re.fullmatch(r"20\d{2}", parts[i - 1]):
            return int(parts[i - 1])
    for part in parts:
        if re.fullmatch(r"20\d{2}", part):
            return int(part)

    return int(datetime.now(tz=timezone.utc).strftime("%Y"))


def _sanitize_filename_token(value: str | None, fallback: str, max_len: int = 120) -> str:
    if not value:
        return fallback
    token = str(value).strip()
    if not token:
        return fallback
    token = re.sub(r"[^A-Za-z0-9._-]+", "_", token)
    token = re.sub(r"_+", "_", token).strip("_.-")
    if not token:
        return fallback
    return token[:max_len]


def _month_part(document_date: str | None, now: str) -> str:
    if document_date:
        return document_date[:7]
    return now[:10][:7]


def _assert_within_buffer(path: Path, source_buffer_root: Path | None) -> None:
    if source_buffer_root is None:
        return
    path_resolved = path.resolve()
    buffer_root_resolved = source_buffer_root.resolve()
    if not path_resolved.is_relative_to(buffer_root_resolved):
        raise RuntimeError(
            f"Pfad liegt nicht unter source-buffer-root: path={path_resolved} root={buffer_root_resolved}"
        )


def _storage_rel_path_exists(conn: sqlite3.Connection, rel_path: Path) -> bool:
    row = conn.execute(
        "SELECT 1 FROM documents WHERE storage_rel_path = ? LIMIT 1",
        (str(rel_path),),
    ).fetchone()
    return row is not None


def _resolve_archive_targets(
    normalized: dict[str, Any],
    *,
    conn: sqlite3.Connection,
    file_sha: str,
    project_root: Path,
    now: str,
) -> tuple[Path, Path, Path, Path]:
    year = str(normalized["year"])
    month_part = _month_part(normalized["document_date"], now)
    rel_dir = Path(year) / "belege" / month_part
    abs_dir = project_root / rel_dir
    abs_dir.mkdir(parents=True, exist_ok=True)

    date_token = normalized["document_date"] if normalized["document_date"] else "unknown_date"
    invoice_token = _sanitize_filename_token(normalized["invoice_number"], "unknown_number")
    stem_base = f"raw_scan_{date_token}_{invoice_token}"

    sha_suffix = file_sha[:8]
    suffix_counter = 0
    while True:
        if suffix_counter == 0:
            stem = stem_base
        elif suffix_counter == 1:
            stem = f"{stem_base}_{sha_suffix}"
        else:
            stem = f"{stem_base}_{sha_suffix}_{suffix_counter}"

        pdf_rel = rel_dir / f"{stem}.pdf"
        json_rel = rel_dir / f"{stem}.scan.json"
        pdf_abs = project_root / pdf_rel
        json_abs = project_root / json_rel

        if pdf_abs.exists() or json_abs.exists():
            suffix_counter += 1
            continue
        if _storage_rel_path_exists(conn, pdf_rel):
            suffix_counter += 1
            continue
        return pdf_abs, pdf_rel, json_abs, json_rel


def _copy_archive_files(
    source_pdf: Path,
    beleg_file: Path,
    archived_pdf_abs: Path,
    archived_json_abs: Path,
) -> None:
    copied: list[Path] = []
    try:
        shutil.copyfile(source_pdf.resolve(), archived_pdf_abs)
        copied.append(archived_pdf_abs)
        shutil.copyfile(beleg_file.resolve(), archived_json_abs)
        copied.append(archived_json_abs)
    except Exception:
        for path in copied:
            path.unlink(missing_ok=True)
        raise


def _remove_buffer_files(source_pdf: Path, beleg_file: Path) -> None:
    source_pdf.unlink(missing_ok=True)
    beleg_file.unlink(missing_ok=True)


def load_and_validate(beleg_file: Path, strict: bool) -> dict[str, Any]:
    if not beleg_file.exists() or not beleg_file.is_file():
        raise ValidationProblem(f"beleg-file nicht gefunden: {beleg_file}")

    try:
        payload = json.loads(beleg_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValidationProblem(f"Ungueltiges JSON: {exc}") from exc

    if not isinstance(payload, dict):
        raise ValidationProblem("JSON Root muss ein Objekt sein.")

    source_pdf_raw = payload.get("source_pdf")
    source_pdf_text = _safe_text(source_pdf_raw, 5000)
    if not source_pdf_text:
        raise ValidationProblem("source_pdf fehlt.")

    source_pdf = Path(source_pdf_text)
    if not source_pdf.is_absolute():
        source_pdf = (beleg_file.parent / source_pdf).resolve()
    if not source_pdf.exists() or not source_pdf.is_file():
        raise ValidationProblem(f"source_pdf existiert nicht: {source_pdf}")
    if source_pdf.suffix.lower() != ".pdf":
        raise ValidationProblem("source_pdf muss eine PDF-Datei sein.")

    extracted = payload.get("extracted")
    if not isinstance(extracted, dict):
        raise ValidationProblem("extracted fehlt oder ist kein Objekt.")

    document_date = _safe_text(extracted.get("document_date"), 20)
    if document_date and not ISO_DATE_RE.fullmatch(document_date):
        raise ValidationProblem("extracted.document_date muss YYYY-MM-DD sein.")

    vat_treatment = _safe_text(extracted.get("vat_treatment"), 40) or "VAT_UNKNOWN"
    if vat_treatment not in ALLOWED_VAT_TREATMENTS:
        raise ValidationProblem(
            "extracted.vat_treatment ungueltig. Erlaubt: "
            + ", ".join(sorted(ALLOWED_VAT_TREATMENTS))
        )

    notes = extracted.get("notes")
    if notes is None:
        notes = []
    if not isinstance(notes, list):
        raise ValidationProblem("extracted.notes muss ein Array sein.")
    normalized_notes = []
    for item in notes:
        text = _safe_text(item, 200)
        if text:
            normalized_notes.append(text)

    normalized = {
        "source_pdf": source_pdf,
        "year": _infer_year(source_pdf, document_date, payload.get("year")),
        "document_date": document_date,
        "issuer_name": _safe_text(extracted.get("issuer_name"), 200),
        "invoice_number": _safe_text(extracted.get("invoice_number"), 120),
        "subject": _safe_text(extracted.get("subject"), 200),
        "summary_short": _safe_text(extracted.get("summary_short"), 400),
        "document_type": _safe_text(extracted.get("document_type"), 80),
        "gross_amount_cents": _safe_int(extracted.get("gross_amount_cents")),
        "net_amount_cents": _safe_int(extracted.get("net_amount_cents")),
        "vat_amount_cents": _safe_int(extracted.get("vat_amount_cents")),
        "vat_rate_bps": _safe_int(extracted.get("vat_rate_bps")),
        "vat_treatment": vat_treatment,
        "country_code": (_safe_text(extracted.get("country_code"), 2) or "").upper() or None,
        "ocr_confidence": _safe_float_01(extracted.get("ocr_confidence")),
        "ai_confidence": _safe_float_01(extracted.get("ai_confidence")),
        "ocr_text": _safe_text(extracted.get("ocr_text"), 50_000),
        "notes": normalized_notes[:30],
    }

    if normalized["country_code"] and not re.fullmatch(r"[A-Z]{2}", normalized["country_code"]):
        raise ValidationProblem("extracted.country_code muss ISO-2 sein.")

    vat_rate = normalized["vat_rate_bps"]
    if vat_rate is not None and (vat_rate < 0 or vat_rate > 10000):
        raise ValidationProblem("extracted.vat_rate_bps muss zwischen 0 und 10000 liegen.")

    if strict:
        if normalized["gross_amount_cents"] is None:
            raise ValidationProblem("strict: extracted.gross_amount_cents fehlt.")
        if normalized["subject"] is None:
            raise ValidationProblem("strict: extracted.subject fehlt.")
        if normalized["vat_treatment"] == "VAT_UNKNOWN":
            raise ValidationProblem("strict: extracted.vat_treatment darf nicht VAT_UNKNOWN sein.")

    return normalized


def _json_result(status: str, **kwargs: Any) -> str:
    payload = {"status": status, **kwargs}
    return json.dumps(payload, ensure_ascii=False)


def run_validate(beleg_file: Path, strict: bool) -> int:
    normalized = load_and_validate(beleg_file, strict)
    print(
        _json_result(
            "ok",
            beleg_file=str(beleg_file),
            source_pdf=str(normalized["source_pdf"]),
            year=normalized["year"],
            strict=bool(strict),
            vat_treatment=normalized["vat_treatment"],
            has_subject=bool(normalized["subject"]),
            has_gross_amount=normalized["gross_amount_cents"] is not None,
        )
    )
    return EXIT_OK


def _document_columns(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("PRAGMA table_info(documents)").fetchall()
    return {str(row[1]) for row in rows}


def _compute_review_required(normalized: dict[str, Any]) -> int:
    threshold = float(os.environ.get("SCANNED_BELEG_MIN_CONFIDENCE", "0.80"))
    ai_conf = normalized["ai_confidence"]
    if ai_conf is None:
        return 1
    if ai_conf < threshold:
        return 1
    if normalized["gross_amount_cents"] is None or normalized["subject"] is None:
        return 1
    if normalized["vat_treatment"] == "VAT_UNKNOWN":
        return 1
    return 0


def run_import(
    beleg_file: Path,
    db_path: Path,
    strict: bool,
    *,
    relocate_raw_scan: bool,
    source_buffer_root: Path | None,
) -> int:
    normalized = load_and_validate(beleg_file, strict)

    if not db_path.exists():
        raise RuntimeError(f"DB nicht gefunden: {db_path}")

    source_pdf: Path = normalized["source_pdf"]
    beleg_file = beleg_file.resolve()
    source_bytes = source_pdf.read_bytes()
    file_sha = hashlib.sha256(source_bytes).hexdigest()
    file_size = source_pdf.stat().st_size
    project_root = Path(__file__).resolve().parents[2]
    now = now_iso()

    archived_pdf_abs: Path | None = None
    archived_pdf_rel: Path | None = None
    archived_json_abs: Path | None = None
    archived_json_rel: Path | None = None

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        if relocate_raw_scan:
            _assert_within_buffer(source_pdf, source_buffer_root)
            _assert_within_buffer(beleg_file, source_buffer_root)

        existing = conn.execute(
            "SELECT id, review_required FROM documents WHERE file_sha256 = ? LIMIT 1",
            (file_sha,),
        ).fetchone()
        if existing is not None:
            if relocate_raw_scan:
                archived_pdf_abs, archived_pdf_rel, archived_json_abs, archived_json_rel = _resolve_archive_targets(
                    normalized,
                    conn=conn,
                    file_sha=file_sha,
                    project_root=project_root,
                    now=now,
                )
                _copy_archive_files(source_pdf, beleg_file, archived_pdf_abs, archived_json_abs)
                _remove_buffer_files(source_pdf, beleg_file)

            result: dict[str, Any] = {
                "status": "ok",
                "created": False,
                "deduplicated": True,
                "document_id": int(existing["id"]),
                "review_required": bool(existing["review_required"] or 0),
                "db_path": str(db_path),
            }
            if archived_pdf_rel is not None:
                result["raw_scan_relocated"] = True
                result["raw_scan_rel_path"] = str(archived_pdf_rel)
                result["raw_scan_name"] = archived_pdf_abs.name if archived_pdf_abs else None
                result["archived_json_rel_path"] = str(archived_json_rel)
            else:
                result["raw_scan_relocated"] = False

            print(json.dumps(result, ensure_ascii=False))
            return EXIT_OK

        archived_pdf_abs, archived_pdf_rel, archived_json_abs, archived_json_rel = _resolve_archive_targets(
            normalized,
            conn=conn,
            file_sha=file_sha,
            project_root=project_root,
            now=now,
        )

        review_required = _compute_review_required(normalized)
        metadata = {
            "source": "scanned_beleg_skill",
            "source_pdf_original": str(source_pdf),
            "beleg_json_original": str(beleg_file),
            "archived_json_rel_path": str(archived_json_rel),
            "vat_treatment": normalized["vat_treatment"],
            "country_code": normalized["country_code"],
            "document_type": normalized["document_type"],
            "notes": normalized["notes"],
            "ai_confidence": normalized["ai_confidence"],
            "ocr_confidence": normalized["ocr_confidence"],
        }

        insert_data: dict[str, Any] = {
            "year": normalized["year"],
            "source_type": "scan",
            "lifecycle_status": "archiviert",
            "storage_rel_path": str(archived_pdf_rel),
            "original_filename": source_pdf.name,
            "mime_type": "application/pdf",
            "file_size_bytes": file_size,
            "file_sha256": file_sha,
            "document_date": normalized["document_date"],
            "issuer_name": normalized["issuer_name"],
            "invoice_number": normalized["invoice_number"],
            "gross_amount_cents": normalized["gross_amount_cents"],
            "net_amount_cents": normalized["net_amount_cents"],
            "vat_amount_cents": normalized["vat_amount_cents"],
            "vat_rate_bps": normalized["vat_rate_bps"],
            "subject": normalized["subject"],
            "summary_short": normalized["summary_short"],
            "ocr_text": normalized["ocr_text"],
            "ocr_confidence": normalized["ocr_confidence"],
            "ai_confidence": normalized["ai_confidence"],
            "review_required": review_required,
            "extraction_model": "manual_skill",
            "ocr_status": "done" if normalized["ocr_text"] else "not_needed",
            "metadata_json": json.dumps(metadata, ensure_ascii=False),
            "created_at": now,
            "updated_at": now,
        }

        columns_available = _document_columns(conn)
        cols = [key for key in insert_data.keys() if key in columns_available]
        if not cols:
            raise RuntimeError("documents hat keine erwarteten Spalten.")

        values = [insert_data[key] for key in cols]
        placeholders = ", ".join("?" for _ in cols)
        sql = f"INSERT INTO documents ({', '.join(cols)}) VALUES ({placeholders})"

        try:
            cursor = conn.execute(sql, values)
            conn.commit()
        except Exception:
            raise

        document_id = int(cursor.lastrowid)
        try:
            _copy_archive_files(source_pdf, beleg_file, archived_pdf_abs, archived_json_abs)
            if relocate_raw_scan:
                _remove_buffer_files(source_pdf, beleg_file)
        except Exception as exc:
            archived_pdf_abs.unlink(missing_ok=True)
            archived_json_abs.unlink(missing_ok=True)
            try:
                conn.execute("DELETE FROM documents WHERE id = ?", (document_id,))
                conn.commit()
            except Exception as rollback_exc:
                raise RuntimeError(
                    f"Import teilweise fehlgeschlagen (Dateiablage), Rollback fehlgeschlagen fuer document_id={document_id}: {rollback_exc}"
                ) from exc
            raise RuntimeError(
                f"Import teilweise fehlgeschlagen (Dateiablage), DB-Insert wurde rueckgaengig gemacht fuer document_id={document_id}."
            ) from exc

        result = {
            "status": "ok",
            "created": True,
            "deduplicated": False,
            "document_id": document_id,
            "review_required": bool(review_required),
            "storage_rel_path": str(archived_pdf_rel),
            "db_path": str(db_path),
            "raw_scan_relocated": bool(relocate_raw_scan),
            "raw_scan_rel_path": str(archived_pdf_rel),
            "raw_scan_name": archived_pdf_abs.name if archived_pdf_abs else None,
            "archived_json_rel_path": str(archived_json_rel),
        }

        print(json.dumps(result, ensure_ascii=False))
        return EXIT_OK
    finally:
        conn.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="scanned-beleg-inserter")
    sub = parser.add_subparsers(dest="command", required=True)

    validate_cmd = sub.add_parser("validate", help="Validate scanned receipt JSON")
    validate_cmd.add_argument("--beleg-file", required=True, type=Path)
    validate_cmd.add_argument("--strict", action="store_true")

    import_cmd = sub.add_parser("import", help="Validate and import scanned receipt JSON")
    import_cmd.add_argument("--beleg-file", required=True, type=Path)
    import_cmd.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    import_cmd.add_argument("--strict", action="store_true")
    import_cmd.add_argument("--relocate-raw-scan", action="store_true")
    import_cmd.add_argument("--source-buffer-root", type=Path)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        if args.command == "validate":
            return run_validate(args.beleg_file, args.strict)
        if args.command == "import":
            if args.relocate_raw_scan and args.source_buffer_root is None:
                raise ValidationProblem("--relocate-raw-scan erfordert --source-buffer-root.")
            if args.source_buffer_root is not None and not args.source_buffer_root.exists():
                raise ValidationProblem(f"source-buffer-root nicht gefunden: {args.source_buffer_root}")
            return run_import(
                args.beleg_file,
                args.db,
                args.strict,
                relocate_raw_scan=bool(args.relocate_raw_scan),
                source_buffer_root=args.source_buffer_root,
            )
        raise RuntimeError("Unbekannter command.")
    except ValidationProblem as exc:
        print(_json_result("error", error_code="validation_error", message=str(exc)))
        return EXIT_VALIDATION_ERROR
    except Exception as exc:  # noqa: BLE001
        print(_json_result("error", error_code="technical_error", message=str(exc)))
        return EXIT_TECHNICAL_ERROR


if __name__ == "__main__":
    raise SystemExit(main())
