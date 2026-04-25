import 'dotenv/config';
import express from 'express';
import {createHash} from 'crypto';
import {createServer as createViteServer} from 'vite';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

type JsonRecord = Record<string, any>;

type LegacyCategory =
  | 'message'
  | 'tool_call'
  | 'tool_result'
  | 'reasoning'
  | 'token'
  | 'context'
  | 'compaction'
  | 'system';

type ToolStatType = 'command' | 'skill' | 'mcp' | 'unknown';
type Origin = 'user' | 'automation' | 'subagent' | 'unknown';

interface TokenSnapshot {
  totalUsage: JsonRecord;
  lastUsage: JsonRecord;
  cumulativeTotalTokens: number;
  contextTokens: number;
  modelContextWindow: number;
  contextFillPercent: number | null;
  lastInputTokens: number;
  lastCachedInputTokens: number;
  lastOutputTokens: number;
  lastReasoningOutputTokens: number;
}

interface ToolAnalyticsCounts {
  toolCallsTotal: number;
  toolNameCounts: Map<string, number>;
  commandRootCounts: Map<string, number>;
  skillCounts: Map<string, number>;
  mcpToolCounts: Map<string, number>;
}

interface ConversationSummaryInternal {
  id: string;
  threadId: string | null;
  path: string;
  archived: boolean;
  title: string;
  preview: string;
  startedAt: string;
  updatedAt: string;
  startedTs: number;
  updatedTs: number;
  cwd: string | null;
  model: string | null;
  modelProvider: string | null;
  cliVersion: string | null;
  source: any;
  originator: string | null;
  totalEvents: number;
  turnCount: number;
  messageCount: number;
  toolCallCount: number;
  toolResultCount: number;
  compactionCount: number;
  tokenSamples: number;
  maxTotalTokens: number;
  typeCounts: Record<string, number>;
  eventTypeCounts: Record<string, number>;
  responseTypeCounts: Record<string, number>;
  toolAnalyticsCounts: ToolAnalyticsCounts;
}

interface ParsedConversationInternal {
  mtimeMs: number;
  rawLines: string[];
  events: JsonRecord[];
  stats: JsonRecord;
  tokenSeries: JsonRecord[];
  compactionImpacts: JsonRecord[];
  turns: JsonRecord[];
  toolAnalyticsCounts: ToolAnalyticsCounts;
}

interface CliOptions {
  archivedPath?: string;
  codexHome?: string;
  mode?: 'dev' | 'prod';
  port?: number;
  sessionsPath?: string;
}

function readCliValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      continue;
    }

    switch (arg) {
      case '--mode': {
        const value = readCliValue(argv, index, arg);
        if (value !== 'dev' && value !== 'prod') {
          throw new Error(`Invalid mode: ${value}`);
        }
        options.mode = value;
        index += 1;
        break;
      }
      case '--port': {
        const value = Number(readCliValue(argv, index, arg));
        if (!Number.isInteger(value) || value < 1 || value > 65535) {
          throw new Error(`Invalid port: ${argv[index + 1]}`);
        }
        options.port = value;
        index += 1;
        break;
      }
      case '--codex-home':
        options.codexHome = readCliValue(argv, index, arg);
        index += 1;
        break;
      case '--sessions':
        options.sessionsPath = readCliValue(argv, index, arg);
        index += 1;
        break;
      case '--archived':
        options.archivedPath = readCliValue(argv, index, arg);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

const CLI_OPTIONS = parseCliOptions(process.argv.slice(2));
const PORT = CLI_OPTIONS.port ?? Number(process.env.PORT || 3000);
const IS_PRODUCTION = CLI_OPTIONS.mode === 'prod' || process.env.NODE_ENV === 'production';
const APP_DATA_ROOT = path.resolve(process.cwd(), 'data');
const TOOL_CALL_RESPONSE_SUBTYPES = new Set([
  'function_call',
  'custom_tool_call',
  'local_shell_call',
  'web_search_call',
]);
const SKILL_PATH_RE = /\/(?:\.codex|\.agents)\/skills\/([^/]+)\/SKILL\.md/g;
const FILENAME_TS_RE = /rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function safeInt(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function parseIsoTs(value: unknown): number {
  if (typeof value !== 'string' || !value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed / 1000;
}

function isoFromEpochMs(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

function normalizeText(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(' ');
}

function truncateText(value: unknown, limit = 180): string {
  if (typeof value !== 'string' || !value) return '';
  const normalized = normalizeText(value);
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
}

function parseFilenameTimestamp(filePath: string): string | null {
  const match = FILENAME_TS_RE.exec(path.basename(filePath));
  if (!match) return null;
  const normalized = `${match[1].replace(
    /T(\d{2})-(\d{2})-(\d{2})$/,
    'T$1:$2:$3',
  )}Z`;
  return Number.isNaN(Date.parse(normalized)) ? null : normalized;
}

function fileIdForPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  if (resolved.startsWith(`${APP_DATA_ROOT}${path.sep}`)) {
    return path.basename(resolved, '.jsonl');
  }
  return createHash('sha256').update(resolved).digest('hex').slice(0, 16);
}

function countMapToRecord(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]));
}

function incrementMap(map: Map<string, number>, name: unknown, delta = 1): void {
  if (typeof name !== 'string' || !name) return;
  map.set(name, (map.get(name) || 0) + delta);
}

function bumpRecord(record: Record<string, number>, name: unknown): void {
  if (typeof name !== 'string' || !name) return;
  record[name] = (record[name] || 0) + 1;
}

function newToolAnalyticsCounts(): ToolAnalyticsCounts {
  return {
    toolCallsTotal: 0,
    toolNameCounts: new Map(),
    commandRootCounts: new Map(),
    skillCounts: new Map(),
    mcpToolCounts: new Map(),
  };
}

function mergeToolAnalyticsCounts(target: ToolAnalyticsCounts, source: ToolAnalyticsCounts): void {
  target.toolCallsTotal += source.toolCallsTotal;
  for (const [name, count] of source.toolNameCounts) incrementMap(target.toolNameCounts, name, count);
  for (const [name, count] of source.commandRootCounts) {
    incrementMap(target.commandRootCounts, name, count);
  }
  for (const [name, count] of source.skillCounts) incrementMap(target.skillCounts, name, count);
  for (const [name, count] of source.mcpToolCounts) incrementMap(target.mcpToolCounts, name, count);
}

function topEntriesFromMap(map: Map<string, number>, limit = 12): JsonRecord[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({name, count}));
}

