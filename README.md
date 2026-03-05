<p align="center">
  <img src="./assets/header.png" alt="Papyrus CLI logo" width="180" />
</p>

<h1 align="center">Papyrus CLI</h1>

<p align="center">Convert PDFs into Markdown or plain text with the OpenAI Agents SDK.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@robin7331/papyrus-cli"><img src="https://img.shields.io/npm/v/%40robin7331%2Fpapyrus-cli?logo=npm&label=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@robin7331/papyrus-cli"><img src="https://img.shields.io/npm/dm/%40robin7331%2Fpapyrus-cli?logo=npm&label=downloads" alt="npm downloads"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white" alt="node >= 22">
</p>

## Installation

Install globally:

```bash
npm i -g @robin7331/papyrus-cli
papyrus --help
```

## Usage

```bash
# Show installed CLI version
papyrus --version

# Single file (auto mode; if no API key is found, Papyrus prompts you to paste one)
papyrus ./path/to/input.pdf

# Single file with explicit format/output/model
papyrus ./path/to/input.pdf --format md --output ./out/result.md --model gpt-4o-mini

# Auto mode with extra instructions
papyrus ./path/to/input.pdf --instructions "Prioritize table accuracy." --format txt

# Prompt mode (inline prompt)
papyrus ./path/to/input.pdf --mode prompt --prompt "Extract all invoice line items as bullet points." --format md

# Prompt mode (prompt file)
papyrus ./path/to/input.pdf --mode prompt --prompt-file ./my-prompt.txt --format txt

# Folder mode (recursive scan, asks for confirmation)
papyrus ./path/to/folder

# Folder mode with explicit concurrency and output directory
papyrus ./path/to/folder --concurrency 4 --output ./out

# Folder mode without confirmation prompt
papyrus ./path/to/folder --yes
```

## API Key Setup

Papyrus requires `OPENAI_API_KEY`.

If no API key is found in your environment or local config, Papyrus will prompt you interactively to paste one, and can save it for future runs.

macOS/Linux (persistent):

```bash
echo 'export OPENAI_API_KEY="your_api_key_here"' >> ~/.zshrc
source ~/.zshrc
```

PowerShell (persistent):

```powershell
setx OPENAI_API_KEY "your_api_key_here"
# restart PowerShell after running setx
```

One-off execution:

```bash
OPENAI_API_KEY="your_api_key_here" papyrus ./path/to/input.pdf
```

Papyrus config commands (optional, local persistent storage in `~/.config/papyrus/config.json`):

```bash
papyrus config init
papyrus config show
papyrus config clear
```

## Arguments Reference

### `<input>`

Path to a single PDF file or a folder containing PDFs (processed recursively).

Example:

```bash
papyrus ./docs/invoice.pdf
```

### `-v, --version`

Print the installed Papyrus CLI version.

Example:

```bash
papyrus --version
```

### `--format <format>`

Output format override:
- `md` for GitHub-flavored Markdown
- `txt` for plain text

Example:

```bash
papyrus ./docs/invoice.pdf --format md
```

### `-o, --output <path>`

Output destination.
- Single file input: output file path.
- Folder input: output directory path (folder structure is mirrored).

Example:

```bash
papyrus ./docs --output ./converted
```

### `--mode <mode>`

Conversion mode:
- `auto` (default): built-in conversion behavior.
- `prompt`: use your own prompt via `--prompt` or `--prompt-file`.

Example:

```bash
papyrus ./docs/invoice.pdf --mode prompt --prompt "Extract all line items."
```

### `--instructions <text>`

Additional conversion instructions in `auto` mode only.

Example:

```bash
papyrus ./docs/invoice.pdf --mode auto --instructions "Keep table columns aligned."
```

### `--prompt <text>`

Inline prompt text for `prompt` mode. Must be non-empty. In `prompt` mode, use exactly one of `--prompt` or `--prompt-file`.

Example:

```bash
papyrus ./docs/invoice.pdf --mode prompt --prompt "Summarize payment terms."
```

### `--prompt-file <path>`

Path to a text file containing the prompt for `prompt` mode. File must contain non-empty text. In `prompt` mode, use exactly one of `--prompt` or `--prompt-file`.

Example:

```bash
papyrus ./docs/invoice.pdf --mode prompt --prompt-file ./my-prompt.txt
```

### `-m, --model <model>`

OpenAI model name used for conversion. Default is `gpt-4o-mini`.

Example:

```bash
papyrus ./docs/invoice.pdf --model gpt-4.1-mini
```

### `--concurrency <n>`

Maximum parallel workers for folder input. Must be an integer between `1` and `100`. Default is `10`.

Example:

```bash
papyrus ./docs --concurrency 4
```

### `-y, --yes`

Skips the interactive folder confirmation prompt.

Example:

```bash
papyrus ./docs --yes
```

## Notes

- In `auto` mode without `--format`, the model returns structured JSON with `format` + `content`.
- Single-file input now also shows a live worker lane (spinner in TTY) while conversion is running.
- Folder input is scanned recursively for `.pdf` files and processed in parallel.
- In folder mode, `--output` must be a directory path and mirrored subfolders are preserved.
- OpenAI rate-limit (`429`) responses are retried automatically using `Retry-After` (when present) plus exponential backoff.
- Rate-limit retry tuning is available via environment variables:
  - `PAPYRUS_RATE_LIMIT_MAX_RETRIES` (default `8`)
  - `PAPYRUS_RATE_LIMIT_BASE_DELAY_MS` (default `2000`)
  - `PAPYRUS_RATE_LIMIT_MAX_DELAY_MS` (default `120000`)
- For scanned PDFs, output quality depends on OCR quality from the model.

## Development

```bash
npm install
npm run build
npm run dev -- ./path/to/input.pdf
npm test
```

## License

MIT
