#!/usr/bin/env bash

# Codex Trace Viewer - Quick Start Script
# This script helps you quickly start the application with various options

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
MODE="dev"
PORT=3000
CODEX_HOME=""
SESSIONS_PATH=""
ARCHIVED_PATH=""

print_error() {
    echo -e "${RED}Error: $1${NC}" >&2
}

require_option_value() {
    local option="$1"
    local value="${2-}"

    if [[ -z "$value" || "$value" == -* ]]; then
        print_error "Option $option requires a value"
        print_usage
        exit 1
    fi
}

# Print banner
print_banner() {
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════════════════╗"
    echo "║         Codex Trace Viewer - Quick Start             ║"
    echo "╚═══════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Print usage
print_usage() {
    echo "Usage: ./run.sh [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -m, --mode <dev|prod>       Run mode (default: dev)"
    echo "  -p, --port <port>           Server port (default: 3000)"
    echo "  -h, --home <path>           Codex home directory"
    echo "  -s, --sessions <path>       Sessions directory path"
    echo "  -a, --archived <path>       Archived sessions directory path"
    echo "  --help                      Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./run.sh                                    # Start in dev mode on port 3000"
    echo "  ./run.sh -m prod -p 8080                    # Start in prod mode on port 8080"
    echo "  ./run.sh -h /path/to/.codex                 # Use custom Codex home"
    echo "  ./run.sh -s ./data/sessions -a ./data/archived  # Use custom paths"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -m|--mode)
            require_option_value "$1" "${2-}"
            MODE="$2"
            shift 2
            ;;
        -p|--port)
            require_option_value "$1" "${2-}"
            PORT="$2"
            shift 2
            ;;
        -h|--home)
            require_option_value "$1" "${2-}"
            CODEX_HOME="$2"
            shift 2
            ;;
        -s|--sessions)
            require_option_value "$1" "${2-}"
            SESSIONS_PATH="$2"
            shift 2
            ;;
        -a|--archived)
            require_option_value "$1" "${2-}"
            ARCHIVED_PATH="$2"
            shift 2
            ;;
        --help)
            print_banner
            print_usage
            exit 0
            ;;
        *)
            echo -e "${RED}Error: Unknown option $1${NC}"
            print_usage
            exit 1
            ;;
    esac
done

# Validate mode
if [[ "$MODE" != "dev" && "$MODE" != "prod" ]]; then
    print_error "Mode must be 'dev' or 'prod'"
    exit 1
fi

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
    print_error "Port must be an integer between 1 and 65535"
    exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
    print_error "npm is required but was not found in PATH"
    exit 1
fi

if ! command -v node >/dev/null 2>&1; then
    print_error "node is required but was not found in PATH"
    exit 1
fi

# Print banner
print_banner

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 node_modules not found. Installing dependencies...${NC}"
    if [ -f "package-lock.json" ]; then
        npm ci
    else
        npm install
    fi
    echo -e "${GREEN}✓ Dependencies installed${NC}"
    echo ""
fi

# Build server arguments
SERVER_ARGS=(--port "$PORT")

if [ -n "$CODEX_HOME" ]; then
    SERVER_ARGS+=(--codex-home "$CODEX_HOME")
fi

if [ -n "$SESSIONS_PATH" ]; then
    SERVER_ARGS+=(--sessions "$SESSIONS_PATH")
fi

if [ -n "$ARCHIVED_PATH" ]; then
    SERVER_ARGS+=(--archived "$ARCHIVED_PATH")
fi

# Print configuration
echo -e "${BLUE}Configuration:${NC}"
echo -e "  Mode:           ${GREEN}$MODE${NC}"
echo -e "  Port:           ${GREEN}$PORT${NC}"

if [ -n "$CODEX_HOME" ]; then
    echo -e "  Codex Home:     ${GREEN}$CODEX_HOME${NC}"
else
    echo -e "  Codex Home:     ${YELLOW}~/.codex (default)${NC}"
fi

if [ -n "$SESSIONS_PATH" ]; then
    echo -e "  Sessions Path:  ${GREEN}$SESSIONS_PATH${NC}"
fi

if [ -n "$ARCHIVED_PATH" ]; then
    echo -e "  Archived Path:  ${GREEN}$ARCHIVED_PATH${NC}"
fi

echo ""

# Start the application
if [ "$MODE" = "dev" ]; then
    echo -e "${GREEN}🚀 Starting development server...${NC}"
    echo -e "${BLUE}   Access the app at: http://localhost:$PORT${NC}"
    echo ""
    node ./start-server.cjs "${SERVER_ARGS[@]}"
else
    # Production mode
    if [ ! -d "dist" ]; then
        echo -e "${YELLOW}📦 Building for production...${NC}"
        npm run build
        echo -e "${GREEN}✓ Build complete${NC}"
        echo ""
    fi

    echo -e "${GREEN}🚀 Starting production server...${NC}"
    echo -e "${BLUE}   Access the app at: http://localhost:$PORT${NC}"
    echo ""
    node ./start-server.cjs --mode prod "${SERVER_ARGS[@]}"
fi
