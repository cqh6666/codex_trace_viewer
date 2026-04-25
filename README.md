# Codex Trace Viewer

Local web viewer for Codex rollout traces. The app scans Codex JSONL session files, builds conversation summaries, parses event timelines, and exposes token/tool/turn analytics for the React UI.

## Run Locally

Prerequisite: Node.js.

```bash
npm install
npm run dev
```

The server starts on `http://localhost:3000`.

By default the backend reads `~/.codex/sessions` and `~/.codex/archived_sessions`. To point it at another trace source, set either `CODEX_HOME` or the explicit directory variables:

```bash
CODEX_HOME=/path/to/.codex npm run dev
CODEX_SESSIONS_PATH=./data/sessions CODEX_ARCHIVED_PATH=./data/archived_sessions npm run dev
```

## API Shape

The React UI still uses the legacy-compatible endpoints:

- `GET /api/sessions`
- `GET /api/sessions/:id`

The migrated backend also exposes richer trace APIs:

- `GET /api/health`
- `GET /api/bootstrap?include_archived=1`
- `GET /api/tool-analytics?limit=12`
- `GET /api/conversations?q=keyword`
- `GET /api/conversations/:id/events`
- `GET /api/conversations/:id/events/:eventIndex?full=1`
