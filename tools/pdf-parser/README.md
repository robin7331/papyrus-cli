# pdf-parser

TypeScript CLI PoC that converts PDFs into Markdown or text using the OpenAI Agents SDK.

## Requirements

- Node.js 22+
- `OPENAI_API_KEY` environment variable

## Setup

```bash
npm install
```

```bash
export OPENAI_API_KEY="your_api_key_here"
```

Or place it in a local `.env` file:

```bash
OPENAI_API_KEY=your_api_key_here
```

## Build

```bash
npm run build
```

## Usage

```bash
npm run dev -- ./path/to/input.pdf
```

This runs in `auto` mode by default and lets the model choose between Markdown (`.md`) and plain text (`.txt`).

Auto mode with output format override:

```bash
npm run dev -- ./path/to/input.pdf --format md --output ./out/result.md --model gpt-5
```

Auto mode with additional instructions:

```bash
npm run dev -- ./path/to/input.pdf --instructions "Prioritize table accuracy." --format txt
```

Prompt mode with inline prompt:

```bash
npm run dev -- ./path/to/input.pdf --mode prompt --prompt "Extract all invoice line items as bullet points." --format md
```

Prompt mode with prompt file:

```bash
npm run dev -- ./path/to/input.pdf --mode prompt --prompt-file ./my-prompt.txt
```

After build:

```bash
papyrus-cli ./path/to/input.pdf --mode auto
```

Or directly:

```bash
node dist/cli.js ./path/to/input.pdf
```

## Notes

- The PoC uploads the PDF via OpenAI Files API and runs an `Agent + run()` flow from `@openai/agents`.
- In `auto` mode without `--format`, the model returns structured JSON with `format` + `content`.
- For scanned PDFs, output quality depends on OCR quality done by the model.
