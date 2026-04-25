# Codex Trace Viewer

A professional web-based tool for analyzing Codex rollout traces. The app scans Codex JSONL session files, builds conversation summaries, parses event timelines, and provides comprehensive token/tool/turn analytics through an intuitive React UI.

[中文文档](./README_zh.md) | [Architecture Documentation](./ARCHITECTURE.md)

## Screenshot

![Codex Trace Viewer Interface](./assets/example.png)

The interface features a three-panel layout with session list, event timeline, and detailed event inspector.

## Features

- **Session Management**: Browse and search through active and archived Codex sessions
- **Event Timeline**: Visualize conversation events with filtering by category (messages, tool calls, reasoning, tokens, etc.)
- **Token Analytics**: Interactive token usage charts with clickable navigation to specific events and enhanced hover details
- **Context Utilization Monitoring**: Real-time risk indicators (Healthy/Watch/Near Limit) with visual progress bars and actionable guidance
- **Tool Usage Analytics**: Analyze tool call patterns with session-level and global statistics
- **Focus Mode**: Distraction-free view for deep trace analysis
- **Event Inspector**: Detailed payload inspection with formatted content and raw JSON views
- **Real-time Updates**: Refresh sessions and analytics on demand

## Prerequisites

- Node.js (v18 or higher recommended)

## Installation

```bash
npm ci
```

## Usage

### Quick Start (Recommended)

Use the provided `run.sh` script for easy startup:

```bash
# Make the script executable (first time only)
chmod +x run.sh

# Start in development mode (default)
./run.sh

# Start in production mode
./run.sh -m prod

# Use custom port
./run.sh -p 8080

# Use custom Codex home directory
./run.sh -h /path/to/.codex

# Use custom session paths
./run.sh -s ./data/sessions -a ./data/archived

# Combine options
./run.sh -m prod -p 8080 -h /custom/codex/path

# Show help
./run.sh --help
```

The script will:
- Automatically install dependencies if needed
- Build the project in production mode if required
- Start the server with your specified configuration
- Display a nice banner with configuration details

### Manual Start

#### Development Mode

```bash
npm run dev

# Development mode with custom options
npm run dev -- --port 8080 --codex-home /path/to/.codex
```

The server starts on `http://localhost:3000`.

#### Production Mode

```bash
npm run build
npm start

# Production mode with custom options
npm start -- --port 8080 --sessions ./data/sessions --archived ./data/archived_sessions
```

### Configuration

By default, the backend reads from `~/.codex/sessions` and `~/.codex/archived_sessions`.

You can configure the trace source and port in three ways:

- Recommended: use `run.sh` flags such as `-p`, `-h`, `-s`, and `-a`
- Use direct server flags with `npm run dev -- --...` or `npm start -- --...`
- Use environment variables or a `.env` file

When both CLI flags and environment variables are provided, CLI flags take precedence.

Examples with direct server flags:

```bash
# Set custom Codex home directory
npm run dev -- --codex-home /path/to/.codex

# Or set explicit session directories
npm start -- --sessions ./data/sessions --archived ./data/archived_sessions

# Custom port
npm run dev -- --port 8080
```

Environment variables are still supported:

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
│   ├── components/
│   │   └── TokenArcChart.tsx  # Interactive token chart component
│   └── lib/
│       └── utils.ts      # Utility functions
├── server.ts             # Express backend server
├── start-server.cjs      # Node wrapper that loads the TypeScript server
├── run.sh                # Quick start script
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
npm ci

# Run the full application in development mode
npm run dev

# Type checking
npm run lint

# Build frontend assets for production
npm run build

# Run the full application in production mode
npm start

# Preview frontend assets only (does not expose backend APIs)
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
./run.sh -p 8080

# or
npm run dev -- --port 8080
```

### Sessions not updating

Click the refresh button in the header or restart the dev server to reload session data.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

For major changes, please open an issue first to discuss what you would like to change.
