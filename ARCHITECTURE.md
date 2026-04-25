# Codex Trace Viewer - Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Browser                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              React Frontend (Port 3000)                    │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐  │  │
│  │  │  Session    │  │   Event      │  │     Event       │  │  │
│  │  │  List       │  │   Timeline   │  │   Inspector     │  │  │
│  │  │  Sidebar    │  │   (Filtered) │  │   (Details)     │  │  │
│  │  └─────────────┘  └──────────────┘  └─────────────────┘  │  │
│  │         │                 │                    │           │  │
│  │         └─────────────────┴────────────────────┘           │  │
│  │                           │                                │  │
│  │                    API Requests                            │  │
│  └───────────────────────────┼────────────────────────────────┘  │
└────────────────────────────────┼───────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Express Backend Server                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                      API Layer                             │  │
│  │  ┌──────────────────┐      ┌──────────────────────────┐   │  │
│  │  │  Legacy APIs     │      │  Enhanced Trace APIs     │   │  │
│  │  │  /api/sessions   │      │  /api/conversations      │   │  │
│  │  │  /api/sessions/:id│     │  /api/tool-analytics    │   │  │
│  │  └──────────────────┘      └──────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                           │                                      │
│                           ▼                                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                  Data Processing Layer                     │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  │  │
│  │  │   JSONL      │  │    Event     │  │     Tool       │  │  │
│  │  │   Parser     │  │  Categorizer │  │   Analytics    │  │  │
│  │  └──────────────┘  └──────────────┘  └────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                           │                                      │
│                           ▼                                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   File System Access                       │  │
│  │         Read .jsonl files from configured paths            │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────────────┼────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Local File System                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  ~/.codex/sessions/          (Active Sessions)            │  │
│  │  └── rollout-2025-04-25T10-30-00.jsonl                    │  │
│  │  └── rollout-2025-04-25T11-15-30.jsonl                    │  │
│  │                                                             │  │
│  │  ~/.codex/archived_sessions/ (Archived Sessions)          │  │
│  │  └── rollout-2025-04-20T09-00-00.jsonl                    │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Session Loading Flow

```
User Opens App
     │
     ▼
Frontend: GET /api/sessions?include_archived=1
     │
     ▼
Backend: Scan configured directories
     │
     ├─→ Read ~/.codex/sessions/*.jsonl
     ├─→ Read ~/.codex/archived_sessions/*.jsonl
     │
     ▼
Backend: Parse each JSONL file
     │
     ├─→ Extract metadata (title, timestamp, model)
     ├─→ Count events (messages, tools, tokens)
     ├─→ Generate preview text
     │
     ▼
Backend: Return session summaries as JSON
     │
     ▼
Frontend: Render session list in sidebar
```

### 2. Event Timeline Flow

```
User Selects a Session
     │
     ▼
Frontend: GET /api/sessions/:id
     │
     ▼
Backend: Load full JSONL file
     │
     ▼
Backend: Parse and categorize events
     │
     ├─→ message      (user/assistant messages)
     ├─→ tool_call    (function/command calls)
     ├─→ tool_result  (execution results)
     ├─→ reasoning    (thinking process)
     ├─→ token        (token usage stats)
     ├─→ context      (context updates)
     ├─→ system       (system events)
     └─→ compaction   (context compression)
     │
     ▼
Backend: Build analytics
     │
     ├─→ Token series (for chart)
     ├─→ Tool statistics
     └─→ Turn counts
     │
     ▼
Backend: Return parsed conversation
     │
     ▼
Frontend: Render event timeline + charts
```

### 3. Event Inspection Flow

```
User Clicks an Event
     │
     ▼
Frontend: GET /api/conversations/:id/events/:index?full=1
     │
     ▼
Backend: Load event from JSONL
     │
     ├─→ Extract full payload
     ├─→ Include raw JSON
     └─→ Format content
     │
     ▼
Backend: Return event detail
     │
     ▼
Frontend: Display in Inspector panel
     │
     ├─→ Structured Information
     ├─→ Formatted Content
     └─→ Raw JSON Payload
```

## Component Architecture

### Frontend Components (React)

```
App.tsx (Main Component)
│
├─→ Header
│   ├─→ Search Input
│   ├─→ Focus Mode Toggle
│   ├─→ Refresh Button
│   └─→ Archived View Toggle
│
├─→ Sidebar (Session List)
│   └─→ Session Cards
│       ├─→ Title
│       ├─→ CWD
│       └─→ Timestamp
│
├─→ Main Content Area
│   │
│   ├─→ Summary Metrics Bar
│   │   ├─→ Model/Thread Info
│   │   ├─→ Context Utilization (with Risk States)
│   │   │   ├─→ Progress Bar
│   │   │   ├─→ Risk Badge (Healthy/Watch/Near Limit)
│   │   │   └─→ Actionable Guidance
│   │   ├─→ Event Metrics
│   │   └─→ Origin Info
│   │
│   ├─→ Charts Section
│   │   ├─→ TokenArcChart Component
│   │   │   ├─→ Interactive Area Chart
│   │   │   ├─→ Clickable Token Snapshots
│   │   │   ├─→ Compaction Markers
│   │   │   └─→ Enhanced Hover Tooltips
│   │   └─→ Tool Usage Stats
│   │
│   └─→ Event Explorer
│       │
│       ├─→ Timeline Panel
│       │   ├─→ Filter Buttons
│       │   ├─→ Event Cards (Virtualized)
│       │   └─→ Load More Button
│       │
│       └─→ Inspector Panel
│           ├─→ Structured Info
│           ├─→ Formatted Content
│           └─→ Raw JSON
│
└─→ Footer
    ├─→ Version Info
    └─→ Connection Status
```

