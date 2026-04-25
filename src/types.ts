export interface TraceEvent {
  id: string;
  index?: number;
  timestamp: string;
  category: 'message' | 'tool_call' | 'tool_result' | 'reasoning' | 'token' | 'context' | 'compaction' | 'system' | 'web_search_call' | 'session_meta';
  type: string;
  top_type?: string;
  subtype?: string;
  payload: any;
  raw?: any;
  summary?: string;
  preview?: string;
  call_id?: string;
  tool_name?: string;
  turn_id?: string;
  turn_index?: number;
}

export interface TokenSnapshot {
  eventIndex?: number;
  timestamp: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  isCompaction?: boolean;
}

export interface CompactionImpact {
  compaction_event_index: number;
  before_event_index: number | null;
  after_event_index: number | null;
  before_total_tokens: number | null;
  after_total_tokens: number | null;
  delta_tokens: number | null;
  before_fill_percent: number | null;
  after_fill_percent: number | null;
}

export interface ToolStat {
  name: string;
  count: number;
  type: 'command' | 'skill' | 'mcp' | 'unknown';
}

export interface NamedCount {
  name: string;
  count: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  threadId: string;
  model: string;
  cwd: string;
  isArchived: boolean;
  metrics: {
    events: number;
    turns: number;
    tools: number;
    peakTokens: number;
  };
  preview: string;
  origin: 'user' | 'automation' | 'subagent' | 'unknown';
}

export interface ParsedConversation {
  summary: ConversationSummary;
  events: TraceEvent[];
  tokenSeries: TokenSnapshot[];
  toolStats: ToolStat[];
  turns: any[];
  stats?: any;
  compactionImpacts?: CompactionImpact[];
  toolAnalytics?: any;
}

export interface ToolAnalytics {
  threads_analyzed: number;
  tool_calls_total: number;
  top_tools: NamedCount[];
  top_command_roots: NamedCount[];
  top_skills: NamedCount[];
  top_mcp_tools: NamedCount[];
}

export interface EventDetail {
  event_index: number;
  event_meta: TraceEvent;
  raw: any;
  raw_truncated: boolean;
  full: boolean;
}
