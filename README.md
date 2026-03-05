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

Run directly with `npx`:

```bash
npx @robin7331/papyrus-cli --help
```

Or install globally:

```bash
npm i -g @robin7331/papyrus-cli
papyrus --help
```

## API Key Setup

Papyrus requires `OPENAI_API_KEY`.

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
OPENAI_API_KEY="your_api_key_here" npx @robin7331/papyrus-cli ./path/to/input.pdf
```

Security note: Papyrus intentionally does not provide an `--api-key` flag to avoid leaking keys via shell history or process lists.

## Usage

Single file (auto mode):

```bash
papyrus ./path/to/input.pdf
```

Single file with explicit format/output/model:

```bash
papyrus ./path/to/input.pdf --format md --output ./out/result.md --model gpt-4o-mini
```

Auto mode with extra instructions:

```bash
papyrus ./path/to/input.pdf --instructions "Prioritize table accuracy." --format txt
```

Prompt mode (inline prompt):

```bash
papyrus ./path/to/input.pdf --mode prompt --prompt "Extract all invoice line items as bullet points." --format md
```

Prompt mode (prompt file):

```bash
papyrus ./path/to/input.pdf --mode prompt --prompt-file ./my-prompt.txt --format txt
```

Folder mode (recursive scan, asks for confirmation):

```bash
papyrus ./path/to/folder
```

Folder mode with explicit concurrency and output directory:

```bash
papyrus ./path/to/folder --concurrency 4 --output ./out
```

Folder mode without confirmation prompt:

```bash
papyrus ./path/to/folder --yes
```

`npx` alternative for any command:

```bash
npx @robin7331/papyrus-cli ./path/to/input.pdf --mode auto
```

## Notes

- In `auto` mode without `--format`, the model returns structured JSON with `format` + `content`.
- Folder input is scanned recursively for `.pdf` files and processed in parallel.
- In folder mode, `--output` must be a directory path and mirrored subfolders are preserved.
- For scanned PDFs, output quality depends on OCR quality from the model.

## Development

```bash
npm install
npm run build
npm run dev -- ./path/to/input.pdf
npm test
```