### Backend Modules (Express + TypeScript)

```
server.ts
│
├─→ Configuration
│   ├─→ Environment Variables
│   ├─→ Path Resolution
│   └─→ Port Settings
│
├─→ Data Processing
│   ├─→ JSONL Parser
│   ├─→ Event Categorizer
│   ├─→ Token Analyzer (with event index mapping)
│   └─→ Tool Analytics
│
├─→ API Routes
│   ├─→ /api/health
│   ├─→ /api/sessions (legacy)
│   ├─→ /api/sessions/:id (legacy)
│   ├─→ /api/bootstrap
│   ├─→ /api/tool-analytics
│   ├─→ /api/conversations
│   └─→ /api/conversations/:id/events
│
└─→ Vite Integration
    └─→ Dev Server Middleware
```

### Frontend Components

```
src/
├─→ App.tsx (Main Component)
├─→ components/
│   └─→ TokenArcChart.tsx (Interactive Token Visualization)
├─→ lib/
│   └─→ utils.ts (Utilities & Helpers)
└─→ types.ts (TypeScript Definitions)
```

## Key Features Implementation

### 1. Virtual Scrolling
- **Problem**: Large sessions with 1000+ events cause performance issues
- **Solution**: Render only visible events using virtual window
- **Implementation**: `useVirtualWindow` hook calculates visible range

### 2. Focus Mode
- **Purpose**: Distraction-free analysis
- **Changes**: 
  - Hides sidebar
  - Expands timeline to full width
  - Shows immersive event previews
  - Reduces chart complexity

### 3. Token Analytics with Event Navigation
- **Data Source**: `token_count` events in JSONL
- **Processing**: Build time-series array with event index mapping
- **Visualization**: Interactive Recharts ComposedChart with:
  - Area chart showing token usage over time
  - Scatter plot for compaction events
  - Clickable data points that navigate to specific events
  - Enhanced tooltips with detailed token breakdown
  - Visual indicators for selected snapshots
- **Interaction**: Click any point on the chart to jump to that event in the timeline

### 4. Context Utilization Risk States
- **Purpose**: Proactive monitoring of context window usage
- **Risk Levels**:
  - **Healthy** (<60%): Plenty of headroom for follow-up turns
  - **Watch** (60-85%): Latency and long-context tradeoffs start to matter
  - **Near Limit** (≥85%): Trim or compact before larger tool/output turns
- **Visual Indicators**:
  - Color-coded progress bar (emerald/amber/rose)
  - Badge with risk level label
  - Contextual helper text with actionable guidance
- **Calculation**: Peak tokens / model context window size

### 5. Tool Usage Analytics
- **Scope**: Session-level and Global
- **Metrics**:
  - Total tool calls
  - Top tools by frequency
  - Command roots (bash, git, npm, etc.)
  - Skill invocations
  - MCP tool usage

### 6. Event Categorization
```
Raw JSONL Event
     │
     ▼
Analyze event.type and event.subtype
     │
     ├─→ message_start/message_delta → category: message
     ├─→ function_call/tool_call → category: tool_call
     ├─→ tool_result → category: tool_result
     ├─→ reasoning_* → category: reasoning
     ├─→ token_count → category: token
     ├─→ context_* → category: context
     ├─→ compaction → category: compaction
     └─→ other → category: system
```

## Configuration Options

### Environment Variables
```
CODEX_HOME              → Base directory (default: ~/.codex)
CODEX_SESSIONS_PATH     → Active sessions directory
CODEX_ARCHIVED_PATH     → Archived sessions directory
PORT                    → Server port (default: 3000)
```

### Runtime Behavior
- **Auto-refresh**: Manual via refresh button
- **Search**: Debounced with 220ms delay
- **Pagination**: Load 120 sessions initially, +120 on demand
- **Event Limit**: Show last 240 events (120 in focus mode)

## Technology Choices

### Why React 19?
- Latest features (useDeferredValue, startTransition)
- Better concurrent rendering
- Improved performance for large lists

### Why Vite?
- Fast HMR (Hot Module Replacement)
- Native ESM support
- Optimized production builds
- Built-in TypeScript support

### Why Express?
- Simple and flexible
- Easy Vite integration
- Minimal overhead
- Wide ecosystem

### Why Recharts?
- React-native charts
- Responsive design
- Customizable styling
- Good performance

## Performance Optimizations

1. **Virtual Scrolling**: Only render visible events
2. **Deferred Search**: Debounce search input
3. **Transition API**: Non-blocking UI updates
4. **Content Visibility**: CSS `content-visibility: auto`
5. **Memoization**: `useMemo` for expensive computations
6. **Lazy Loading**: Load sessions in batches

## Future Enhancements

- [ ] Real-time session monitoring (WebSocket)
- [ ] Export sessions to various formats
- [ ] Advanced filtering (date range, model, etc.)
- [ ] Session comparison view
- [ ] Performance profiling dashboard
- [ ] Custom theme support
- [ ] Keyboard shortcuts
- [ ] Session bookmarking
