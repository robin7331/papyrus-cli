#!/bin/bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Verwendung: $0 <jahr>" >&2
  exit 1
fi

YEAR="$1"
if [[ ! "$YEAR" =~ ^[0-9]{4}$ ]]; then
  echo "Ungueltiges Jahr: $YEAR" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${BUCHHALTUNG_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"

python3 - "$ROOT_DIR" "$YEAR" <<'PY'
import json
import re
import sqlite3
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional


class ImportErrorBase(Exception):
    pass


class ValidationError(ImportErrorBase):
    pass


FILENAME_RE = re.compile(
    r"^Konto_(?P<account>[^-]+)-Auszug_(?P<year>\d{4})_(?P<sequence>\d{4})\.(?P<ext>json|pdf)$"
)


@dataclass
class StatementFile:
    account_number: str
    year: int
    sequence: int
    json_path: Path
    pdf_path: Optional[Path]


@dataclass
class ParsedTransaction:
    row_index: int
    booking_date: str
    transaction_type: str
    booking_text: str
    debit_cents: Optional[int]
    credit_cents: Optional[int]
    amount_cents: int
    balance_after_cents: int


@dataclass
class ParsedStatement:
    statement_no: str
    opening_date: str
    opening_balance_cents: int
    closing_date: str
    closing_balance_cents: int
    transaction_count: int
    transactions: List[ParsedTransaction]


def euro_to_cents(value: str) -> int:
    cleaned = value.strip()
    if not cleaned:
        raise ValidationError("Leerer EUR-Betrag")

    negative = cleaned.startswith("-")
    if negative:
        cleaned = cleaned[1:]

    cleaned = cleaned.replace(".", "")
    if "," in cleaned:
        euros, cents = cleaned.split(",", 1)
    else:
        euros, cents = cleaned, "00"

    if not euros:
        euros = "0"
    if not cents:
        cents = "00"
    if len(cents) == 1:
        cents = cents + "0"
    if len(cents) != 2 or not euros.isdigit() or not cents.isdigit():
        raise ValidationError(f"Ungueltiger EUR-Betrag: {value}")

    amount = int(euros) * 100 + int(cents)
    return -amount if negative else amount


def iso_date(value: str) -> str:
    try:
        return datetime.strptime(value.strip(), "%d.%m.%Y").date().isoformat()
    except ValueError as exc:
        raise ValidationError(f"Ungueltiges Datum: {value}") from exc


def read_statement_json(path: Path) -> Dict:
    text = path.read_text(encoding="utf-8").strip()
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

    return payload


def require_string(row: Dict, key: str, file_name: str, row_label: str) -> str:
    value = row.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{file_name}: {row_label} hat kein gueltiges Feld '{key}'")
    return value.strip()


def parse_statement(statement_file: StatementFile, previous_sequence: Optional[int], previous_closing: Optional[int]) -> ParsedStatement:
    payload = read_statement_json(statement_file.json_path)
    statement_no = payload.get("statement_no")
    rows = payload.get("rows")

    if not isinstance(statement_no, str) or not statement_no.strip():
        raise ValidationError(f"{statement_file.json_path.name}: 'statement_no' fehlt oder ist leer")
    if not isinstance(rows, list) or not rows:
        raise ValidationError(f"{statement_file.json_path.name}: 'rows' fehlt oder ist leer")

    opening_rows = [row for row in rows if row.get("typ") == "Eröffnungssaldo"]
    closing_rows = [row for row in rows if row.get("typ") == "Schlusssaldo"]

    if len(opening_rows) != 1 or len(closing_rows) != 1:
        raise ValidationError(
            f"{statement_file.json_path.name}: erwartet genau einen Eroeffnungs- und einen Schlusssaldo"
        )
    if rows[0].get("typ") != "Eröffnungssaldo":
        raise ValidationError(f"{statement_file.json_path.name}: erste Zeile ist kein Eroeffnungssaldo")
    if rows[-1].get("typ") != "Schlusssaldo":
        raise ValidationError(f"{statement_file.json_path.name}: letzte Zeile ist kein Schlusssaldo")

    opening_row = rows[0]
    closing_row = rows[-1]
    opening_balance = euro_to_cents(require_string(opening_row, "saldo_eur", statement_file.json_path.name, "Eroeffnungssaldo"))
    closing_balance = euro_to_cents(require_string(closing_row, "saldo_eur", statement_file.json_path.name, "Schlusssaldo"))
    opening_date = iso_date(require_string(opening_row, "datum", statement_file.json_path.name, "Eroeffnungssaldo"))
    closing_date = iso_date(require_string(closing_row, "datum", statement_file.json_path.name, "Schlusssaldo"))

    if opening_row.get("soll_eur") is not None or opening_row.get("haben_eur") is not None:
        raise ValidationError(f"{statement_file.json_path.name}: Eroeffnungssaldo darf keine Soll/Haben-Werte enthalten")
    if closing_row.get("soll_eur") is not None or closing_row.get("haben_eur") is not None:
        raise ValidationError(f"{statement_file.json_path.name}: Schlusssaldo darf keine Soll/Haben-Werte enthalten")

    if previous_sequence is not None and statement_file.sequence != previous_sequence + 1:
        raise ValidationError(
            f"{statement_file.json_path.name}: Dateifolge hat eine Luecke ({previous_sequence:04d} -> {statement_file.sequence:04d})"
        )
    if previous_closing is not None and opening_balance != previous_closing:
        raise ValidationError(
            f"{statement_file.json_path.name}: Eroeffnungssaldo {opening_balance} stimmt nicht mit vorherigem Schlusssaldo {previous_closing} ueberein"
        )

    running_balance = opening_balance
    transactions: List[ParsedTransaction] = []

    for transaction_index, row in enumerate(rows[1:-1], start=1):
        row_label = f"Buchungszeile {transaction_index}"
        booking_date = iso_date(require_string(row, "datum", statement_file.json_path.name, row_label))
        transaction_type = require_string(row, "typ", statement_file.json_path.name, row_label)
        booking_text = require_string(row, "buchungstext", statement_file.json_path.name, row_label)

        debit_raw = row.get("soll_eur")
        credit_raw = row.get("haben_eur")
        if (debit_raw is None) == (credit_raw is None):
            raise ValidationError(
                f"{statement_file.json_path.name}: {row_label} muss genau einen Soll- oder Haben-Betrag enthalten"
            )
        if row.get("saldo_eur") is not None:
            raise ValidationError(f"{statement_file.json_path.name}: {row_label} darf keinen Saldo enthalten")

        if debit_raw is not None:
            debit_cents = abs(euro_to_cents(str(debit_raw)))
            credit_cents = None
            amount_cents = -debit_cents
        else:
            debit_cents = None
            credit_cents = abs(euro_to_cents(str(credit_raw)))
            amount_cents = credit_cents

        running_balance += amount_cents
        transactions.append(
            ParsedTransaction(
                row_index=transaction_index,
                booking_date=booking_date,
                transaction_type=transaction_type,
                booking_text=booking_text,
                debit_cents=debit_cents,
                credit_cents=credit_cents,
                amount_cents=amount_cents,
                balance_after_cents=running_balance,
            )
        )

    if running_balance != closing_balance:
        raise ValidationError(
            f"{statement_file.json_path.name}: Saldo-Pruefung fehlgeschlagen (erwartet {closing_balance}, berechnet {running_balance})"
        )

    return ParsedStatement(
        statement_no=statement_no.strip(),
        opening_date=opening_date,
        opening_balance_cents=opening_balance,
        closing_date=closing_date,
        closing_balance_cents=closing_balance,
        transaction_count=len(transactions),
        transactions=transactions,
    )


def build_manifest(year_dir: Path, year: int) -> List[StatementFile]:
    statements_dir = year_dir / "auszuege"
    if not statements_dir.is_dir():
        raise ValidationError(f"Ordner fehlt: {statements_dir}")

    pdf_paths: Dict[tuple, Path] = {}
    json_paths: Dict[tuple, Path] = {}

    for path in sorted(statements_dir.iterdir()):
        if not path.is_file():
            continue
        match = FILENAME_RE.match(path.name)
        if not match:
            continue

        file_year = int(match.group("year"))
        if file_year != year:
            continue

        key = (match.group("account"), int(match.group("sequence")))
        ext = match.group("ext")
        if ext == "json":
            json_paths[key] = path
        else:
            pdf_paths[key] = path

    if not json_paths:
        raise ValidationError(f"Keine JSON-Auszuege fuer {year} in {statements_dir} gefunden")

    missing_json = sorted(key for key in pdf_paths if key not in json_paths)
    if missing_json:
        formatted = ", ".join(f"{account}:{sequence:04d}" for account, sequence in missing_json)
        raise ValidationError(f"Fehlende JSON-Dateien fuer vorhandene PDFs: {formatted}")

    grouped_sequences: Dict[str, List[int]] = {}
    for account, sequence in json_paths:
        grouped_sequences.setdefault(account, []).append(sequence)

    for account, sequences in grouped_sequences.items():
        ordered = sorted(sequences)
        expected = list(range(ordered[0], ordered[-1] + 1))
        if ordered != expected:
            missing = [value for value in expected if value not in set(ordered)]
            formatted = ", ".join(f"{value:04d}" for value in missing)
            raise ValidationError(f"Luecken in der Auszugsfolge fuer Konto {account}: {formatted}")

    manifest = [
        StatementFile(
            account_number=account,
            year=year,
            sequence=sequence,
            json_path=json_paths[(account, sequence)],
            pdf_path=pdf_paths.get((account, sequence)),
        )
        for account, sequence in sorted(json_paths.keys(), key=lambda item: (item[0], item[1]))
    ]
    return manifest


def ensure_schema(connection: sqlite3.Connection) -> None:
    connection.execute("PRAGMA foreign_keys = ON")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS bank_statements (
            id INTEGER PRIMARY KEY,
            year INTEGER NOT NULL,
            account_number TEXT NOT NULL,
            statement_sequence INTEGER NOT NULL,
            statement_no TEXT NOT NULL,
            source_json_path TEXT NOT NULL,
            source_pdf_path TEXT,
            opening_date TEXT NOT NULL,
            opening_balance_cents INTEGER NOT NULL,
            closing_date TEXT NOT NULL,
            closing_balance_cents INTEGER NOT NULL,
            transaction_count INTEGER NOT NULL,
            imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(year, account_number, statement_sequence)
        );

        CREATE TABLE IF NOT EXISTS bank_transactions (
            id INTEGER PRIMARY KEY,
            statement_id INTEGER NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
            row_index INTEGER NOT NULL,
            booking_date TEXT NOT NULL,
            transaction_type TEXT NOT NULL,
            booking_text TEXT NOT NULL,
            debit_cents INTEGER,
            credit_cents INTEGER,
            amount_cents INTEGER NOT NULL,
            balance_after_cents INTEGER NOT NULL,
            UNIQUE(statement_id, row_index),
            CHECK ((debit_cents IS NULL) != (credit_cents IS NULL))
        );

        CREATE INDEX IF NOT EXISTS idx_bank_statements_year_account
            ON bank_statements (year, account_number, statement_sequence);

        CREATE INDEX IF NOT EXISTS idx_bank_transactions_statement
            ON bank_transactions (statement_id, row_index);
        """
    )


def import_year(root_dir: Path, year: int) -> None:
    year_dir = root_dir / str(year)
    if not year_dir.is_dir():
        raise ValidationError(f"Jahresordner fehlt: {year_dir}")

    manifest = build_manifest(year_dir, year)
    db_path = year_dir / "database.sqlite"
    connection = sqlite3.connect(db_path)
    try:
        ensure_schema(connection)

        with connection:
            connection.execute("DELETE FROM bank_statements WHERE year = ?", (year,))

        previous_state: Dict[str, tuple] = {}

        for statement_file in manifest:
            previous_sequence, previous_closing = previous_state.get(statement_file.account_number, (None, None))
            print(
                f"Importiere {statement_file.json_path.relative_to(root_dir)} "
                f"(Konto {statement_file.account_number}, Folge {statement_file.sequence:04d})..."
            )

            parsed = parse_statement(statement_file, previous_sequence, previous_closing)

            with connection:
                cursor = connection.execute(
                    """
                    INSERT INTO bank_statements (
                        year,
                        account_number,
                        statement_sequence,
                        statement_no,
                        source_json_path,
                        source_pdf_path,
                        opening_date,
                        opening_balance_cents,
                        closing_date,
                        closing_balance_cents,
                        transaction_count
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        year,
                        statement_file.account_number,
                        statement_file.sequence,
                        parsed.statement_no,
                        str(statement_file.json_path.relative_to(root_dir)),
                        str(statement_file.pdf_path.relative_to(root_dir)) if statement_file.pdf_path else None,
                        parsed.opening_date,
                        parsed.opening_balance_cents,
                        parsed.closing_date,
                        parsed.closing_balance_cents,
                        parsed.transaction_count,
                    ),
                )
                statement_id = cursor.lastrowid

                connection.executemany(
                    """
                    INSERT INTO bank_transactions (
                        statement_id,
                        row_index,
                        booking_date,
                        transaction_type,
                        booking_text,
                        debit_cents,
                        credit_cents,
                        amount_cents,
                        balance_after_cents
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            statement_id,
                            transaction.row_index,
                            transaction.booking_date,
                            transaction.transaction_type,
                            transaction.booking_text,
                            transaction.debit_cents,
                            transaction.credit_cents,
                            transaction.amount_cents,
                            transaction.balance_after_cents,
                        )
                        for transaction in parsed.transactions
                    ],
                )

            previous_state[statement_file.account_number] = (
                statement_file.sequence,
                parsed.closing_balance_cents,
            )
            print(
                f"  OK: {parsed.transaction_count} Buchungen, Schlusssaldo {parsed.closing_balance_cents} Cent"
            )
    finally:
        connection.close()


def main() -> int:
    root_dir = Path(sys.argv[1]).resolve()
    year = int(sys.argv[2])

    try:
        import_year(root_dir, year)
    except ImportErrorBase as exc:
        print(f"Fehler: {exc}", file=sys.stderr)
        return 1

    print(f"Import fuer {year} abgeschlossen.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
PY
