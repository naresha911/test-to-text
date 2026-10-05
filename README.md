# Exam OCR (PaperParse)

Turn photographed exam and practice-test pages into structured questions (MCQ, comprehension, assertion, fill-in-the-blank, true/false, and similar). Maths is kept as text you can render. Diagram regions are detected when a page is read in Graphics mode. Results stay in a local SQLite library under `data/` and can be exported as JSON.

**Live app:** https://test-to-text.lovable.app

This project is connected to [Lovable](https://lovable.dev/projects/cf6936c6-58e8-4467-b7c2-3b80139b1d97). Pushes to the connected branch sync back into the Lovable editor.

## What a fresh machine needs

| Piece | Required for | Notes |
| --- | --- | --- |
| Git | Cloning the repo | |
| Node.js 22+ and npm | The web app | [nodejs.org](https://nodejs.org/) |
| Python 3.11+ | Local OCR service | The `python` command must be on `PATH` |
| Tesseract OCR | Fallback text when cloud OCR keys are missing | Binary named `tesseract` on `PATH` |
| `.env.local` | AI and OCR API keys | Gitignored. Recreate it by hand |
| OmniRoute (optional) | Preferred model gateway for hints, solutions, and structuring | Global CLI `omniroute` |
| Bun (optional) | `npm test` | [bun.sh](https://bun.sh) |

`.env` is committed. It holds the public Supabase URL and publishable key for this project. Do not put secret keys in `.env`.

Papers, page images, and the SQLite file live in `data/` (`data/paperparse.sqlite`). That folder is gitignored. Copy `data/` aside if you need to keep the library when you rebuild the machine.

## 1. Clone and install the web app

```sh
git clone https://github.com/naresha911/test-to-text.git
cd test-to-text
npm install
```

## 2. Python OCR service

The default reader (OpenOCR) talks to a local FastAPI process on `http://127.0.0.1:8099`. `npm run ocr` starts it with whatever `python` is on `PATH`, so install the packages into that interpreter.

Windows (PowerShell):

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r scripts/requirements-ocr.txt
python --version
```

macOS / Linux:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r scripts/requirements-ocr.txt
python --version
```

Keep that virtualenv activated in the terminal that runs `npm run dev:all` or `npm run ocr`. `.venv` is local and is not committed.

Graphics mode downloads the PP-DocLayout model on the first layout request into:

- Windows: `%USERPROFILE%\.cache\paperparse\PP-DocLayoutV2.onnx`
- macOS / Linux: `~/.cache/paperparse/PP-DocLayoutV2.onnx`

That download needs network access once. Later runs use the cached file.

Check the service by itself:

```sh
npm run ocr
```

In another terminal:

```sh
curl http://127.0.0.1:8099/health
```

A healthy process returns `"ok": true`.

## 3. Tesseract

Install Tesseract so `tesseract` is on `PATH`. The local service uses it when OCR.space and Optiic are not available. Printed-text reading still prefers OCR.space, then Optiic, then this local Tesseract output.

Windows:

```powershell
winget install UB-Mannheim.TesseractOCR
```

The installer usually places the binary at `C:\Program Files\Tesseract-OCR\tesseract.exe`. Add that folder to your user `PATH`, open a new terminal, and confirm:

```powershell
tesseract --version
```

macOS: `brew install tesseract`

Debian / Ubuntu: `sudo apt install tesseract-ocr`

## 4. API keys (`.env.local`)

Create `.env.local` in the project root. Restart the dev server after any edit. These names match what the server reads. Leave a line commented, or omit it, when you do not have that key.

```sh
# Preferred gateway for structuring text, hints, solutions, and mock papers.
# Dashboard: http://127.0.0.1:20128  — copy a key from its API Keys page.
OMNIROUTERS_BASE_URL=http://127.0.0.1:20128/v1
OMNIROUTERS_API_KEY=
OMNIROUTERS_MODEL=auto

# Command Code Provider API. Preferred for every AI generation when set.
# Needs a GOAT/Pro/Max plan (the Go plan has no API access). Create the key at
# https://commandcode.ai/settings/keys — the same key authenticates the CLI.
# Text questions ride the free routes; diagram questions use a vision model.
COMMANDCODE_API_KEY=
# Optional overrides.
# COMMANDCODE_BASE_URL=https://api.commandcode.ai/provider/v1

# https://openrouter.ai/keys — also used when OmniRoute is not configured.
OPENROUTER_API_KEY=

# https://ocr.space/ocrapi — free key. OpenOCR tries this first for printed words.
OCR_SPACE_API_KEY=

# https://optiic.dev — OpenOCR tries this after OCR.space.
OPTIIC_API_KEY=

# Optional. Injected automatically on Lovable Cloud. Needed only for the built-in AI reader.
# LOVABLE_API_KEY=

# Optional. Only for pushing a paper into the separate exam-prep Supabase project.
# EXAM_PREP_SUPABASE_URL=
# EXAM_PREP_SUPABASE_SERVICE_ROLE_KEY=
```

The same OCR.space, Optiic, and OpenRouter keys can be saved in the app at [http://127.0.0.1:8080/settings](http://127.0.0.1:8080/settings). Keys typed there stay in browser local storage. Keys in `.env.local` stay on the server. OpenOCR uses a saved OCR.space key and a saved Optiic key as cloud fallbacks.

For the default OpenOCR reader, configure at least one of:

- `OCR_SPACE_API_KEY` or an OCR.space key in Settings
- `OPTIIC_API_KEY` or an Optiic key in Settings
- Tesseract on `PATH` (local text only)

Structuring a page into questions, plus hints, solutions, and mock papers, needs one model key: `COMMANDCODE_API_KEY`, `OMNIROUTERS_API_KEY`, `OPENROUTER_API_KEY`, or `LOVABLE_API_KEY`. When `COMMANDCODE_API_KEY` is set it is preferred: text questions use its free models and diagram questions use its vision model, with the other keys as fallback.

`OPENOCR_URL` overrides the local service address. The default is `http://127.0.0.1:8099`.

## 5. OmniRoute (optional)

OmniRoute is the preferred model gateway. `npm run dev:all` starts it when the `omniroute` command exists. If it is missing, the web app and OCR service still start.

```sh
npm install -g omniroute
```

Dashboard: [http://127.0.0.1:20128](http://127.0.0.1:20128)

API base used by this app: `http://127.0.0.1:20128/v1`

Create an API key in that dashboard and paste it into `OMNIROUTERS_API_KEY`. `OMNIROUTERS_MODEL=auto` lets OmniRoute pick a provider.

## 6. Run the app

With the Python virtualenv activated:

```sh
npm run dev:all
```

That starts three processes:

- web — Vite at [http://127.0.0.1:8080](http://127.0.0.1:8080)
- ocr — `python scripts/ocr_service.py` on port 8099
- omni — `omniroute --no-open` when the CLI is installed

Open the app at `http://127.0.0.1:8080`. Google sign-in is allowlisted for `127.0.0.1`, and the app redirects `localhost` to that host. The Vite config proxies `/~oauth` to the published Lovable app so local Google sign-in can complete.

To run the pieces yourself, use two terminals (virtualenv active in the OCR one):

```sh
npm run dev
npm run ocr
```

## 7. Confirm a restored setup

1. `curl http://127.0.0.1:8099/health` returns `"ok": true`.
2. [http://127.0.0.1:8080/settings](http://127.0.0.1:8080/settings) shows OpenOCR as reachable, and shows the keys you put in `.env.local`.
3. Upload one page on the home screen with the OpenOCR reader. Text mode reads words. Graphics mode also calls `POST /layout` and, on first use, downloads the layout model.
4. Sign in with Google from `http://127.0.0.1:8080` if you need the signed-in flow.

## Other commands

```sh
npm run dev       # web app only
npm run ocr       # local OCR service only
npm run build     # production build
npm run preview   # serve the production build
npm run lint
npm test          # requires Bun
```

`npm test` runs `bun test`. Install Bun only when you want the unit tests. The app itself runs on Node.

## If the local setup is gone

1. Install Node, Python, and Tesseract, and confirm `node`, `npm`, `python`, and `tesseract` work in a new terminal.
2. Clone the repo again. `npm install`.
3. Recreate the virtualenv and `pip install -r scripts/requirements-ocr.txt`.
4. Recreate `.env.local` from the template above. The public Supabase values come back with `.env`.
5. Reinstall OmniRoute and create a new local API key if you use that gateway.
6. `npm run dev:all`, then open `http://127.0.0.1:8080`.
7. Restore `data/` from your backup if you need the previous papers. A new `data/` folder is created on first save.
