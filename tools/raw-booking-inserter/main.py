"""
raw-booking-inserter
====================

LLM integration contract
------------------------
Use this tool to validate booking rows before asking a user for corrections.

Command:
  python main.py validate --bookings-file /path/to/bookings.json [--strict]
  python main.py import --bookings-file /path/to/bookings.json [--db /path/to/datenbank.sqlite] [--account-id 1] [--strict]

Exit codes:
  0 -> validation passed
  2 -> validation failed (input/content issues)
  3 -> technical failure (file/io/runtime issues)

Input JSON:
  {
    "statement_no": "01/2023",
    "rows": [
      {
        "datum": "02.01.2023",
        "typ": "Eröffnungssaldo",
        "buchungstext": "Vortrag",
        "soll_eur": null,
        "haben_eur": null,
        "saldo_eur": "35.426,37"
      }
    ]
  }

Output JSON (stable keys):
  {
    "status": "ok|error",
    "statement_no": "01/2023",
    "errors": [
      {
        "level": "error",
        "code": "running_balance_mismatch",
        "message": "...",
        "category": "saldo",
        "suggested_action": "verify_amounts_and_balance",
        "ask_user": "Please confirm Soll/Haben/Saldo for row N.",
        "row_index": 3,
        "field": "Saldo (EUR)"
      }
    ],
    "warnings": [
      {
        "level": "warning",
        "code": "unknown_type",
        "message": "...",
        "category": "type",
        "suggested_action": "map_or_replace_type",
        "ask_user": "Please provide one supported type for this row."
      }
    ]
  }

LLM handling recommendation:
  - If exit code is 2:
    1) iterate over errors
    2) present each error.message in user language
    3) ask exactly error.ask_user
    4) apply correction and rerun validation
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


EXIT_OK = 0
EXIT_VALIDATION_ERROR = 2
EXIT_TECHNICAL_ERROR = 3
DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "datenbank.sqlite"


ALLOWED_TYPES = {
    "Eroeffnungssaldo",
    "Eröffnungssaldo",
    "Schlusssaldo",
    "Lastschrift",
    "Gutschrift/Überweisung",
}

DEFAULT_GUIDANCE = {
    "category": "validation",
    "suggested_action": "review_input",
    "ask_user": "Please review the input row and provide a corrected value.",
}

ISSUE_GUIDANCE: dict[str, dict[str, str]] = {
    "invalid_amount": {
        "category": "amount",
        "suggested_action": "fix_amount_format",
        "ask_user": (
            "Please provide a valid EUR amount using German format "
            "(e.g. 1.234,56) for the affected field."
        ),
    },
    "invalid_date": {
        "category": "date",
        "suggested_action": "fix_date_format",
        "ask_user": "Please provide the booking date in DD.MM.YYYY format.",
    },
    "invalid_row_format": {
        "category": "row_shape",
        "suggested_action": "fix_pipe_row",
        "ask_user": "Please provide the row in pipe format starting and ending with '|'.",
    },
    "invalid_column_count": {
        "category": "row_shape",
        "suggested_action": "fix_pipe_row_columns",
        "ask_user": (
            "Please provide exactly 6 columns: Datum, Typ, Buchungstext, "
            "Soll (EUR), Haben (EUR), Saldo (EUR)."
        ),
    },
    "missing_type": {
        "category": "type",
        "suggested_action": "provide_type",
        "ask_user": "Please provide a booking type for this row.",
    },
    "unknown_type": {
        "category": "type",
        "suggested_action": "map_or_replace_type",
        "ask_user": (
            "Please provide one supported type: Eröffnungssaldo, "
            "Schlusssaldo, Lastschrift, Gutschrift/Überweisung."
        ),
    },
    "opening_balance_count_invalid": {
        "category": "statement_structure",
        "suggested_action": "fix_opening_row_count",
        "ask_user": "Please ensure the statement contains exactly one opening balance row.",
    },
    "closing_balance_count_invalid": {
        "category": "statement_structure",
        "suggested_action": "fix_closing_row_count",
        "ask_user": "Please ensure the statement contains exactly one closing balance row.",
    },
    "closing_before_opening": {
        "category": "statement_structure",
        "suggested_action": "reorder_balance_rows",
        "ask_user": "Please place Schlusssaldo after Eröffnungssaldo.",
    },
    "closing_not_last_row": {
        "category": "statement_structure",
        "suggested_action": "move_closing_to_last_row",
        "ask_user": "Please move Schlusssaldo to the final row.",
    },
    "opening_has_movement_amounts": {
        "category": "statement_structure",
        "suggested_action": "clear_opening_soll_haben",
        "ask_user": "Please clear Soll and Haben in the opening balance row.",
    },
    "closing_has_movement_amounts": {
        "category": "statement_structure",
        "suggested_action": "clear_closing_soll_haben",
        "ask_user": "Please clear Soll and Haben in the closing balance row.",
    },
    "no_movements": {
        "category": "statement_structure",
        "suggested_action": "add_movement_rows",
        "ask_user": "Please provide at least one movement row between opening and closing balance.",
    },
    "invalid_debit_structure": {
        "category": "type_amount_rule",
        "suggested_action": "fix_lastschrift_fields",
        "ask_user": "For Lastschrift, please set Soll > 0 and Haben empty/0.",
    },
    "invalid_credit_structure": {
        "category": "type_amount_rule",
        "suggested_action": "fix_credit_fields",
        "ask_user": "For Gutschrift/Überweisung, please set Haben > 0 and Soll empty/0.",
    },
    "invalid_movement_type": {
        "category": "type",
        "suggested_action": "replace_movement_type",
        "ask_user": "Please replace this movement type with a supported one.",
    },
    "both_sides_positive": {
        "category": "amount",
        "suggested_action": "keep_only_one_side",
        "ask_user": "Please keep only one side positive: either Soll or Haben.",
    },
    "movement_amount_missing": {
        "category": "amount",
        "suggested_action": "set_soll_or_haben",
        "ask_user": "Please set Soll or Haben to a value > 0.",
    },
    "running_balance_mismatch": {
        "category": "saldo",
        "suggested_action": "verify_amounts_and_balance",
        "ask_user": (
            "Please confirm Soll, Haben and Saldo for this row. "
            "One of these values is inconsistent."
        ),
    },
    "closing_balance_mismatch": {
        "category": "saldo",
        "suggested_action": "fix_closing_balance",
        "ask_user": "Please correct the Schlusssaldo to match the computed running balance.",
    },
    "opening_balance_db_mismatch": {
        "category": "database",
        "suggested_action": "align_with_current_db_balance",
        "ask_user": (
            "Please ensure Eröffnungssaldo equals the current account balance "
            "in the database before importing a new statement."
        ),
    },
    "file_read_failed": {
        "category": "io",
        "suggested_action": "check_file_path",
        "ask_user": "Please confirm the bookings file path exists and is readable.",
    },
    "invalid_json": {
        "category": "json",
        "suggested_action": "fix_json_syntax",
        "ask_user": "Please provide valid JSON syntax in the bookings file.",
    },
    "invalid_payload_root": {
        "category": "json",
        "suggested_action": "use_object_root",
        "ask_user": "Please provide a JSON object with statement_no and rows.",
    },
    "missing_statement_no": {
        "category": "json",
        "suggested_action": "provide_statement_no",
        "ask_user": "Please provide statement_no, for example '01/2023'.",
    },
    "missing_rows": {
        "category": "json",
        "suggested_action": "provide_rows_array",
        "ask_user": "Please provide a non-empty rows array.",
    },
    "invalid_row_item": {
        "category": "json",
        "suggested_action": "fix_rows_items",
        "ask_user": (
            "Each rows item must be an object with keys: datum, typ, buchungstext, "
            "soll_eur, haben_eur, saldo_eur."
        ),
    },
    "legacy_line_not_supported": {
        "category": "json",
        "suggested_action": "migrate_line_to_structured_fields",
        "ask_user": (
            "Please convert line-based rows to structured fields "
            "(datum, typ, buchungstext, soll_eur, haben_eur, saldo_eur)."
        ),
    },
    "missing_row_field": {
        "category": "json",
        "suggested_action": "provide_missing_row_fields",
        "ask_user": (
            "Please add all required row fields: datum, typ, buchungstext, "
            "soll_eur, haben_eur, saldo_eur."
        ),
    },
    "invalid_row_field_type": {
        "category": "json",
        "suggested_action": "fix_row_field_types",
        "ask_user": (
            "Please use string values for datum, typ, buchungstext, saldo_eur "
            "and string-or-null for soll_eur/haben_eur."
        ),
    },
    "invalid_amount_type": {
        "category": "amount",
        "suggested_action": "use_string_or_null_amount",
        "ask_user": (
            "Please provide amount values as German-formatted strings "
            "(e.g. 1.234,56) or null for empty fields."
        ),
    },
    "technical_error": {
        "category": "runtime",
        "suggested_action": "retry_or_inspect_logs",
        "ask_user": "A runtime error occurred. Please retry and share the full error output.",
    },
    "account_not_found": {
        "category": "database",
        "suggested_action": "choose_existing_account",
        "ask_user": "Please provide an existing account_id or use an empty database to auto-create one.",
    },
    "invalid_account_id": {
        "category": "database",
        "suggested_action": "use_positive_account_id",
        "ask_user": "Please provide account_id as a positive integer.",
    },
    "duplicate_transaction_skipped": {
        "category": "database",
        "suggested_action": "continue_or_check_fingerprint_inputs",
        "ask_user": "Transactions were already present and skipped. Confirm whether this is expected.",
    },
}


@dataclass(frozen=True)
class ParsedRow:
    row_index: int
    booking_date_iso: str
    tx_type: str
    booking_text: str
    soll_cents: int | None
    haben_cents: int | None
    saldo_cents: int

    @property
    def is_opening(self) -> bool:
        return self.tx_type in {"Eroeffnungssaldo", "Eröffnungssaldo"}

    @property
    def is_closing(self) -> bool:
        return self.tx_type == "Schlusssaldo"


class ValidationFailure(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        row_index: int | None = None,
        field: str | None = None,
        report_context: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.row_index = row_index
        self.field = field
        self.report_context = report_context or {}

    def as_dict(self) -> dict[str, Any]:
        guidance = ISSUE_GUIDANCE.get(self.code, DEFAULT_GUIDANCE)
        out: dict[str, Any] = {
            "level": "error",
            "code": self.code,
            "message": self.message,
            "category": guidance["category"],
            "suggested_action": guidance["suggested_action"],
            "ask_user": guidance["ask_user"],
        }
        if self.row_index is not None:
            out["row_index"] = self.row_index
        if self.field is not None:
            out["field"] = self.field
        return out


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="raw-booking-inserter",
        description=(
            "Validiert Rohbuchungen im Tabellenformat gegen Typ-, "
            "Soll/Haben- und Saldo-Plausibilitaet."
        ),
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate = subparsers.add_parser(
        "validate",
        help="Validiert eine JSON-Datei mit Buchungszeilen.",
    )
    validate.add_argument(
        "--bookings-file",
        required=True,
        type=Path,
        help=(
            "Pfad zur JSON-Datei mit statement_no + rows[] "
            "(datum, typ, buchungstext, soll_eur, haben_eur, saldo_eur)."
        ),
    )
    validate.add_argument(
        "--strict",
        action="store_true",
        help="Unbekannte Buchungstypen als Fehler behandeln.",
    )

    import_cmd = subparsers.add_parser(
        "import",
        help="Validiert und schreibt Buchungen in die SQLite-Datenbank.",
    )
    import_cmd.add_argument(
        "--bookings-file",
        required=True,
        type=Path,
        help=(
            "Pfad zur JSON-Datei mit statement_no + rows[] "
            "(datum, typ, buchungstext, soll_eur, haben_eur, saldo_eur)."
        ),
    )
    import_cmd.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB_PATH,
        help=f"Pfad zur SQLite-DB (Default: {DEFAULT_DB_PATH}).",
    )
    import_cmd.add_argument(
        "--account-id",
        type=int,
        default=1,
        help="Konto-ID fuer bank_transactions (Default: 1).",
    )
    import_cmd.add_argument(
        "--strict",
        action="store_true",
        help="Unbekannte Buchungstypen als Fehler behandeln.",
    )

    return parser.parse_args(argv)


def parse_cents_de(
    raw_amount: Any, *, row_index: int, field: str, allow_empty: bool = True
) -> int | None:
    if raw_amount is None:
        if allow_empty:
            return None
        raise ValidationFailure(
            "invalid_amount",
            f"Betrag in Feld '{field}' ist leer.",
            row_index=row_index,
            field=field,
        )

    if not isinstance(raw_amount, str):
        raise ValidationFailure(
            "invalid_amount_type",
            f"Feld '{field}' muss String oder null sein, erhalten: {type(raw_amount).__name__}.",
            row_index=row_index,
            field=field,
        )

    value = raw_amount.strip().replace("\u00a0", "").replace(" ", "")
    if value == "":
        if allow_empty:
            return None
        raise ValidationFailure(
            "invalid_amount",
            f"Betrag in Feld '{field}' ist leer.",
            row_index=row_index,
            field=field,
        )

    sign = -1 if value.startswith("-") else 1
    if value[0] in {"+", "-"}:
        value = value[1:]

    if not re.fullmatch(r"\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?", value):
        raise ValidationFailure(
            "invalid_amount",
            f"Ungueltiges EUR-Format in Feld '{field}': '{raw_amount}'.",
            row_index=row_index,
            field=field,
        )

    normalized = value.replace(".", "")
    if "," in normalized:
        euros, cents = normalized.split(",", 1)
        cents = cents.ljust(2, "0")
    else:
        euros, cents = normalized, "00"

    return sign * (int(euros) * 100 + int(cents[:2]))


def parse_date_iso(raw_date: Any, *, row_index: int) -> str:
    if not isinstance(raw_date, str):
        raise ValidationFailure(
            "invalid_row_field_type",
            "Feld 'datum' muss ein String im Format DD.MM.YYYY sein.",
            row_index=row_index,
            field="datum",
        )
    value = raw_date.strip()
    try:
        return datetime.strptime(value, "%d.%m.%Y").date().isoformat()
    except ValueError as exc:
        raise ValidationFailure(
            "invalid_date",
            f"Ungueltiges Datum '{raw_date}', erwartet DD.MM.YYYY.",
            row_index=row_index,
            field="Datum",
        ) from exc


def parse_row_object(row_obj: Any, row_index: int) -> ParsedRow:
    required_fields = {
        "datum",
        "typ",
        "buchungstext",
        "soll_eur",
        "haben_eur",
        "saldo_eur",
    }
    if not isinstance(row_obj, dict):
        raise ValidationFailure(
            "invalid_row_item",
            "Jedes rows-Element muss ein Objekt sein.",
            row_index=row_index,
            field="rows",
        )
    if "line" in row_obj:
        raise ValidationFailure(
            "legacy_line_not_supported",
            "Legacy-Feld 'line' wird nicht mehr unterstuetzt.",
            row_index=row_index,
            field="line",
        )

    missing = sorted(field for field in required_fields if field not in row_obj)
    if missing:
        raise ValidationFailure(
            "missing_row_field",
            f"Fehlende Felder in rows[{row_index}]: {', '.join(missing)}.",
            row_index=row_index,
            field="rows",
        )

    raw_date = row_obj["datum"]
    tx_type_raw = row_obj["typ"]
    booking_text_raw = row_obj["buchungstext"]
    raw_soll = row_obj["soll_eur"]
    raw_haben = row_obj["haben_eur"]
    raw_saldo = row_obj["saldo_eur"]

    if not isinstance(tx_type_raw, str):
        raise ValidationFailure(
            "invalid_row_field_type",
            "Feld 'typ' muss ein String sein.",
            row_index=row_index,
            field="typ",
        )
    tx_type = tx_type_raw.strip()
    if tx_type == "":
        raise ValidationFailure(
            "missing_type",
            "Spalte 'Typ' darf nicht leer sein.",
            row_index=row_index,
            field="Typ",
        )

    if not isinstance(booking_text_raw, str):
        raise ValidationFailure(
            "invalid_row_field_type",
            "Feld 'buchungstext' muss ein String sein.",
            row_index=row_index,
            field="buchungstext",
        )
    booking_text = booking_text_raw.strip()

    booking_date_iso = parse_date_iso(raw_date, row_index=row_index)
    soll_cents = parse_cents_de(raw_soll, row_index=row_index, field="Soll (EUR)")
    haben_cents = parse_cents_de(raw_haben, row_index=row_index, field="Haben (EUR)")
    saldo_cents = parse_cents_de(
        raw_saldo,
        row_index=row_index,
        field="Saldo (EUR)",
        allow_empty=False,
    )
    assert saldo_cents is not None

    return ParsedRow(
        row_index=row_index,
        booking_date_iso=booking_date_iso,
        tx_type=tx_type,
        booking_text=booking_text,
        soll_cents=soll_cents,
        haben_cents=haben_cents,
        saldo_cents=saldo_cents,
    )


def _value_or_zero(value: int | None) -> int:
    return 0 if value is None else value


def validate_rows(rows: list[ParsedRow], *, strict: bool) -> dict[str, Any]:
    warnings: list[dict[str, Any]] = []
    opening_rows = [r for r in rows if r.is_opening]
    closing_rows = [r for r in rows if r.is_closing]

    if len(opening_rows) != 1:
        raise ValidationFailure(
            "opening_balance_count_invalid",
            f"Erwartet genau 1 Eroeffnungssaldo, gefunden {len(opening_rows)}.",
            report_context={"row_count": len(rows)},
        )
    if len(closing_rows) != 1:
        raise ValidationFailure(
            "closing_balance_count_invalid",
            f"Erwartet genau 1 Schlusssaldo, gefunden {len(closing_rows)}.",
            report_context={"row_count": len(rows)},
        )

    opening_row = opening_rows[0]
    closing_row = closing_rows[0]
    opening_idx = rows.index(opening_row)
    closing_idx = rows.index(closing_row)

    if closing_idx <= opening_idx:
        raise ValidationFailure(
            "closing_before_opening",
            "Schlusssaldo muss nach Eroeffnungssaldo kommen.",
            row_index=closing_row.row_index,
        )
    if closing_idx != len(rows) - 1:
        raise ValidationFailure(
            "closing_not_last_row",
            "Schlusssaldo muss in der letzten Zeile stehen.",
            row_index=closing_row.row_index,
        )

    if _value_or_zero(opening_row.soll_cents) != 0 or _value_or_zero(opening_row.haben_cents) != 0:
        raise ValidationFailure(
            "opening_has_movement_amounts",
            "Eroeffnungssaldo darf keine Soll/Haben-Werte enthalten.",
            row_index=opening_row.row_index,
        )
    if _value_or_zero(closing_row.soll_cents) != 0 or _value_or_zero(closing_row.haben_cents) != 0:
        raise ValidationFailure(
            "closing_has_movement_amounts",
            "Schlusssaldo darf keine Soll/Haben-Werte enthalten.",
            row_index=closing_row.row_index,
        )

    for row in rows:
        if row.tx_type not in ALLOWED_TYPES:
            if strict:
                raise ValidationFailure(
                    "unknown_type",
                    f"Unbekannter Buchungstyp '{row.tx_type}'.",
                    row_index=row.row_index,
                    field="Typ",
                )
            warnings.append(
                build_issue(
                    "warning",
                    "unknown_type",
                    f"Unbekannter Buchungstyp '{row.tx_type}'.",
                    row_index=row.row_index,
                )
            )

    movements = rows[opening_idx + 1 : closing_idx]
    if not movements:
        raise ValidationFailure(
            "no_movements",
            "Zwischen Eroeffnungssaldo und Schlusssaldo wurden keine Bewegungen gefunden.",
        )

    current_balance = opening_row.saldo_cents
    for row in movements:
        soll = _value_or_zero(row.soll_cents)
        haben = _value_or_zero(row.haben_cents)

        if row.tx_type == "Lastschrift":
            if soll <= 0 or haben != 0:
                raise ValidationFailure(
                    "invalid_debit_structure",
                    "Lastschrift erwartet Soll > 0 und Haben leer/0.",
                    row_index=row.row_index,
                )
        elif row.tx_type == "Gutschrift/Überweisung":
            if haben <= 0 or soll != 0:
                raise ValidationFailure(
                    "invalid_credit_structure",
                    "Gutschrift/Überweisung erwartet Haben > 0 und Soll leer/0.",
                    row_index=row.row_index,
                )
        else:
            if strict:
                raise ValidationFailure(
                    "invalid_movement_type",
                    f"Bewegungstyp '{row.tx_type}' ist im Strict-Modus nicht erlaubt.",
                    row_index=row.row_index,
                )
            if soll > 0 and haben > 0:
                raise ValidationFailure(
                    "both_sides_positive",
                    "Soll und Haben duerfen nicht gleichzeitig positiv sein.",
                    row_index=row.row_index,
                )
            if soll == 0 and haben == 0:
                raise ValidationFailure(
                    "movement_amount_missing",
                    "Bewegung braucht Soll oder Haben > 0.",
                    row_index=row.row_index,
                )

        delta = haben - soll
        expected_balance = current_balance + delta
        if row.saldo_cents != expected_balance:
            raise ValidationFailure(
                "running_balance_mismatch",
                (
                    f"Saldo passt nicht: erwartet {expected_balance}, "
                    f"gefunden {row.saldo_cents}."
                ),
                row_index=row.row_index,
                report_context={
                    "previous_balance_cents": current_balance,
                    "delta_cents": delta,
                },
            )
        current_balance = row.saldo_cents

    if current_balance != closing_row.saldo_cents:
        raise ValidationFailure(
            "closing_balance_mismatch",
            (
                f"Schlusssaldo passt nicht: berechnet {current_balance}, "
                f"in Zeile {closing_row.row_index} steht {closing_row.saldo_cents}."
            ),
            row_index=closing_row.row_index,
            report_context={"computed_closing_balance_cents": current_balance},
        )

    return {
        "warnings": warnings,
        "opening_balance_cents": opening_row.saldo_cents,
        "expected_closing_balance_cents": closing_row.saldo_cents,
        "computed_closing_balance_cents": current_balance,
        "movement_count": len(movements),
    }


def load_bookings_payload(path: Path) -> dict[str, Any]:
    try:
        raw_data = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ValidationFailure(
            "file_read_failed",
            f"Datei konnte nicht gelesen werden: {path}",
            field="bookings_file",
        ) from exc

    try:
        payload = json.loads(raw_data)
    except json.JSONDecodeError as exc:
        raise ValidationFailure(
            "invalid_json",
            f"JSON ungueltig: {exc.msg} (Zeile {exc.lineno}, Spalte {exc.colno}).",
            field="bookings_file",
        ) from exc

    if not isinstance(payload, dict):
        raise ValidationFailure(
            "invalid_payload_root",
            "Top-Level JSON muss ein Objekt sein.",
            field="bookings_file",
        )

    statement_no = payload.get("statement_no")
    rows = payload.get("rows")
    if not isinstance(statement_no, str) or statement_no.strip() == "":
        raise ValidationFailure(
            "missing_statement_no",
            "Feld 'statement_no' ist erforderlich.",
            field="statement_no",
        )
    if not isinstance(rows, list) or len(rows) == 0:
        raise ValidationFailure(
            "missing_rows",
            "Feld 'rows' muss ein nicht-leeres Array sein.",
            field="rows",
        )

    return payload


def build_error_report(statement_no: str | None, error: ValidationFailure) -> dict[str, Any]:
    report = {
        "status": "error",
        "statement_no": statement_no,
        "errors": [error.as_dict()],
        "warnings": [],
        "error_count": 1,
        "warning_count": 0,
    }
    report.update(error.report_context)
    return report


def build_issue(
    level: str,
    code: str,
    message: str,
    *,
    row_index: int | None = None,
    field: str | None = None,
) -> dict[str, Any]:
    guidance = ISSUE_GUIDANCE.get(code, DEFAULT_GUIDANCE)
    issue: dict[str, Any] = {
        "level": level,
        "code": code,
        "message": message,
        "category": guidance["category"],
        "suggested_action": guidance["suggested_action"],
        "ask_user": guidance["ask_user"],
    }
    if row_index is not None:
        issue["row_index"] = row_index
    if field is not None:
        issue["field"] = field
    return issue


def parse_and_validate_payload(
    payload: dict[str, Any], *, strict: bool
) -> tuple[str, list[ParsedRow], dict[str, Any]]:
    statement_no = str(payload["statement_no"]).strip()
    raw_rows = payload["rows"]

    try:
        parsed_rows: list[ParsedRow] = []
        for idx, raw_item in enumerate(raw_rows, start=1):
            parsed_rows.append(parse_row_object(raw_item, idx))

        validation = validate_rows(parsed_rows, strict=strict)
        return statement_no, parsed_rows, validation
    except ValidationFailure as exc:
        exc.report_context.setdefault("statement_no", statement_no)
        raise


def run_validate(bookings_file: Path, *, strict: bool) -> tuple[int, dict[str, Any]]:
    payload = load_bookings_payload(bookings_file)
    statement_no, parsed_rows, validation = parse_and_validate_payload(payload, strict=strict)
    report = {
        "status": "ok",
        "statement_no": statement_no,
        "row_count": len(parsed_rows),
        "movement_count": validation["movement_count"],
        "opening_balance_cents": validation["opening_balance_cents"],
        "expected_closing_balance_cents": validation["expected_closing_balance_cents"],
        "computed_closing_balance_cents": validation["computed_closing_balance_cents"],
        "warnings": validation["warnings"],
        "errors": [],
        "error_count": 0,
        "warning_count": len(validation["warnings"]),
    }
    return EXIT_OK, report


def now_iso_utc() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def count_user_tables(conn: sqlite3.Connection) -> int:
    row = conn.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).fetchone()
    return int(row[0]) if row else 0


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS bank_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            iban TEXT,
            bic TEXT,
            account_type TEXT NOT NULL,
            currency TEXT NOT NULL DEFAULT 'EUR',
            created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_accounts_identity
        ON bank_accounts(name, account_type, iban);

        CREATE TABLE IF NOT EXISTS import_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at TEXT NOT NULL,
            finished_at TEXT,
            parser_version TEXT,
            status TEXT NOT NULL CHECK (status IN ('running', 'success', 'error')),
            notes TEXT
        );

        CREATE TABLE IF NOT EXISTS source_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL,
            year INTEGER NOT NULL,
            file_path TEXT NOT NULL,
            file_sha256 TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            mtime TEXT NOT NULL,
            imported_at TEXT NOT NULL,
            import_run_id INTEGER,
            FOREIGN KEY (account_id) REFERENCES bank_accounts(id),
            FOREIGN KEY (import_run_id) REFERENCES import_runs(id),
            UNIQUE(account_id, file_sha256)
        );
        CREATE INDEX IF NOT EXISTS idx_source_files_year_account
        ON source_files(year, account_id);

        CREATE TABLE IF NOT EXISTS statement_docs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_file_id INTEGER NOT NULL UNIQUE,
            statement_no TEXT,
            period_from TEXT,
            period_to TEXT,
            opening_balance_cents INTEGER,
            closing_balance_cents INTEGER,
            currency TEXT NOT NULL DEFAULT 'EUR',
            FOREIGN KEY (source_file_id) REFERENCES source_files(id)
        );

        CREATE TABLE IF NOT EXISTS bank_transactions_raw (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            statement_doc_id INTEGER NOT NULL,
            page_no INTEGER,
            line_start INTEGER,
            line_end INTEGER,
            raw_block_text TEXT NOT NULL,
            parse_confidence REAL,
            parser_rule TEXT,
            parse_status TEXT NOT NULL CHECK (parse_status IN ('parsed', 'needs_review', 'error')),
            FOREIGN KEY (statement_doc_id) REFERENCES statement_docs(id)
        );
        CREATE INDEX IF NOT EXISTS idx_bank_transactions_raw_statement
        ON bank_transactions_raw(statement_doc_id);

        CREATE TABLE IF NOT EXISTS bank_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL,
            statement_doc_id INTEGER NOT NULL,
            booking_date TEXT NOT NULL,
            valuta_date TEXT,
            amount_cents INTEGER NOT NULL,
            currency TEXT NOT NULL DEFAULT 'EUR',
            running_balance_cents INTEGER,
            purpose TEXT,
            counterparty_name TEXT,
            counterparty_iban TEXT,
            counterparty_bic TEXT,
            reference TEXT,
            tx_type TEXT,
            fingerprint TEXT NOT NULL,
            is_reversal INTEGER NOT NULL DEFAULT 0 CHECK (is_reversal IN (0, 1)),
            FOREIGN KEY (account_id) REFERENCES bank_accounts(id),
            FOREIGN KEY (statement_doc_id) REFERENCES statement_docs(id),
            UNIQUE(account_id, fingerprint)
        );
        CREATE INDEX IF NOT EXISTS idx_bank_transactions_account_date
        ON bank_transactions(account_id, booking_date);

        CREATE TABLE IF NOT EXISTS statement_import_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            import_run_id INTEGER,
            account_id INTEGER,
            source_file_id INTEGER,
            statement_doc_id INTEGER,
            bank_transaction_id INTEGER,
            record_type TEXT NOT NULL CHECK (record_type IN ('statement_header', 'transaction', 'other')),
            source_ref TEXT,
            parser_rule TEXT,
            parse_confidence REAL,
            parse_status TEXT NOT NULL CHECK (parse_status IN ('parsed', 'needs_review', 'error')),
            parsed_data_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (import_run_id) REFERENCES import_runs(id),
            FOREIGN KEY (account_id) REFERENCES bank_accounts(id),
            FOREIGN KEY (source_file_id) REFERENCES source_files(id),
            FOREIGN KEY (statement_doc_id) REFERENCES statement_docs(id),
            FOREIGN KEY (bank_transaction_id) REFERENCES bank_transactions(id)
        );
        CREATE INDEX IF NOT EXISTS idx_statement_import_audit_source
        ON statement_import_audit(source_file_id, statement_doc_id);
        CREATE INDEX IF NOT EXISTS idx_statement_import_audit_status
        ON statement_import_audit(parse_status, record_type);
        """
    )


