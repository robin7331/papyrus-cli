# raw-booking-inserter

Validate statement rows before import.

## Run
```bash
python tools/raw-booking-inserter/main.py validate --bookings-file /abs/path/bookings.json --strict
```

```bash
python tools/raw-booking-inserter/main.py import --bookings-file /abs/path/bookings.json --strict
```

`import` validates first, then writes on success.
If `--db` is omitted, it uses: `./datenbank.sqlite`.
If the DB is empty/new, required tables are created automatically.
Re-runs skip already imported transactions (`duplicate_tx`) and replace raw/audit rows for this parser.

## Input
```json
{
  "statement_no": "01/2023",
  "rows": [
    {
      "datum": "02.01.2023",
      "typ": "Eröffnungssaldo",
      "buchungstext": "Vortragswert",
      "soll_eur": null,
      "haben_eur": null,
      "saldo_eur": "35.426,37"
    },
    {
      "datum": "03.01.2023",
      "typ": "Lastschrift",
      "buchungstext": "Miete Januar",
      "soll_eur": "1.200,00",
      "haben_eur": null,
      "saldo_eur": "34.226,37"
    },
    {
      "datum": "03.01.2023",
      "typ": "Schlusssaldo",
      "buchungstext": "Tagesabschluss",
      "soll_eur": null,
      "haben_eur": null,
      "saldo_eur": "34.226,37"
    }
  ]
}
```

`rows` items must be objects with:
`datum`, `typ`, `buchungstext`, `soll_eur`, `haben_eur`, `saldo_eur`.

## Exit Codes
- `0` valid
- `2` validation error
- `3` technical error

## Success Output
On success (`exit code 0`) `validate` returns:

```json
{
  "status": "ok",
  "statement_no": "01/2023",
  "row_count": 4,
  "movement_count": 2,
  "opening_balance_cents": 3542637,
  "expected_closing_balance_cents": 3622637,
  "computed_closing_balance_cents": 3622637,
  "warnings": [],
  "errors": [],
  "error_count": 0,
  "warning_count": 0
}
```

`import` returns the same validation fields plus DB write fields like:
`db_path`, `account_id`, `db_prepared`, `source_file_id`, `statement_doc_id`,
`inserted_raw`, `inserted_tx`, `duplicate_tx`, `inserted_audit`.

## LLM-friendly error fields
Each issue in `errors[]` / `warnings[]` includes:
- `code`
- `message`
- `category`
- `suggested_action`
- `ask_user`
- optional: `row_index`, `field`
