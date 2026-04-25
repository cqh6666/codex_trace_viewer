# Codex Trace Viewer

A professional web-based tool for analyzing Codex rollout traces. The app scans Codex JSONL session files, builds conversation summaries, parses event timelines, and provides comprehensive token/tool/turn analytics through an intuitive React UI.

[中文文档](./README_zh.md)

## Screenshot

![Codex Trace Viewer Interface](./assets/example.png)

The interface features a three-panel layout with session list, event timeline, and detailed event inspector.

## Features

- **Session Management**: Browse and search through active and archived Codex sessions
- **Event Timeline**: Visualize conversation events with filtering by category (messages, tool calls, reasoning, tokens, etc.)
- **Token Analytics**: Track token usage over time with interactive charts showing context utilization
- **Tool Usage Analytics**: Analyze tool call patterns with session-level and global statistics
- **Focus Mode**: Distraction-free view for deep trace analysis
- **Event Inspector**: Detailed payload inspection with formatted content and raw JSON views
- **Real-time Updates**: Refresh sessions and analytics on demand

## Prerequisites

- Node.js (v16 or higher recommended)

## Installation

```bash
npm install
```

## Usage

### Development Mode

```bash
npm run dev
```

The server starts on `http://localhost:3000`.

### Production Build

```bash
npm run build
npm start
```

### Configuration

By default, the backend reads from `~/.codex/sessions` and `~/.codex/archived_sessions`. 

To point it at a different trace source, use environment variables:

```bash
# Set custom Codex home directory
CODEX_HOME=/path/to/.codex npm run dev

# Or set explicit session directories
CODEX_SESSIONS_PATH=./data/sessions CODEX_ARCHIVED_PATH=./data/archived_sessions npm run dev

# Custom port
PORT=8080 npm run dev
```

Create a `.env` file for persistent configuration (see `.env.example`):

```env
# Codex Trace Viewer Configuration
# Defaults to ~/.codex when no explicit path is set.
# CODEX_HOME="/Users/you/.codex"

# Use these when you want to point at fixture data or a non-standard trace location.
# CODEX_SESSIONS_PATH="./data/sessions"
# CODEX_ARCHIVED_PATH="./data/archived_sessions"

# Optional: Custom port (default: 3000)
# PORT=8080
```

## API Endpoints

### Legacy-Compatible Endpoints

- `GET /api/sessions` - List all sessions with optional search
- `GET /api/sessions/:id` - Get detailed session data with events

### Enhanced Trace APIs

- `GET /api/health` - Health check endpoint
- `GET /api/bootstrap?include_archived=1` - Bootstrap data with optional archived sessions
- `GET /api/tool-analytics?limit=12` - Global tool usage analytics
- `GET /api/conversations?q=keyword` - Search conversations by keyword
- `GET /api/conversations/:id/events` - Get event timeline for a conversation
- `GET /api/conversations/:id/events/:eventIndex?full=1` - Get detailed event data

## Project Structure

```
codex-trace-viewer/
├── src/
│   ├── App.tsx           # Main React application
│   ├── main.tsx          # Application entry point
│   ├── types.ts          # TypeScript type definitions
│   └── lib/
│       └── utils.ts      # Utility functions
├── server.ts             # Express backend server
├── data/                 # Default data directory
├── index.html            # HTML template
├── vite.config.ts        # Vite configuration
└── package.json          # Project dependencies
```

## Technology Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, Motion (animations), Recharts (charts)
- **Backend**: Express.js, Node.js
- **Build Tool**: Vite
- **UI Icons**: Lucide React

## Development

```bash
# Install dependencies
npm install

# Run development server with hot reload
npm run dev

# Type checking
npm run lint

# Build for production
npm run build

# Preview production build
npm run preview

# Clean build artifacts
npm run clean
```

## Troubleshooting

### No sessions found

If the viewer shows no sessions:
- Verify that `~/.codex/sessions` or your custom `CODEX_HOME` path exists
- Check that the directory contains `.jsonl` files
- Ensure the session files are readable (check file permissions)

### Port already in use

If port 3000 is already occupied:
```bash
PORT=8080 npm run dev
```

### Sessions not updating

Click the refresh button in the header or restart the dev server to reload session data.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

For major changes, please open an issue first to discuss what you would like to change.