def ensure_account(conn: sqlite3.Connection, account_id: int) -> None:
    row = conn.execute("SELECT id FROM bank_accounts WHERE id = ?", (account_id,)).fetchone()
    if row:
        return

    count = conn.execute("SELECT COUNT(*) FROM bank_accounts").fetchone()
    existing_accounts = int(count[0]) if count else 0
    if existing_accounts > 0:
        raise ValidationFailure(
            "account_not_found",
            f"account_id {account_id} existiert nicht.",
            field="account_id",
        )

    conn.execute(
        """
        INSERT INTO bank_accounts (id, name, iban, bic, account_type, currency, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            account_id,
            f"Auto-created account {account_id}",
            None,
            None,
            "giro",
            "EUR",
            now_iso_utc(),
        ),
    )


def _detect_year(statement_no: str, rows: list[ParsedRow]) -> int:
    match = re.search(r"/(\d{4})$", statement_no)
    if match:
        return int(match.group(1))
    return int(rows[0].booking_date_iso[:4])


def _canonical_payload(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _upsert_source_file(
    conn: sqlite3.Connection,
    *,
    account_id: int,
    statement_no: str,
    payload: dict[str, Any],
    rows: list[ParsedRow],
) -> int:
    canonical = _canonical_payload(payload)
    sha256 = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    existing = conn.execute(
        "SELECT id FROM source_files WHERE account_id = ? AND file_sha256 = ?",
        (account_id, sha256),
    ).fetchone()
    if existing:
        return int(existing[0])

    now = now_iso_utc()
    cursor = conn.execute(
        """
        INSERT INTO source_files (
            account_id, year, file_path, file_sha256, file_size, mtime, imported_at, import_run_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
        """,
        (
            account_id,
            _detect_year(statement_no, rows),
            f"raw-booking-inserter://{statement_no}",
            sha256,
            len(canonical.encode("utf-8")),
            now,
            now,
        ),
    )
    return int(cursor.lastrowid)


def _find_or_create_statement_doc(
    conn: sqlite3.Connection,
    *,
    account_id: int,
    source_file_id: int,
    statement_no: str,
    opening_balance_cents: int,
    closing_balance_cents: int,
    rows: list[ParsedRow],
) -> int:
    existing_by_no = conn.execute(
        """
        SELECT sd.id
        FROM statement_docs sd
        JOIN source_files sf ON sf.id = sd.source_file_id
        WHERE sf.account_id = ? AND sd.statement_no = ?
        ORDER BY sd.id
        LIMIT 1
        """,
        (account_id, statement_no),
    ).fetchone()
    if existing_by_no:
        return int(existing_by_no[0])

    existing_by_source = conn.execute(
        "SELECT id FROM statement_docs WHERE source_file_id = ?",
        (source_file_id,),
    ).fetchone()
    if existing_by_source:
        return int(existing_by_source[0])

    cursor = conn.execute(
        """
        INSERT INTO statement_docs (
            source_file_id, statement_no, period_from, period_to,
            opening_balance_cents, closing_balance_cents, currency
        )
        VALUES (?, ?, ?, ?, ?, ?, 'EUR')
        """,
        (
            source_file_id,
            statement_no,
            rows[0].booking_date_iso,
            rows[-1].booking_date_iso,
            opening_balance_cents,
            closing_balance_cents,
        ),
    )
    return int(cursor.lastrowid)


def _statement_doc_exists_for_account(
    conn: sqlite3.Connection, *, account_id: int, statement_no: str
) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM statement_docs sd
        JOIN source_files sf ON sf.id = sd.source_file_id
        WHERE sf.account_id = ? AND sd.statement_no = ?
        LIMIT 1
        """,
        (account_id, statement_no),
    ).fetchone()
    return row is not None


def _current_account_balance_cents(conn: sqlite3.Connection, *, account_id: int) -> int | None:
    tx_row = conn.execute(
        """
        SELECT running_balance_cents
        FROM bank_transactions
        WHERE account_id = ? AND running_balance_cents IS NOT NULL
        ORDER BY booking_date DESC, id DESC
        LIMIT 1
        """,
        (account_id,),
    ).fetchone()
    if tx_row is not None:
        return int(tx_row[0])

    statement_row = conn.execute(
        """
        SELECT sd.closing_balance_cents
        FROM statement_docs sd
        JOIN source_files sf ON sf.id = sd.source_file_id
        WHERE sf.account_id = ? AND sd.closing_balance_cents IS NOT NULL
        ORDER BY sd.period_to DESC, sd.id DESC
        LIMIT 1
        """,
        (account_id,),
    ).fetchone()
    if statement_row is not None:
        return int(statement_row[0])

    return None


def _validate_opening_balance_against_db(
    conn: sqlite3.Connection,
    *,
    account_id: int,
    statement_no: str,
    opening_balance_cents: int,
) -> None:
    if _statement_doc_exists_for_account(conn, account_id=account_id, statement_no=statement_no):
        return

    current_balance_cents = _current_account_balance_cents(conn, account_id=account_id)
    if current_balance_cents is None:
        return

    if opening_balance_cents != current_balance_cents:
        raise ValidationFailure(
            "opening_balance_db_mismatch",
            (
                "Eröffnungssaldo passt nicht zum aktuellen Datenbankstand: "
                f"Erwartet {current_balance_cents}, gefunden {opening_balance_cents}."
            ),
            report_context={
                "statement_no": statement_no,
                "expected_opening_balance_cents": current_balance_cents,
                "provided_opening_balance_cents": opening_balance_cents,
            },
        )


def _movements(rows: list[ParsedRow]) -> list[ParsedRow]:
    opening_idx = next(i for i, row in enumerate(rows) if row.is_opening)
    closing_idx = next(i for i, row in enumerate(rows) if row.is_closing)
    return rows[opening_idx + 1 : closing_idx]


def _fingerprint(
    account_id: int,
    statement_doc_id: int,
    row: ParsedRow,
    amount_cents: int,
) -> str:
    purpose = re.sub(r"\s+", " ", row.booking_text.strip().lower())
    basis = "|".join(
        [
            str(account_id),
            str(statement_doc_id),
            row.booking_date_iso,
            str(amount_cents),
            str(row.saldo_cents),
            row.tx_type,
            purpose,
        ]
    )
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()


def _insert_import_records(
    conn: sqlite3.Connection,
    *,
    account_id: int,
    source_file_id: int,
    statement_doc_id: int,
    rows: list[ParsedRow],
) -> dict[str, int]:
    inserted_raw = 0
    inserted_tx = 0
    duplicate_tx = 0
    inserted_audit = 0
    now = now_iso_utc()
    parser_rule = "raw-booking-inserter:v1"
    movement_by_row_index = {row.row_index: row for row in _movements(rows)}

    # Keep re-runs idempotent for this parser by replacing its raw/audit rows.
    conn.execute(
        "DELETE FROM bank_transactions_raw WHERE statement_doc_id = ? AND parser_rule = ?",
        (statement_doc_id, parser_rule),
    )
    conn.execute(
        "DELETE FROM statement_import_audit WHERE statement_doc_id = ? AND parser_rule = ?",
        (statement_doc_id, parser_rule),
    )

    tx_ids_by_row_index: dict[int, int | None] = {}
    for row in rows:
        record = {
            "datum_iso": row.booking_date_iso,
            "typ": row.tx_type,
            "buchungstext": row.booking_text,
            "soll_cents": row.soll_cents,
            "haben_cents": row.haben_cents,
            "saldo_cents": row.saldo_cents,
        }
        conn.execute(
            """
            INSERT INTO bank_transactions_raw (
                statement_doc_id, page_no, line_start, line_end, raw_block_text,
                parse_confidence, parser_rule, parse_status
            )
            VALUES (?, NULL, ?, ?, ?, 1.0, ?, 'parsed')
            """,
            (
                statement_doc_id,
                row.row_index,
                row.row_index,
                json.dumps(record, ensure_ascii=False, sort_keys=True),
                parser_rule,
            ),
        )
        inserted_raw += 1

        if row.row_index in movement_by_row_index:
            amount_cents = _value_or_zero(row.haben_cents) - _value_or_zero(row.soll_cents)
            fingerprint = _fingerprint(account_id, statement_doc_id, row, amount_cents)
            existing = conn.execute(
                "SELECT id FROM bank_transactions WHERE account_id = ? AND fingerprint = ?",
                (account_id, fingerprint),
            ).fetchone()
            if existing:
                tx_ids_by_row_index[row.row_index] = int(existing[0])
                duplicate_tx += 1
            else:
                cursor = conn.execute(
                    """
                    INSERT INTO bank_transactions (
                        account_id, statement_doc_id, booking_date, valuta_date,
                        amount_cents, currency, running_balance_cents, purpose,
                        counterparty_name, counterparty_iban, counterparty_bic, reference,
                        tx_type, fingerprint, is_reversal
                    )
                    VALUES (?, ?, ?, ?, ?, 'EUR', ?, ?, NULL, NULL, NULL, NULL, ?, ?, 0)
                    """,
                    (
                        account_id,
                        statement_doc_id,
                        row.booking_date_iso,
                        row.booking_date_iso,
                        amount_cents,
                        row.saldo_cents,
                        row.booking_text,
                        row.tx_type,
                        fingerprint,
                    ),
                )
                tx_ids_by_row_index[row.row_index] = int(cursor.lastrowid)
                inserted_tx += 1
        else:
            tx_ids_by_row_index[row.row_index] = None

        record_type = "statement_header" if (row.is_opening or row.is_closing) else "transaction"
        audit_payload = {
            "datum_iso": row.booking_date_iso,
            "typ": row.tx_type,
            "buchungstext": row.booking_text,
            "soll_cents": row.soll_cents,
            "haben_cents": row.haben_cents,
            "saldo_cents": row.saldo_cents,
        }
        conn.execute(
            """
            INSERT INTO statement_import_audit (
                import_run_id, account_id, source_file_id, statement_doc_id, bank_transaction_id,
                record_type, source_ref, parser_rule, parse_confidence, parse_status, parsed_data_json, created_at
            )
            VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, 1.0, 'parsed', ?, ?)
            """,
            (
                account_id,
                source_file_id,
                statement_doc_id,
                tx_ids_by_row_index[row.row_index],
                record_type,
                f"rows[{row.row_index}]",
                parser_rule,
                json.dumps(audit_payload, ensure_ascii=False, sort_keys=True),
                now,
            ),
        )
        inserted_audit += 1

    return {
        "inserted_raw": inserted_raw,
        "inserted_tx": inserted_tx,
        "duplicate_tx": duplicate_tx,
        "inserted_audit": inserted_audit,
    }


def run_import(
    bookings_file: Path,
    *,
    db_path: Path,
    account_id: int,
    strict: bool,
) -> tuple[int, dict[str, Any]]:
    if account_id <= 0:
        raise ValidationFailure(
            "invalid_account_id",
            "account_id muss eine positive Ganzzahl sein.",
            field="account_id",
        )

    payload = load_bookings_payload(bookings_file)
    statement_no, parsed_rows, validation = parse_and_validate_payload(payload, strict=strict)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        table_count_before = count_user_tables(conn)
        ensure_schema(conn)
        db_prepared = table_count_before == 0

        with conn:
            ensure_account(conn, account_id)
            _validate_opening_balance_against_db(
                conn,
                account_id=account_id,
                statement_no=statement_no,
                opening_balance_cents=validation["opening_balance_cents"],
            )
            source_file_id = _upsert_source_file(
                conn,
                account_id=account_id,
                statement_no=statement_no,
                payload=payload,
                rows=parsed_rows,
            )
            statement_doc_id = _find_or_create_statement_doc(
                conn,
                account_id=account_id,
                source_file_id=source_file_id,
                statement_no=statement_no,
                opening_balance_cents=validation["opening_balance_cents"],
                closing_balance_cents=validation["expected_closing_balance_cents"],
                rows=parsed_rows,
            )
            insert_stats = _insert_import_records(
                conn,
                account_id=account_id,
                source_file_id=source_file_id,
                statement_doc_id=statement_doc_id,
                rows=parsed_rows,
            )

        warnings = list(validation["warnings"])
        if insert_stats["duplicate_tx"] > 0:
            warnings.append(
                build_issue(
                    "warning",
                    "duplicate_transaction_skipped",
                    (
                        f"{insert_stats['duplicate_tx']} Transaktion(en) bereits vorhanden "
                        "und nicht erneut eingefuegt."
                    ),
                )
            )

        report = {
            "status": "ok",
            "statement_no": statement_no,
            "db_path": str(db_path),
            "account_id": account_id,
            "db_prepared": db_prepared,
            "row_count": len(parsed_rows),
            "movement_count": validation["movement_count"],
            "opening_balance_cents": validation["opening_balance_cents"],
            "expected_closing_balance_cents": validation["expected_closing_balance_cents"],
            "computed_closing_balance_cents": validation["computed_closing_balance_cents"],
            "source_file_id": source_file_id,
            "statement_doc_id": statement_doc_id,
            "inserted_raw": insert_stats["inserted_raw"],
            "inserted_tx": insert_stats["inserted_tx"],
            "duplicate_tx": insert_stats["duplicate_tx"],
            "inserted_audit": insert_stats["inserted_audit"],
            "warnings": warnings,
            "errors": [],
            "error_count": 0,
            "warning_count": len(warnings),
        }
        return EXIT_OK, report
    finally:
        conn.close()


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.command not in {"validate", "import"}:
        report = {
            "status": "error",
            "errors": [{"code": "unsupported_command", "message": "Unbekannter Befehl."}],
            "warnings": [],
        }
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return EXIT_TECHNICAL_ERROR

    try:
        if args.command == "validate":
            exit_code, report = run_validate(args.bookings_file, strict=args.strict)
        else:
            exit_code, report = run_import(
                args.bookings_file,
                db_path=args.db,
                account_id=args.account_id,
                strict=args.strict,
            )
    except ValidationFailure as exc:
        statement_no = None
        if exc.report_context and isinstance(exc.report_context.get("statement_no"), str):
            statement_no = exc.report_context["statement_no"]
        report = build_error_report(statement_no, exc)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return EXIT_VALIDATION_ERROR
    except Exception as exc:  # noqa: BLE001
        report = {
            "status": "error",
            "statement_no": None,
            "errors": [build_issue("error", "technical_error", str(exc))],
            "warnings": [],
            "error_count": 1,
            "warning_count": 0,
        }
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return EXIT_TECHNICAL_ERROR

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
