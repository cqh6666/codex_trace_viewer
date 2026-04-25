#!/bin/bash

# Codex Trace Viewer - Quick Start Script
# This script helps you quickly start the application with various options

set -e

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
            MODE="$2"
            shift 2
            ;;
        -p|--port)
            PORT="$2"
            shift 2
            ;;
        -h|--home)
            CODEX_HOME="$2"
            shift 2
            ;;
        -s|--sessions)
            SESSIONS_PATH="$2"
            shift 2
            ;;
        -a|--archived)
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
    echo -e "${RED}Error: Mode must be 'dev' or 'prod'${NC}"
    exit 1
fi

# Print banner
print_banner

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 node_modules not found. Installing dependencies...${NC}"
    npm install
    echo -e "${GREEN}✓ Dependencies installed${NC}"
    echo ""
fi

# Build environment variables
ENV_VARS="PORT=$PORT"

if [ -n "$CODEX_HOME" ]; then
    ENV_VARS="$ENV_VARS CODEX_HOME=$CODEX_HOME"
fi

if [ -n "$SESSIONS_PATH" ]; then
    ENV_VARS="$ENV_VARS CODEX_SESSIONS_PATH=$SESSIONS_PATH"
fi

if [ -n "$ARCHIVED_PATH" ]; then
    ENV_VARS="$ENV_VARS CODEX_ARCHIVED_PATH=$ARCHIVED_PATH"
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
    eval "$ENV_VARS npm run dev"
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
    eval "$ENV_VARS npm start"
fi