function serializeToolAnalytics(
  counts: ToolAnalyticsCounts,
  threadsAnalyzed: number,
  limit = 12,
): JsonRecord {
  return {
    threads_analyzed: threadsAnalyzed,
    tool_calls_total: counts.toolCallsTotal,
    top_tools: topEntriesFromMap(counts.toolNameCounts, limit),
    top_command_roots: topEntriesFromMap(counts.commandRootCounts, limit),
    top_skills: topEntriesFromMap(counts.skillCounts, limit),
    top_mcp_tools: topEntriesFromMap(counts.mcpToolCounts, limit),
  };
}

function splitCommand(command: string): string[] {
  const tokens = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return tokens.map((token) => token.replace(/^['"]|['"]$/g, ''));
}

function extractCommandRoot(command: unknown): string | null {
  if (typeof command !== 'string') return null;
  let tokens = splitCommand(command.trim());
  if (tokens.length === 0) return null;

  let first = tokens[0];
  if (['bash', 'zsh', 'sh', 'fish'].includes(first) && tokens.length >= 3 && tokens[1] === '-lc') {
    tokens = splitCommand(tokens.slice(2).join(' '));
    first = tokens[0] || first;
  }

  if (first === 'devbox') {
    const delimiterIndex = tokens.indexOf('--');
    if (delimiterIndex >= 0 && tokens[delimiterIndex + 1]) first = tokens[delimiterIndex + 1];
  }

  if (first === 'cd') {
    const joinIndex = tokens.indexOf('&&');
    if (joinIndex >= 0 && tokens[joinIndex + 1]) first = tokens[joinIndex + 1];
  }

  return first || null;
}

function parseJsonString(value: unknown): unknown {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseToolCallInput(payload: JsonRecord, subtype: string | null): JsonRecord | null {
  const rawArgs = subtype === 'function_call' ? payload.arguments : payload.input;
  if (isRecord(rawArgs)) return rawArgs;
  const parsed = parseJsonString(rawArgs);
  return isRecord(parsed) ? parsed : null;
}

function parseToolCallCommand(payload: JsonRecord, subtype: string | null): string | null {
  const parsedArgs = parseToolCallInput(payload, subtype);
  if (!parsedArgs) return null;
  return asString(parsedArgs.cmd) || asString(parsedArgs.command);
}

function extractSkillMentions(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  const out: string[] = [];
  for (const match of value.matchAll(SKILL_PATH_RE)) {
    if (match[1] && /^[A-Za-z0-9._-]+$/.test(match[1])) out.push(match[1]);
  }
  return out;
}

function updateToolAnalyticsFromResponseItem(
  counts: ToolAnalyticsCounts,
  payload: JsonRecord,
  subtype: string | null,
): void {
  if (!subtype || !TOOL_CALL_RESPONSE_SUBTYPES.has(subtype)) return;

  counts.toolCallsTotal += 1;
  const toolName = asString(payload.name) || subtype;
  incrementMap(counts.toolNameCounts, toolName);
  if (toolName.startsWith('mcp__')) incrementMap(counts.mcpToolCounts, toolName);

  const command = parseToolCallCommand(payload, subtype);
  const commandRoot = extractCommandRoot(command);
  if (commandRoot) incrementMap(counts.commandRootCounts, commandRoot);

  for (const skillName of extractSkillMentions(command)) incrementMap(counts.skillCounts, skillName);
  const rawForSkills = subtype === 'function_call' ? payload.arguments : payload.input;
  for (const skillName of extractSkillMentions(rawForSkills)) {
    incrementMap(counts.skillCounts, skillName);
  }
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const parts: string[] = [];
  for (const item of content) {
    if (!isRecord(item)) continue;
    const itemType = item.type;
    if (
      ['input_text', 'output_text', 'text', 'summary_text', 'reasoning_text'].includes(
        String(itemType),
      ) &&
      typeof item.text === 'string'
    ) {
      parts.push(item.text);
    }
  }
  return parts.join('\n');
}

function extractAnyMessageText(topType: string, payload: JsonRecord): string {
  if (topType === 'message' || topType === 'reasoning') {
    return asString(payload.content) || '';
  }
  if (topType === 'event_msg') {
    return asString(payload.message) || asString(payload.text) || '';
  }
  if (topType === 'response_item') {
    if (payload.type === 'message') return extractTextFromContent(payload.content);
    if (payload.type === 'reasoning' && Array.isArray(payload.summary)) {
      return extractTextFromContent(payload.summary);
    }
  }
  return '';
}

function isProbablyScaffoldingMessage(text: string): boolean {
  const lowered = text.toLowerCase();
  return (
    lowered.includes('# agents.md instructions') ||
    lowered.includes('<environment_context>') ||
    lowered.includes('<collaboration_mode>')
  );
}

function getSubtype(topType: string, payload: JsonRecord): string | null {
  if ((topType === 'event_msg' || topType === 'response_item') && typeof payload.type === 'string') {
    return payload.type;
  }
  if (
    ['message', 'reasoning', 'tool_call', 'tool_result', 'token_count', 'compaction'].includes(
      topType,
    )
  ) {
    return topType;
  }
  return null;
}

function inferEventCategory(topType: string, subtype: string | null): LegacyCategory {
  if (topType === 'message') return 'message';
  if (topType === 'reasoning') return 'reasoning';
  if (topType === 'tool_call') return 'tool_call';
  if (topType === 'tool_result') return 'tool_result';
  if (topType === 'token_count') return 'token';
  if (topType === 'compaction') return 'compaction';

  if (topType === 'session_meta' || topType === 'turn_context') return 'context';
  if (topType === 'compacted') return 'compaction';

  if (topType === 'event_msg') {
    if (subtype === 'token_count') return 'token';
    if (subtype === 'user_message' || subtype === 'agent_message') return 'message';
    if (subtype?.startsWith('agent_reasoning')) return 'reasoning';
    if (
      subtype === 'exec_command_begin' ||
      subtype === 'mcp_tool_call_begin' ||
      subtype === 'web_search_begin'
    ) {
      return 'tool_call';
    }
    if (
      subtype === 'exec_command_end' ||
      subtype === 'exec_command_output_delta' ||
      subtype === 'mcp_tool_call_end' ||
      subtype === 'web_search_end'
    ) {
      return 'tool_result';
    }
    if (subtype === 'context_compacted') return 'compaction';
    return 'system';
  }

  if (topType === 'response_item') {
    if (subtype === 'message') return 'message';
    if (subtype === 'reasoning') return 'reasoning';
    if (
      subtype === 'function_call' ||
      subtype === 'custom_tool_call' ||
      subtype === 'local_shell_call' ||
      subtype === 'web_search_call'
    ) {
      return 'tool_call';
    }
    if (subtype === 'function_call_output' || subtype === 'custom_tool_call_output') {
      return 'tool_result';
    }
    if (subtype === 'compaction' || subtype === 'compaction_summary') return 'compaction';
  }

  return 'system';
}

function parseTokenUsageSnapshot(
  payload: JsonRecord,
  previousContextTokens: number | null = null,
): TokenSnapshot {
  if (typeof payload.total === 'number' || typeof payload.prompt === 'number') {
    return {
      totalUsage: {},
      lastUsage: {},
      cumulativeTotalTokens: safeInt(payload.total),
      contextTokens: safeInt(payload.total),
      modelContextWindow: 0,
      contextFillPercent: null,
      lastInputTokens: safeInt(payload.prompt),
      lastCachedInputTokens: 0,
      lastOutputTokens: safeInt(payload.completion),
      lastReasoningOutputTokens: 0,
    };
  }

  const info = isRecord(payload.info) ? payload.info : payload;
  const totalUsage = isRecord(info.total_token_usage) ? info.total_token_usage : {};
  const lastUsage = isRecord(info.last_token_usage) ? info.last_token_usage : {};
  const cumulativeTotalTokens = safeInt(totalUsage.total_tokens);

  let contextTokens = safeInt(lastUsage.total_tokens);
  if (contextTokens <= 0) contextTokens = cumulativeTotalTokens;

  const modelContextWindow = safeInt(info.model_context_window);
  const lastInputTokens = safeInt(lastUsage.input_tokens);
  const lastCachedInputTokens = safeInt(lastUsage.cached_input_tokens);
  const lastOutputTokens = safeInt(lastUsage.output_tokens);
  const lastReasoningOutputTokens = safeInt(lastUsage.reasoning_output_tokens);
  const hasLastBreakdown = [
    lastInputTokens,
    lastCachedInputTokens,
    lastOutputTokens,
    lastReasoningOutputTokens,
  ].some((value) => value > 0);

  if (modelContextWindow > 0 && contextTokens > modelContextWindow) {
    if (hasLastBreakdown) contextTokens = modelContextWindow;
    else if (previousContextTokens && previousContextTokens > 0) contextTokens = previousContextTokens;
    else contextTokens = modelContextWindow;
  }

  return {
    totalUsage,
    lastUsage,
    cumulativeTotalTokens,
    contextTokens,
    modelContextWindow,
    contextFillPercent:
      modelContextWindow > 0 ? (contextTokens / modelContextWindow) * 100 : null,
    lastInputTokens,
    lastCachedInputTokens,
    lastOutputTokens,
    lastReasoningOutputTokens,
  };
}

function summarizeEvent(topType: string, subtype: string | null, payload: JsonRecord): string {
  if (topType === 'session_meta') {
    return `Session metadata (${payload.source || payload.originator || 'unknown source'}) in ${
      payload.cwd || 'unknown cwd'
    }`;
  }
  if (topType === 'turn_context') {
    const sandbox = isRecord(payload.sandbox_policy) ? payload.sandbox_policy.type : payload.sandbox_policy;
    return `Turn context: model=${payload.model || 'unknown-model'} approval=${
      payload.approval_policy || 'unknown'
    } sandbox=${sandbox || 'unknown'}`;
  }
  if (topType === 'compacted') return 'Compacted history';
  if (topType === 'event_msg' && subtype === 'token_count') {
    const token = parseTokenUsageSnapshot(payload);
    if (token.modelContextWindow > 0) {
      return `Context tokens ${token.contextTokens.toLocaleString()} / ${token.modelContextWindow.toLocaleString()} (${token.contextFillPercent?.toFixed(
        1,
      )}%)`;
    }
    return `Context tokens ${token.contextTokens.toLocaleString()}`;
  }
  if (topType === 'event_msg' && (subtype === 'user_message' || subtype === 'agent_message')) {
    return `${subtype.replaceAll('_', ' ')}: ${truncateText(payload.message || payload.text, 140)}`;
  }
  if (topType === 'response_item' && subtype === 'message') {
    return `${payload.role || 'unknown'} message: ${truncateText(
      extractTextFromContent(payload.content),
      140,
    )}`;
  }
  if (topType === 'response_item' && subtype === 'reasoning') return 'Reasoning item';
  if (topType === 'response_item' && (subtype === 'function_call' || subtype === 'custom_tool_call')) {
    return `Tool call: ${payload.name || 'unknown_tool'}`;
  }
  if (
    topType === 'response_item' &&
    (subtype === 'function_call_output' || subtype === 'custom_tool_call_output')
  ) {
    return `Tool result for call ${payload.call_id || 'unknown'}`;
  }
  return subtype?.replaceAll('_', ' ') || topType.replaceAll('_', ' ');
}

function normalizeOrigin(source: unknown, originator: unknown, rawOrigin: unknown): Origin {
  const value = String(rawOrigin || source || originator || '').toLowerCase();
  if (value.includes('subagent')) return 'subagent';
  if (value.includes('automation')) return 'automation';
  if (value.includes('user') || value.includes('cli') || value.includes('codex')) return 'user';
  return 'unknown';
}

function toApiSummary(summary: ConversationSummaryInternal): JsonRecord {
  return {
    id: summary.id,
    title: summary.title,
    updatedAt: summary.updatedAt,
    createdAt: summary.startedAt,
    threadId: summary.threadId || 'unknown',
    model: summary.model || 'unknown',
    cwd: summary.cwd || 'unknown',
    isArchived: summary.archived,
    metrics: {
      events: summary.totalEvents,
      turns: summary.turnCount,
      tools: summary.toolCallCount,
      peakTokens: summary.maxTotalTokens,
    },
    preview: summary.preview,
    origin: normalizeOrigin(summary.source, summary.originator, null),
  };
}

function toPythonCompatibleSummary(summary: ConversationSummaryInternal): JsonRecord {
  return {
    id: summary.id,
    thread_id: summary.threadId,
    path: summary.path,
    archived: summary.archived,
    title: summary.title,
    preview: summary.preview,
    started_at: summary.startedAt,
    updated_at: summary.updatedAt,
    cwd: summary.cwd,
    model: summary.model,
    model_provider: summary.modelProvider,
    cli_version: summary.cliVersion,
    source: summary.source,
    originator: summary.originator,
    total_events: summary.totalEvents,
    turn_count: summary.turnCount,
    message_count: summary.messageCount,
    tool_call_count: summary.toolCallCount,
    tool_result_count: summary.toolResultCount,
    compaction_count: summary.compactionCount,
    token_samples: summary.tokenSamples,
    max_total_tokens: summary.maxTotalTokens,
    type_counts: summary.typeCounts,
    event_type_counts: summary.eventTypeCounts,
    response_type_counts: summary.responseTypeCounts,
  };
}

function shrinkForJson(value: any, maxDepth = 9, maxItems = 120, maxString = 12000, depth = 0): [any, boolean] {
  if (depth >= maxDepth) return ['[truncated: max depth reached]', true];
  if (typeof value === 'string') {
    if (value.length <= maxString) return [value, false];
    return [`${value.slice(0, maxString)}... [truncated ${value.length - maxString} chars]`, true];
  }
  if (Array.isArray(value)) {
    let truncated = false;
    const out: any[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (index >= maxItems) {
        out.push(`[truncated ${value.length - maxItems} more items]`);
        truncated = true;
        break;
      }
      const [shrunk, itemTruncated] = shrinkForJson(
        value[index],
        maxDepth,
        maxItems,
        maxString,
        depth + 1,
      );
      out.push(shrunk);
      truncated = truncated || itemTruncated;
    }
    return [out, truncated];
  }
  if (isRecord(value)) {
    let truncated = false;
    const out: JsonRecord = {};
    const entries = Object.entries(value);
    for (let index = 0; index < entries.length; index += 1) {
      if (index >= maxItems) {
        out.__truncated__ = `${entries.length - maxItems} more keys omitted`;
        truncated = true;
        break;
      }
      const [key, itemValue] = entries[index];
      const [shrunk, itemTruncated] = shrinkForJson(
        itemValue,
        maxDepth,
        maxItems,
        maxString,
        depth + 1,
      );
      out[key] = shrunk;
      truncated = truncated || itemTruncated;
    }
    return [out, truncated];
  }
  return [value, false];
}

function getTraceRoots(): {sessionsDir: string; archivedDir: string; codexHome: string | null} {
  const explicitSessions = CLI_OPTIONS.sessionsPath ?? process.env.CODEX_SESSIONS_PATH;
  const explicitArchived = CLI_OPTIONS.archivedPath ?? process.env.CODEX_ARCHIVED_PATH;
  if (explicitSessions || explicitArchived) {
    return {
      sessionsDir: path.resolve(explicitSessions || './data/sessions'),
      archivedDir: path.resolve(explicitArchived || './data/archived_sessions'),
      codexHome: null,
    };
  }

  const codexHome = path.resolve((CLI_OPTIONS.codexHome ?? process.env.CODEX_HOME) || path.join(os.homedir(), '.codex'));
  return {
    sessionsDir: path.join(codexHome, 'sessions'),
    archivedDir: path.join(codexHome, 'archived_sessions'),
    codexHome,
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listRolloutPaths(dir: string, recursive: boolean): Promise<string[]> {
  if (!(await pathExists(dir))) return [];
  const entries = await fs.readdir(dir, {withFileTypes: true});
  const paths: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && recursive) {
      paths.push(...(await listRolloutPaths(fullPath, recursive)));
    } else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
      paths.push(fullPath);
    }
  }
  return paths.sort();
}

async function readJsonl(filePath: string): Promise<{rawLines: string[]; events: JsonRecord[]}> {
  const content = await fs.readFile(filePath, 'utf-8');
  const rawLines = content.split('\n').map((line) => line.trim()).filter(Boolean);
  const events = rawLines.map((line) => {
    try {
      const parsed = JSON.parse(line);
      return isRecord(parsed) ? parsed : {type: 'invalid', payload: {raw: line}};
    } catch (error) {
      return {
        type: 'invalid',
        payload: {raw: line, parse_error: error instanceof Error ? error.message : String(error)},
      };
    }
  });
  return {rawLines, events};
}

class RolloutStore {
  private readonly sessionsDir: string;
  private readonly archivedDir: string;
  private readonly codexHome: string | null;
  private index = new Map<string, ConversationSummaryInternal>();
  private summaryCache = new Map<string, {mtimeMs: number; summary: ConversationSummaryInternal}>();
  private conversationCache = new Map<string, ParsedConversationInternal>();
  private lastScanMs = 0;

  constructor() {
    const roots = getTraceRoots();
    this.sessionsDir = roots.sessionsDir;
    this.archivedDir = roots.archivedDir;
    this.codexHome = roots.codexHome;
  }

  getSourceInfo(): JsonRecord {
    return {
      codexHome: this.codexHome,
      sessionsDir: this.sessionsDir,
      archivedDir: this.archivedDir,
    };
  }

  async refreshIndex(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastScanMs < 3000) return;

    let paths = [
      ...(await listRolloutPaths(this.sessionsDir, true)),
      ...(await listRolloutPaths(this.archivedDir, true)),
    ];

    if (paths.length === 0 && !process.env.CODEX_SESSIONS_PATH && !process.env.CODEX_ARCHIVED_PATH) {
      paths = [
        ...(await listRolloutPaths(path.resolve('./data/sessions'), true)),
        ...(await listRolloutPaths(path.resolve('./data/archived_sessions'), true)),
      ];
    }

    const nextIndex = new Map<string, ConversationSummaryInternal>();
    for (const rolloutPath of paths) {
      const id = fileIdForPath(rolloutPath);
      const summary = await this.summaryForPath(rolloutPath, id);
      if (summary) nextIndex.set(id, summary);
    }

    for (const id of this.index.keys()) {
      if (!nextIndex.has(id)) this.conversationCache.delete(id);
    }

    this.index = nextIndex;
    this.lastScanMs = now;
  }

  async listConversations(options: {
    query?: string | null;
    includeArchived?: boolean;
    limit?: number | null;
  } = {}): Promise<ConversationSummaryInternal[]> {
    await this.refreshIndex();
    const includeArchived = options.includeArchived ?? true;
    let summaries = [...this.index.values()];

    if (!includeArchived) summaries = summaries.filter((summary) => !summary.archived);
    if (options.query) {
      const lowered = options.query.toLowerCase();
      summaries = summaries.filter((summary) => {
        return (
          summary.title.toLowerCase().includes(lowered) ||
          summary.preview.toLowerCase().includes(lowered) ||
          (summary.threadId || '').toLowerCase().includes(lowered) ||
          (summary.cwd || '').toLowerCase().includes(lowered) ||
          summary.path.toLowerCase().includes(lowered)
        );
      });
    }

    summaries.sort((a, b) => b.updatedTs - a.updatedTs);
    if (typeof options.limit === 'number' && options.limit >= 0) summaries = summaries.slice(0, options.limit);
    return summaries;
  }

  async getSummary(id: string): Promise<ConversationSummaryInternal | null> {
    await this.refreshIndex();
    return this.index.get(id) || null;
  }

  async getDefaultConversationId(): Promise<string | null> {
    const [first] = await this.listConversations({limit: 1});
    return first?.id || null;
  }

  async getToolAnalytics(includeArchived = true, limit = 12): Promise<JsonRecord> {
    const combined = newToolAnalyticsCounts();
    const conversations = await this.listConversations({includeArchived});
    for (const conversation of conversations) {
      mergeToolAnalyticsCounts(combined, conversation.toolAnalyticsCounts);
    }
    return serializeToolAnalytics(combined, conversations.length, limit);
  }

  async parseConversation(id: string): Promise<ParsedConversationInternal | null> {
    const summary = await this.getSummary(id);
    if (!summary) return null;

    const stat = await fs.stat(summary.path).catch(() => null);
    if (!stat) return null;

    const cached = this.conversationCache.get(id);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached;

    const {rawLines, events: rawEvents} = await readJsonl(summary.path);
    const parsed = this.parseRawEvents(summary, rawLines, rawEvents, stat.mtimeMs);
    this.conversationCache.set(id, parsed);
    return parsed;
  }

  private async summaryForPath(
    rolloutPath: string,
    id: string,
  ): Promise<ConversationSummaryInternal | null> {
    const stat = await fs.stat(rolloutPath).catch(() => null);
    if (!stat) return null;

    const cached = this.summaryCache.get(rolloutPath);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.summary;

    const {events} = await readJsonl(rolloutPath).catch(() => ({rawLines: [], events: []}));
    if (events.length === 0) return null;

    const summary = this.parseSummary(rolloutPath, id, stat.mtimeMs, events);
    this.summaryCache.set(rolloutPath, {mtimeMs: stat.mtimeMs, summary});
    return summary;
  }

  private parseSummary(
    rolloutPath: string,
    id: string,
    mtimeMs: number,
    rawEvents: JsonRecord[],
  ): ConversationSummaryInternal {
    const archived = path.resolve(rolloutPath).startsWith(path.resolve(this.archivedDir));
    const typeCounts: Record<string, number> = {};
    const eventTypeCounts: Record<string, number> = {};
    const responseTypeCounts: Record<string, number> = {};
    const categoryCounts: Record<string, number> = {};
    const toolAnalyticsCounts = newToolAnalyticsCounts();
    const turnIds = new Set<string>();

    let threadId: string | null = null;
    let startedAt: string | null = null;
    let updatedAt: string | null = null;
    let cwd: string | null = null;
    let model: string | null = null;
    let modelProvider: string | null = null;
    let cliVersion: string | null = null;
    let source: any = null;
    let originator: string | null = null;
    let rawOrigin: string | null = null;
    let firstUserMessage = '';
    let fallbackUserMessage = '';
    let tokenSamples = 0;
    let maxTotalTokens = 0;
    let compactionCount = 0;
    let inCompactionBlock = false;
    let previousContextTokens: number | null = null;

    for (const item of rawEvents) {
      const topType = asString(item.type) || 'invalid';
      const payload = isRecord(item.payload) ? item.payload : {};
      const subtype = getSubtype(topType, payload);
      bumpRecord(typeCounts, topType);
      if (topType === 'event_msg' && subtype) bumpRecord(eventTypeCounts, subtype);
      if (topType === 'response_item' && subtype) bumpRecord(responseTypeCounts, subtype);

      const category = inferEventCategory(topType, subtype);
      bumpRecord(categoryCounts, category);

      const timestamp = asString(item.timestamp) || asString(payload.timestamp);
      if (timestamp) {
        if (!startedAt) startedAt = timestamp;
        updatedAt = timestamp;
      }

      let lineHasCompactionSignal = false;
      if (topType === 'session_meta') {
        threadId = asString(payload.id) || asString(payload.thread_id) || threadId;
        startedAt = asString(payload.timestamp) || startedAt;
        cwd = asString(payload.cwd) || cwd;
        model = asString(payload.model) || model;
        modelProvider = asString(payload.model_provider) || modelProvider;
        cliVersion = asString(payload.cli_version) || cliVersion;
        source = payload.source ?? source;
        originator = asString(payload.originator) || originator;
        rawOrigin = asString(payload.origin) || rawOrigin;
      } else if (topType === 'turn_context') {
        model = asString(payload.model) || model;
        cwd = asString(payload.cwd) || cwd;
        if (asString(payload.turn_id)) turnIds.add(String(payload.turn_id));
      } else if (topType === 'message') {
        if (payload.role === 'user') {
          const candidate = truncateText(payload.content, 200);
          if (candidate && !fallbackUserMessage) fallbackUserMessage = candidate;
          if (candidate && !isProbablyScaffoldingMessage(candidate)) firstUserMessage ||= candidate;
        }
      } else if (topType === 'event_msg') {
        if (subtype === 'context_compacted') lineHasCompactionSignal = true;
        if (subtype === 'token_count') {
          tokenSamples += 1;
          const token = parseTokenUsageSnapshot(payload, previousContextTokens);
          if (token.contextTokens > 0) previousContextTokens = token.contextTokens;
          maxTotalTokens = Math.max(maxTotalTokens, token.contextTokens);
        }
        if (asString(payload.turn_id)) turnIds.add(String(payload.turn_id));
        if (subtype === 'user_message') {
          const candidate = truncateText(payload.message, 200);
          if (candidate && !fallbackUserMessage) fallbackUserMessage = candidate;
          if (candidate && !isProbablyScaffoldingMessage(candidate)) firstUserMessage ||= candidate;
        }
      } else if (topType === 'response_item') {
        updateToolAnalyticsFromResponseItem(toolAnalyticsCounts, payload, subtype);
        if (subtype === 'message' && payload.role === 'user') {
          const candidate = truncateText(extractTextFromContent(payload.content), 200);
          if (candidate && !fallbackUserMessage) fallbackUserMessage = candidate;
          if (candidate && !isProbablyScaffoldingMessage(candidate)) firstUserMessage ||= candidate;
        }
      } else if (topType === 'tool_call') {
        toolAnalyticsCounts.toolCallsTotal += 1;
        incrementMap(toolAnalyticsCounts.toolNameCounts, asString(payload.name) || 'unknown');
      } else if (topType === 'token_count') {
        tokenSamples += 1;
        const token = parseTokenUsageSnapshot(payload, previousContextTokens);
        maxTotalTokens = Math.max(maxTotalTokens, token.contextTokens);
      } else if (topType === 'compacted' || topType === 'compaction') {
        lineHasCompactionSignal = true;
      }

      if (lineHasCompactionSignal) {
        if (!inCompactionBlock) compactionCount += 1;
        inCompactionBlock = true;
      } else {
        inCompactionBlock = false;
      }
    }

    const fallbackStartedAt = parseFilenameTimestamp(rolloutPath) || isoFromEpochMs(mtimeMs);
    const finalStartedAt = startedAt || fallbackStartedAt;
    const finalUpdatedAt = updatedAt || finalStartedAt;
    const startedTs = parseIsoTs(finalStartedAt) || mtimeMs / 1000;
    const updatedTs = parseIsoTs(finalUpdatedAt) || mtimeMs / 1000;
    const preview = firstUserMessage || fallbackUserMessage || 'No user message found in this rollout.';
    const title = preview.length > 72 ? `${preview.slice(0, 69)}...` : preview;

    return {
      id,
      threadId,
      path: rolloutPath,
      archived,
      title: title || `Conversation ${threadId?.slice(0, 8) || id.slice(0, 8)}`,
      preview,
      startedAt: finalStartedAt,
      updatedAt: finalUpdatedAt,
      startedTs,
      updatedTs,
      cwd,
      model,
      modelProvider,
      cliVersion,
      source: source || rawOrigin,
      originator,
      totalEvents: rawEvents.length,
      turnCount: turnIds.size || (categoryCounts.message || 0),
      messageCount: categoryCounts.message || 0,
      toolCallCount: categoryCounts.tool_call || 0,
      toolResultCount: categoryCounts.tool_result || 0,
      compactionCount,
      tokenSamples,
      maxTotalTokens,
      typeCounts,
      eventTypeCounts,
      responseTypeCounts,
      toolAnalyticsCounts,
    };
  }

  private parseRawEvents(
    summary: ConversationSummaryInternal,
    rawLines: string[],
    rawEvents: JsonRecord[],
    mtimeMs: number,
  ): ParsedConversationInternal {
    const events: JsonRecord[] = [];
    const tokenSeries: JsonRecord[] = [];
    const turnStats = new Map<string, JsonRecord>();
    const toolNameByCallId = new Map<string, string>();
    const categoryCounts: Record<string, number> = {};
    const compactionMarkers: number[] = [];
    const toolAnalyticsCounts = newToolAnalyticsCounts();

    let currentTurnId: string | null = null;
    let previousContextTokens: number | null = null;
    let inCompactionBlock = false;

    rawEvents.forEach((item, index) => {
      const topType = asString(item.type) || 'invalid';
      const payload = isRecord(item.payload) ? payloadClone(item.payload) : {};
      const subtype = getSubtype(topType, payload);
      const timestamp = asString(item.timestamp) || asString(payload.timestamp) || summary.updatedAt;

      let eventTurnId: string | null = null;
      if (topType === 'turn_context' && asString(payload.turn_id)) {
        currentTurnId = String(payload.turn_id);
        eventTurnId = currentTurnId;
      }
      if (topType === 'event_msg' && asString(payload.turn_id)) {
        currentTurnId = String(payload.turn_id);
        eventTurnId = currentTurnId;
      }
      if (!eventTurnId) eventTurnId = currentTurnId;

      if (topType === 'response_item') {
        const callId = asString(payload.call_id);
        if ((subtype === 'function_call' || subtype === 'custom_tool_call') && callId) {
          toolNameByCallId.set(callId, asString(payload.name) || subtype);
        }
        updateToolAnalyticsFromResponseItem(toolAnalyticsCounts, payload, subtype);
      }

      const category = inferEventCategory(topType, subtype);
      bumpRecord(categoryCounts, category);
      if (category === 'compaction') {
        if (!inCompactionBlock) compactionMarkers.push(index);
        inCompactionBlock = true;
      } else {
        inCompactionBlock = false;
      }

      const legacyEvent = this.toLegacyEvent(
        summary.id,
        index,
        timestamp,
        topType,
        subtype,
        category,
        payload,
        item,
        eventTurnId,
        toolNameByCallId,
        previousContextTokens,
      );
      events.push(legacyEvent);

      if (category === 'tool_call') {
        const name = asString(legacyEvent.payload.name) || asString(legacyEvent.tool_name) || 'unknown';
        incrementMap(toolAnalyticsCounts.toolNameCounts, name);
      }

      if (eventTurnId) {
        const turn = turnStats.get(eventTurnId) || {
          turn_id: eventTurnId,
          start_event: index,
          end_event: index,
          start_time: timestamp,
          end_time: timestamp,
          event_count: 0,
          message_count: 0,
          tool_call_count: 0,
          tool_result_count: 0,
          token_samples: 0,
          max_total_tokens: 0,
        };
        turn.event_count += 1;
        turn.end_event = index;
        turn.end_time = timestamp;
        if (category === 'message') turn.message_count += 1;
        if (category === 'tool_call') turn.tool_call_count += 1;
        if (category === 'tool_result') turn.tool_result_count += 1;
        turnStats.set(eventTurnId, turn);
      }

      if (category === 'token') {
        const token = parseTokenUsageSnapshot(payload, previousContextTokens);
        if (token.contextTokens > 0) previousContextTokens = token.contextTokens;
        const point = {
          event_index: index,
          timestamp,
          timestamp_ts: parseIsoTs(timestamp),
          turn_id: eventTurnId,
          total_tokens: token.contextTokens,
          cumulative_total_tokens: token.cumulativeTotalTokens,
          input_tokens: safeInt(token.totalUsage.input_tokens),
          cached_input_tokens: safeInt(token.totalUsage.cached_input_tokens),
          output_tokens: safeInt(token.totalUsage.output_tokens),
          reasoning_output_tokens: safeInt(token.totalUsage.reasoning_output_tokens),
          last_total_tokens: safeInt(token.lastUsage.total_tokens),
          last_input_tokens: token.lastInputTokens,
          last_cached_input_tokens: token.lastCachedInputTokens,
          last_output_tokens: token.lastOutputTokens,
          last_reasoning_output_tokens: token.lastReasoningOutputTokens,
          model_context_window: token.modelContextWindow,
          context_fill_percent: token.contextFillPercent,
        };
        tokenSeries.push(point);
        if (eventTurnId) {
          const turn = turnStats.get(eventTurnId);
          if (turn) {
            turn.token_samples += 1;
            turn.max_total_tokens = Math.max(safeInt(turn.max_total_tokens), token.contextTokens);
          }
        }
      }
    });

    const compactionImpacts = this.computeCompactionImpacts(compactionMarkers, tokenSeries);
    const maxTotalTokens = Math.max(0, ...tokenSeries.map((point) => safeInt(point.total_tokens)));
    const maxContextWindow = Math.max(0, ...tokenSeries.map((point) => safeInt(point.model_context_window)));

    return {
      mtimeMs,
      rawLines,
      events,
      tokenSeries,
      compactionImpacts,
      turns: [...turnStats.values()].sort((a, b) => safeInt(a.start_event) - safeInt(b.start_event)),
      toolAnalyticsCounts,
      stats: {
        event_count: events.length,
        turn_count: turnStats.size,
        message_count: categoryCounts.message || 0,
        reasoning_count: categoryCounts.reasoning || 0,
        tool_call_count: categoryCounts.tool_call || 0,
        tool_result_count: categoryCounts.tool_result || 0,
        context_event_count: categoryCounts.context || 0,
        system_event_count: categoryCounts.system || 0,
        token_event_count: categoryCounts.token || 0,
        compaction_signal_count: categoryCounts.compaction || 0,
        compaction_event_count: compactionImpacts.length,
        max_total_tokens: maxTotalTokens,
        max_context_window: maxContextWindow,
        peak_fill_percent: maxContextWindow > 0 ? (maxTotalTokens / maxContextWindow) * 100 : null,
        line_count: rawLines.length,
      },
    };
  }

  private toLegacyEvent(
    conversationId: string,
    index: number,
    timestamp: string,
    topType: string,
    subtype: string | null,
    category: LegacyCategory,
    payload: JsonRecord,
    rawItem: JsonRecord,
    turnId: string | null,
    toolNameByCallId: Map<string, string>,
    previousContextTokens: number | null,
  ): JsonRecord {
    const normalizedPayload = this.toLegacyPayload(
      category,
      topType,
      subtype,
      payload,
      toolNameByCallId,
      previousContextTokens,
    );
    const callId = asString(normalizedPayload.call_id) || asString(payload.call_id) || asString(payload.id);
    const type = this.toLegacyType(category, topType, subtype);

    return {
      id: `${conversationId}-${index}`,
      index,
      timestamp,
      timestamp_ts: parseIsoTs(timestamp),
      category,
      type,
      top_type: topType,
      subtype,
      payload: normalizedPayload,
      summary: summarizeEvent(topType, subtype, payload),
      preview: truncateText(extractAnyMessageText(topType, payload), 180),
      call_id: callId || undefined,
      tool_name: asString(normalizedPayload.name) || undefined,
      turn_id: turnId,
      turn_index: turnId ? undefined : normalizedPayload.turn_index,
      line_size: JSON.stringify(rawItem).length,
    };
  }

  private toLegacyType(category: LegacyCategory, topType: string, subtype: string | null): string {
    if (topType === 'token_count') return 'token_count';
    if (topType === 'message') return 'message';
    if (topType === 'reasoning') return 'reasoning';
    if (topType === 'tool_call') return 'tool_call';
    if (topType === 'tool_result') return 'tool_result';
    if (category === 'token') return 'token_count';
    if (category === 'tool_call') return 'tool_call';
    if (category === 'tool_result') return 'tool_result';
    if (category === 'message') return 'message';
    if (category === 'reasoning') return 'reasoning';
    if (category === 'compaction') return 'compaction';
    return subtype || topType;
  }

  private toLegacyPayload(
    category: LegacyCategory,
    topType: string,
    subtype: string | null,
    payload: JsonRecord,
    toolNameByCallId: Map<string, string>,
    previousContextTokens: number | null,
  ): JsonRecord {
    if (topType === 'message') return payload;
    if (topType === 'reasoning') return payload;
    if (topType === 'tool_call') return payload;
    if (topType === 'tool_result') return payload;
    if (topType === 'token_count') return payload;

    if (category === 'message') {
      const role =
        topType === 'event_msg'
          ? subtype === 'user_message'
            ? 'user'
            : 'assistant'
          : asString(payload.role) || 'assistant';
      return {
        role,
        content: extractAnyMessageText(topType, payload),
        turn_index: safeInt(payload.turn_index, 0),
        phase: payload.phase,
      };
    }

    if (category === 'reasoning') {
      return {
        content: extractAnyMessageText(topType, payload) || summarizeEvent(topType, subtype, payload),
        encrypted: Boolean(payload.encrypted_content),
      };
    }

    if (category === 'token') {
      const token = parseTokenUsageSnapshot(payload, previousContextTokens);
      return {
        total: token.contextTokens,
        prompt: token.lastInputTokens,
        completion: token.lastOutputTokens,
        cached: token.lastCachedInputTokens,
        reasoning: token.lastReasoningOutputTokens,
        cumulative: token.cumulativeTotalTokens,
        contextWindow: token.modelContextWindow,
        contextFillPercent: token.contextFillPercent,
      };
    }

    if (category === 'tool_call') {
      const input = parseToolCallInput(payload, subtype);
      const command = parseToolCallCommand(payload, subtype);
      return {
        name: asString(payload.name) || subtype || 'tool_call',
        arguments: input || payload.arguments || payload.input || {},
        command,
        commandRoot: extractCommandRoot(command),
        call_id: asString(payload.call_id) || asString(payload.id),
        status: payload.status,
      };
    }

    if (category === 'tool_result') {
      const callId = asString(payload.call_id) || asString(payload.id);
      const output = payload.output ?? payload.message ?? payload.delta ?? payload.stdout ?? payload.stderr ?? payload;
      const [content, contentTruncated] = shrinkForJson(output, 6, 80, 12000);
      return {
        name: callId ? toolNameByCallId.get(callId) : undefined,
        content,
        content_truncated: contentTruncated,
        call_id: callId,
        status: payload.status,
        exit_code: payload.exit_code,
        duration_ms: payload.duration_ms || payload.duration,
      };
    }

    if (category === 'compaction') {
      return {
        before: payload.before,
        after: payload.after,
        removed: payload.removed,
        message: payload.message || summarizeEvent(topType, subtype, payload),
        replacement_history: payload.replacement_history,
      };
    }

    return {...payload, summary: summarizeEvent(topType, subtype, payload)};
  }

  private computeCompactionImpacts(markers: number[], tokenSeries: JsonRecord[]): JsonRecord[] {
    const impacts: JsonRecord[] = [];
    const seen = new Set<string>();
    for (const marker of markers) {
      let before: JsonRecord | null = null;
      let after: JsonRecord | null = null;
      for (const point of tokenSeries) {
        if (safeInt(point.event_index) <= marker) before = point;
        else {
          after = point;
          break;
        }
      }
      const key = `${before?.event_index ?? 'none'}:${after?.event_index ?? 'none'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      impacts.push({
        compaction_event_index: marker,
        before_event_index: before?.event_index ?? null,
        after_event_index: after?.event_index ?? null,
        before_total_tokens: before ? safeInt(before.total_tokens) : null,
        after_total_tokens: after ? safeInt(after.total_tokens) : null,
        delta_tokens: before && after ? safeInt(after.total_tokens) - safeInt(before.total_tokens) : null,
        before_fill_percent: before?.context_fill_percent ?? null,
        after_fill_percent: after?.context_fill_percent ?? null,
      });
    }
    return impacts;
  }
}

function payloadClone(payload: JsonRecord): JsonRecord {
  return {...payload};
}

function toLegacyParsed(summary: ConversationSummaryInternal, parsed: ParsedConversationInternal): JsonRecord {
  const toolStatsMap = new Map<string, {count: number; type: ToolStatType}>();
  for (const item of topEntriesFromMap(parsed.toolAnalyticsCounts.toolNameCounts, 30)) {
    toolStatsMap.set(item.name, {
      count: item.count,
      type: String(item.name).startsWith('mcp__') ? 'mcp' : 'command',
    });
  }

  return {
    summary: toApiSummary(summary),
    events: parsed.events,
    tokenSeries: parsed.tokenSeries.map((point) => ({
      timestamp: point.timestamp,
      totalTokens: safeInt(point.total_tokens),
      promptTokens: safeInt(point.last_input_tokens || point.input_tokens),
      completionTokens: safeInt(point.last_output_tokens || point.output_tokens),
      isCompaction: false,
    })),
    toolStats: [...toolStatsMap.entries()].map(([name, item]) => ({
      name,
      count: item.count,
      type: item.type,
    })),
    turns: parsed.turns,
    stats: parsed.stats,
    compactionImpacts: parsed.compactionImpacts,
    toolAnalytics: serializeToolAnalytics(parsed.toolAnalyticsCounts, 1, 12),
  };
}

const store = new RolloutStore();

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({limit: '2mb'}));

  app.get('/api/health', async (_req, res) => {
    res.json({ok: true, time: new Date().toISOString(), source: store.getSourceInfo()});
  });

  app.get('/api/sessions', async (req, res) => {
    const query = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : null;
    const includeArchived = req.query.include_archived !== '0';
    const sessions = await store.listConversations({includeArchived, query});
    res.json(sessions.map(toApiSummary));
  });

  app.get('/api/sessions/:id', async (req, res) => {
    const summary = await store.getSummary(req.params.id);
    if (!summary) {
      res.status(404).json({error: 'Session not found'});
      return;
    }
    const parsed = await store.parseConversation(req.params.id);
    if (!parsed) {
      res.status(500).json({error: 'Failed to parse session'});
      return;
    }
    res.json(toLegacyParsed(summary, parsed));
  });

  app.get('/api/bootstrap', async (req, res) => {
    const includeArchived = req.query.include_archived !== '0';
    const conversations = await store.listConversations({includeArchived, limit: 200});
    res.json({
      default_conversation_id: conversations[0]?.id || null,
      conversation_count: conversations.length,
      conversations: conversations.map(toPythonCompatibleSummary),
      source: store.getSourceInfo(),
    });
  });

  app.get('/api/tool-analytics', async (req, res) => {
    const includeArchived = req.query.include_archived !== '0';
    const limit = Math.max(4, Math.min(30, safeInt(req.query.limit, 12)));
    res.json(await store.getToolAnalytics(includeArchived, limit));
  });

  app.get('/api/conversations', async (req, res) => {
    const includeArchived = req.query.include_archived !== '0';
    const query = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : null;
    const limit = typeof req.query.limit === 'string' ? safeInt(req.query.limit, -1) : null;
    const conversations = await store.listConversations({
      query,
      includeArchived,
      limit: limit !== null && limit >= 0 ? limit : null,
    });
    res.json({
      conversation_count: conversations.length,
      conversations: conversations.map(toPythonCompatibleSummary),
    });
  });

  app.get('/api/conversations/:id/events', async (req, res) => {
    const summary = await store.getSummary(req.params.id);
    const parsed = await store.parseConversation(req.params.id);
    if (!summary || !parsed) {
      res.status(404).json({error: 'Conversation not found'});
      return;
    }
    res.json({
      conversation: toPythonCompatibleSummary(summary),
      stats: parsed.stats,
      token_series: parsed.tokenSeries,
      compaction_impacts: parsed.compactionImpacts,
      turns: parsed.turns,
      events: parsed.events,
      tool_analytics: serializeToolAnalytics(parsed.toolAnalyticsCounts, 1, 12),
    });
  });

  app.get('/api/conversations/:id/events/:eventIndex', async (req, res) => {
    const eventIndex = safeInt(req.params.eventIndex, -1);
    const parsed = await store.parseConversation(req.params.id);
    if (!parsed) {
      res.status(404).json({error: 'Conversation not found'});
      return;
    }
    if (eventIndex < 0 || eventIndex >= parsed.rawLines.length) {
      res.status(404).json({error: 'Event index out of bounds'});
      return;
    }
    const rawLine = parsed.rawLines[eventIndex];
    const full = req.query.full === '1';
    let raw: any = rawLine;
    try {
      raw = JSON.parse(rawLine);
    } catch {
      res.json({event_index: eventIndex, raw: rawLine, parse_error: 'Invalid JSON', full: true});
      return;
    }
    const [payloadToSend, truncated] = full ? [raw, false] : shrinkForJson(raw);
    res.json({
      event_index: eventIndex,
      event_meta: parsed.events[eventIndex],
      raw: payloadToSend,
      raw_truncated: truncated,
      full,
    });
  });

  if (!IS_PRODUCTION) {
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  await store.refreshIndex(true);
  app.listen(PORT, '0.0.0.0', () => {
    const source = store.getSourceInfo();
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Trace source: ${source.codexHome || `${source.sessionsDir} + ${source.archivedDir}`}`);
  });
}

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
