# Mini Drive · Desbravando UTV

[Português](README.pt-BR.md) · English

File archive for Desbravando UTV, an off-road UTV expedition operator. Design briefs, artwork
and documents live in one Cloudflare R2 bucket, browsable by folder, behind a shared key.
One Worker serves both the web interface and the API.

## Status

In production since July 2026 at `minidrive.desbravando-utv.workers.dev`. Low maintenance.

## The problem it solves

The briefing tool generates a ZIP package for every expedition. Those packages, and the
finished artwork, used to sit in the downloads folder of whoever made them. The Mini Drive
keeps them in one place, organized by expedition, and downloadable from any device.

## Stack

- Cloudflare Worker (`worker.js`), plain JavaScript, no build step
- Cloudflare R2 for storage (binding `BUCKET`, bucket `minidrive`)
- The interface is an HTML string inside `worker.js`

## How it works

- Object keys are the folder structure: `YEAR/TYPE/PROJECT/[subfolders/][date-time_]file`.
  `/list` reads the bucket, there is no database.
- `&direto=1` saves without the date prefix, so uploading a fixed file again replaces it.
- `&sub=a/b` keeps the structure of an uploaded folder (up to 6 levels, each segment sanitized).
- The briefing tool sends its ZIP here as a side effect. If the drive is down, the local
  download still happens.

Routes: `GET /` (interface), `POST /upload?tipo&projeto&arquivo[&sub][&direto=1]`,
`GET /list`, `GET /file/<key>`, `DELETE /file/<key>`.

## Run locally

Requires Node 20 or newer.

```bash
npm install
echo DRIVE_KEY=any-local-key > .dev.vars
npx wrangler dev
```

## Tests

```bash
npm test
```

Starts `wrangler dev` with a temporary local R2 and checks: the page opens, the key is
required, and upload, list, download and delete work end to end.

## Folder structure

| Path | What it is |
|---|---|
| `worker.js` | API and interface |
| `wrangler.toml` | Worker and R2 binding |
| `tests/` | Automated tests |
| `docs/arquitetura/` | Diagrams |

## Architecture

Diagrams in [docs/arquitetura/](docs/arquitetura/).

## Decisions and known limits

- One shared key (`DRIVE_KEY`, a Wrangler secret). No per-person accounts.
- The current version also accepts the key in the `?k=` query string, which leaks into
  browser history and logs. The branch `revisao-2026-11` moves it to the header only and
  restricts CORS to the known origins.
- Workers free plan limits a single upload to 100 MB.
- A "download folder as .zip" feature was described in July 2026 but never committed or
  deployed. See [docs/HISTORICO.md](docs/HISTORICO.md).

## License

All rights reserved. Published as portfolio; not licensed for reuse. See [LICENSE](LICENSE).
