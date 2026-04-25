import React from 'react';
import { 
  AlertCircle,
  Check,
  Copy,
  Search, 
  RefreshCw, 
  MessageSquare, 
  Database, 
  Zap, 
  Terminal, 
  Brain, 
  ChevronRight,
  Activity,
  Layers,
  Workflow,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatTimestamp, formatFullDate, cn } from './lib/utils';
import { TraceEvent, ConversationSummary, ParsedConversation, ToolAnalytics, EventDetail } from './types';

// Components
const EventIcon = ({ category }: { category: TraceEvent['category'] }) => {
  switch (category) {
    case 'message': return <MessageSquare className="w-3.5 h-3.5 text-brand-blue" />;
    case 'tool_call': return <Terminal className="w-3.5 h-3.5 text-brand-orange" />;
    case 'tool_result': return <Database className="w-3.5 h-3.5 text-emerald-500" />;
    case 'reasoning': return <Brain className="w-3.5 h-3.5 text-purple-400" />;
    case 'token': return <Activity className="w-3.5 h-3.5 text-sky-400" />;
    case 'context': return <Workflow className="w-3.5 h-3.5 text-amber-400" />;
    case 'system': return <Layers className="w-3.5 h-3.5 text-fuchsia-400" />;
    case 'compaction': return <Zap className="w-3.5 h-3.5 text-orange-500" />;
    default: return <ChevronRight className="w-3.5 h-3.5 text-text-muted" />;
  }
};

const EVENT_FILTERS: Array<{ key: TraceEvent['category']; label: string }> = [
  { key: 'message', label: 'Message' },
  { key: 'tool_call', label: 'Tool' },
  { key: 'tool_result', label: 'Result' },
  { key: 'reasoning', label: 'Reasoning' },
  { key: 'token', label: 'Token' },
  { key: 'context', label: 'Context' },
  { key: 'system', label: 'System' },
  { key: 'compaction', label: 'Compact' },
];

const DEFAULT_SESSION_RENDER_LIMIT = 120;
const DEFAULT_EVENT_RENDER_LIMIT = 240;
const TIMELINE_ROW_HEIGHT = 84;
const VIRTUAL_OVERSCAN = 6;
const MAX_CACHED_SESSIONS = 8;
const MAX_CACHED_EVENT_DETAILS = 24;
const TokenArcChart = React.lazy(() => import('./components/TokenArcChart'));

function getFromCappedCache<T>(cache: Map<string, T>, key: string): T | undefined {
  const cached = cache.get(key);
  if (cached === undefined) {
    return undefined;
  }
  cache.delete(key);
  cache.set(key, cached);
  return cached;
}

function setToCappedCache<T>(cache: Map<string, T>, key: string, value: T, maxEntries: number) {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);

  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    cache.delete(oldestKey);
  }
}

async function copyTextToClipboard(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard API is unavailable');
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();

  const didCopy = document.execCommand('copy');
  document.body.removeChild(textarea);

  if (!didCopy) {
    throw new Error('Copy command failed');
  }
}

function useElementSize<T extends HTMLElement>(active = true) {
  const ref = React.useRef<T | null>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });

  React.useEffect(() => {
    if (!active) {
      setSize({ width: 0, height: 0 });
      return;
    }

    const node = ref.current;
    if (!node) {
      return;
    }

    const update = () => {
      setSize({
        width: node.clientWidth,
        height: node.clientHeight,
      });
    };

    update();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => update());
    observer.observe(node);

    return () => observer.disconnect();
  }, [active]);

  return { ref, size };
}

function useVirtualWindow(count: number, rowHeight: number, enabled: boolean) {
  const { ref, size } = useElementSize<HTMLDivElement>(enabled);
  const [scrollTop, setScrollTop] = React.useState(0);
  const frameRef = React.useRef<number | null>(null);
  const pendingScrollTopRef = React.useRef(0);

  React.useEffect(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    pendingScrollTopRef.current = 0;
    setScrollTop(0);
  }, [count, enabled]);

  React.useEffect(() => () => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
    }
  }, []);

  const onScroll = React.useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!enabled) return;
      pendingScrollTopRef.current = event.currentTarget.scrollTop;
      if (frameRef.current !== null) {
        return;
      }
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        setScrollTop((current) => (
          current === pendingScrollTopRef.current ? current : pendingScrollTopRef.current
        ));
      });
    },
    [enabled]
  );

  const viewportHeight = enabled ? size.height : count * rowHeight;
  const startIndex = enabled
    ? Math.max(0, Math.floor(scrollTop / rowHeight) - VIRTUAL_OVERSCAN)
    : 0;
  const visibleCount = enabled
    ? Math.ceil(viewportHeight / rowHeight) + VIRTUAL_OVERSCAN * 2
    : count;
  const endIndex = enabled ? Math.min(count, startIndex + visibleCount) : count;
  const indexes = React.useMemo(
    () => Array.from({ length: Math.max(0, endIndex - startIndex) }, (_, offset) => startIndex + offset),
    [endIndex, startIndex]
  );

  return {
    containerRef: ref,
    onScroll,
    startIndex,
    endIndex,
    indexes,
  };
}

interface SessionSidebarProps {
  filteredSessionCount: number;
  selectedSession: string | null;
  visibleSessions: ConversationSummary[];
  onLoadMore: () => void;
  onSelectSession: (sessionId: string) => void;
}

const SessionSidebar = React.memo(function SessionSidebar({
  filteredSessionCount,
  selectedSession,
  visibleSessions,
  onLoadMore,
  onSelectSession,
}: SessionSidebarProps) {
  return (
    <>
      <div className="p-2 text-[10px] font-bold text-text-muted uppercase tracking-wider border-b border-border-subtle select-none">Recent Conversations</div>
      <div className="flex-1 overflow-y-auto space-y-px p-1 no-scrollbar" style={{ contentVisibility: 'auto' }}>
        {visibleSessions.map((session) => (
          <button
            key={session.id}
            onClick={() => onSelectSession(session.id)}
            className={cn(
              "w-full text-left p-2.5 rounded transition-all border border-transparent",
              selectedSession === session.id
                ? "bg-bg-elevated border-border-strong"
                : "hover:bg-bg-surface/50"
            )}
          >
            <div className="text-[11px] font-medium text-text-primary truncate mb-1">
              {session.title}
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-[9px] text-brand-orange font-mono truncate max-w-[140px] opacity-80">
                {session.cwd}
              </span>
              <span className="text-[9px] text-text-muted whitespace-nowrap">
                {formatTimestamp(session.updatedAt)}
              </span>
            </div>
          </button>
        ))}
        {filteredSessionCount > visibleSessions.length && (
          <button
            onClick={onLoadMore}
            className="w-full text-center p-2 rounded border border-dashed border-border-subtle text-[10px] uppercase tracking-wide text-text-muted hover:text-text-bright hover:border-text-muted transition-colors"
          >
            Load {Math.min(DEFAULT_SESSION_RENDER_LIMIT, filteredSessionCount - visibleSessions.length)} More
          </button>
        )}
      </div>
    </>
  );
});

interface TimelineEventRowProps {
  event: TraceEvent;
  isFocusMode: boolean;
  isSelected: boolean;
  onSelectEvent: (event: TraceEvent) => void;
}

const TimelineEventRow = React.memo(function TimelineEventRow({
  event,
  isFocusMode,
  isSelected,
  onSelectEvent,
}: TimelineEventRowProps) {
  return (
    <button
      onClick={() => onSelectEvent(event)}
      className={cn(
        "w-full text-left p-2.5 transition-all border-l-2 relative group",
        isSelected
          ? "bg-bg-elevated border-brand-orange shadow-inner"
          : "hover:bg-bg-surface/50 border-transparent",
        event.type === 'compaction' && "bg-orange-950/10",
        !isFocusMode && "h-[84px] border-b border-border-subtle",
        isFocusMode && "mb-3 rounded-md border-y border-r border-border-subtle p-4"
      )}
    >
      <div className="flex justify-between opacity-50 mb-1.5 text-[9px] tracking-tighter">
        <span className="flex items-center gap-2">
          <span className="bg-bg-surface px-1.5 rounded text-text-primary">#{(event.index ?? 0) + 1}</span>
          {formatTimestamp(event.timestamp)}
        </span>
        <span className="uppercase">{event.type}</span>
      </div>
      <div className="flex gap-4 items-start">
        <div className={cn(
          "w-8 h-8 rounded shrink-0 flex items-center justify-center bg-bg-surface border border-border-subtle",
          isSelected && "border-brand-orange/50"
        )}>
          <EventIcon category={event.category} />
        </div>
        <div className="flex-1 min-w-0">
          <div className={cn(
            "font-bold uppercase text-[9px] tracking-tight mb-1",
            event.category === 'message' && "text-brand-blue",
            event.category === 'tool_call' && "text-brand-orange",
            event.category === 'tool_result' && "text-emerald-500",
            event.category === 'reasoning' && "text-purple-400",
            event.category === 'token' && "text-sky-400",
            event.category === 'context' && "text-amber-400",
            event.category === 'system' && "text-fuchsia-400",
            event.category === 'compaction' && "text-orange-500"
          )}>
            {(event.subtype || event.type).replace('_count', '').replace(/_/g, ' ')}
          </div>
          {isFocusMode ? (
            <div className="mt-2 text-text-primary text-[11px] leading-relaxed break-words">
              {renderImmersivePreview(event)}
            </div>
          ) : (
            <div className="text-text-secondary truncate text-[11px]">
              {renderEventSimplePreview(event)}
            </div>
          )}
        </div>
      </div>
    </button>
  );
});

interface TimelinePanelProps {
  eventRenderLimit: number;
  filter: TraceEvent['category'][];
  filteredEventCount: number;
  hiddenEventCount: number;
  isFocusMode: boolean;
  selectedEventId: string | null;
  showAllEvents: boolean;
  timelineEvents: TraceEvent[];
  timelineWidth: number;
  onClearFilter: () => void;
  onSelectEvent: (event: TraceEvent) => void;
  onToggleFilter: (category: TraceEvent['category']) => void;
  onToggleShowAllEvents: () => void;
}

const TimelinePanel = React.memo(function TimelinePanel({
  eventRenderLimit,
  filter,
  filteredEventCount,
  hiddenEventCount,
  isFocusMode,
  selectedEventId,
  showAllEvents,
  timelineEvents,
  timelineWidth,
  onClearFilter,
  onSelectEvent,
  onToggleFilter,
  onToggleShowAllEvents,
}: TimelinePanelProps) {
  const shouldVirtualizeTimeline = !isFocusMode;
  const timelineWindow = useVirtualWindow(timelineEvents.length, TIMELINE_ROW_HEIGHT, shouldVirtualizeTimeline);
  const renderedTimelineEvents = React.useMemo(
    () => shouldVirtualizeTimeline
      ? timelineWindow.indexes.map((index) => timelineEvents[index]).filter(Boolean)
      : timelineEvents,
    [shouldVirtualizeTimeline, timelineEvents, timelineWindow.indexes]
  );
  const timelineStartSpacer = shouldVirtualizeTimeline ? timelineWindow.startIndex * TIMELINE_ROW_HEIGHT : 0;
  const timelineEndSpacer = shouldVirtualizeTimeline
    ? Math.max(0, (timelineEvents.length - timelineWindow.endIndex) * TIMELINE_ROW_HEIGHT)
    : 0;

  const effectiveWidth = timelineWidth;
  const hasPinnedWidth = !isFocusMode || selectedEventId !== null;
  const isCompactHeader = hasPinnedWidth && effectiveWidth < 560;
  const isTightHeader = hasPinnedWidth && effectiveWidth < 430;
  const showHeaderMeta = filteredEventCount > eventRenderLimit || isFocusMode;
  const filterRailRef = React.useRef<HTMLDivElement | null>(null);
  const [filterRailOverflow, setFilterRailOverflow] = React.useState({ left: false, right: false });
  const updateFilterRailOverflow = React.useCallback(() => {
    const node = filterRailRef.current;
    if (!node) return;

    const maxScrollLeft = Math.max(0, node.scrollWidth - node.clientWidth);
    const nextState = {
      left: node.scrollLeft > 4,
      right: maxScrollLeft - node.scrollLeft > 4,
    };

    setFilterRailOverflow((current) => (
      current.left === nextState.left && current.right === nextState.right ? current : nextState
    ));
  }, []);

  React.useEffect(() => {
    const rafId = window.requestAnimationFrame(updateFilterRailOverflow);
    return () => window.cancelAnimationFrame(rafId);
  }, [updateFilterRailOverflow, timelineWidth, filter.length, showHeaderMeta, isFocusMode]);

  React.useEffect(() => {
    const node = filterRailRef.current;
    if (!node || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => updateFilterRailOverflow());
    observer.observe(node);

    return () => observer.disconnect();
  }, [updateFilterRailOverflow]);

  return (
    <section className={cn(
      "border-r border-border-subtle flex flex-col shrink-0",
      isFocusMode
        ? (selectedEventId ? "" : "w-full max-w-5xl mx-auto border-r-0")
        : ""
    )}
    style={!isFocusMode || (isFocusMode && selectedEventId) ? { width: effectiveWidth } : undefined}
    >
      <div className="border-b border-border-subtle bg-bg-surface">
        <div className="flex items-center gap-2 overflow-hidden p-2">
          <div className="relative min-w-0 flex-1">
            <div
              ref={filterRailRef}
              onScroll={updateFilterRailOverflow}
              className="min-w-0 overflow-x-auto no-scrollbar"
            >
              <div className="flex w-max items-center gap-1 pr-3">
                <button
                  onClick={onClearFilter}
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded px-2 py-1 text-[10px] transition-colors",
                    filter.length === 0
                      ? "bg-border-subtle text-text-bright"
                      : "hover:bg-border-subtle text-text-muted"
                  )}
                >
                  All
                </button>
                {EVENT_FILTERS.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => onToggleFilter(key)}
                    className={cn(
                      "shrink-0 whitespace-nowrap rounded px-2 py-1 text-[10px] transition-colors capitalize",
                      filter.includes(key)
                        ? "bg-border-subtle text-text-bright"
                        : "hover:bg-border-subtle text-text-muted"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div
              className={cn(
                "pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-bg-surface to-transparent transition-opacity duration-200",
                filterRailOverflow.left ? "opacity-100" : "opacity-0"
              )}
            />
            <div
              className={cn(
                "pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-bg-surface to-transparent transition-opacity duration-200",
                filterRailOverflow.right ? "opacity-100" : "opacity-0"
              )}
            />
          </div>
          {showHeaderMeta && (
            <div className="flex shrink-0 items-center gap-1.5 border-l border-border-subtle pl-2 whitespace-nowrap">
              {filteredEventCount > eventRenderLimit && (
                <>
                  <span className="rounded border border-border-subtle bg-bg-base px-1.5 py-0.5 text-[10px] font-mono text-text-secondary">
                    {showAllEvents
                      ? `${filteredEventCount}/${filteredEventCount}`
                      : `${eventRenderLimit}/${filteredEventCount}`}
                  </span>
                  <button
                    onClick={onToggleShowAllEvents}
                    className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-text-muted transition-colors hover:bg-border-subtle hover:text-text-bright"
                  >
                    {showAllEvents ? (isCompactHeader ? 'Less' : 'Collapse') : (isCompactHeader ? 'More' : 'Show All')}
                  </button>
                </>
              )}
              {isFocusMode && !isTightHeader && (
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-text-muted">
                  <Terminal className="w-3 h-3" />
                  {!isCompactHeader && 'TRACE STREAM'}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <div
        className={cn(
          "flex-1 overflow-y-auto font-mono text-[11px] no-scrollbar transition-all",
          !shouldVirtualizeTimeline && "divide-y divide-border-subtle",
          isFocusMode && "px-4 pt-4"
        )}
        ref={timelineWindow.containerRef}
        onScroll={timelineWindow.onScroll}
        style={{ contentVisibility: 'auto' }}
      >
        {timelineStartSpacer > 0 && <div style={{ height: timelineStartSpacer }} />}
        {renderedTimelineEvents.map((event) => (
          <TimelineEventRow
            key={event.id}
            event={event}
            isFocusMode={isFocusMode}
            isSelected={selectedEventId === event.id}
            onSelectEvent={onSelectEvent}
          />
        ))}
        {timelineEndSpacer > 0 && <div style={{ height: timelineEndSpacer }} />}
        {filteredEventCount === 0 && (
          <div className="p-4 text-text-muted text-[11px] italic">
            No events match the current filter.
          </div>
        )}
      </div>
    </section>
  );
});

interface InspectorPanelProps {
  isEventDetailLoading: boolean;
  isFocusMode: boolean;
  selectedEvent: TraceEvent | null;
  selectedEventDetail: EventDetail | null;
  onClose: () => void;
}

const InspectorPanel = React.memo(function InspectorPanel({
  isEventDetailLoading,
  isFocusMode,
  selectedEvent,
  selectedEventDetail,
  onClose,
}: InspectorPanelProps) {
  const [copyFeedback, setCopyFeedback] = React.useState<'idle' | 'success' | 'error'>('idle');
  const inspectorPayload = selectedEventDetail?.raw ?? selectedEvent?.raw ?? selectedEvent?.payload;
  const inspectorPayloadText = React.useMemo(
    () => stringifyForDisplay(inspectorPayload),
    [inspectorPayload]
  );
  const renderedInspectorPayload = React.useMemo(
    () => renderJSONPayload(inspectorPayload),
    [inspectorPayload]
  );
  const renderedStructuredDetail = React.useMemo(
    () => (selectedEvent ? renderStructuredDetail(selectedEvent) : null),
    [selectedEvent]
  );
  const renderedFormattedContent = React.useMemo(
    () => (selectedEvent ? renderFormattedContent(selectedEvent) : null),
    [selectedEvent]
  );
  React.useEffect(() => {
    if (copyFeedback === 'idle') return;

    const timer = window.setTimeout(() => setCopyFeedback('idle'), 1800);
    return () => window.clearTimeout(timer);
  }, [copyFeedback]);
  React.useEffect(() => {
    setCopyFeedback('idle');
  }, [selectedEvent?.id]);

  const handleCopyPayload = React.useCallback(async () => {
    try {
      await copyTextToClipboard(inspectorPayloadText);
      setCopyFeedback('success');
    } catch (error) {
      console.error(error);
      setCopyFeedback('error');
    }
  }, [inspectorPayloadText]);

  return (
    <section className={cn(
      "flex flex-col bg-bg-base overflow-hidden transition-all duration-500 ease-in-out shadow-[-20px_0_40px_rgba(0,0,0,0.3)]",
      isFocusMode
        ? (selectedEvent ? "flex-1 border-l border-border-subtle" : "w-0 opacity-0 pointer-events-none")
        : "flex-1 border-l border-border-subtle"
    )}>
      <div className="border-b border-border-subtle bg-bg-surface shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2 p-2">
          <span className="text-[10px] font-bold uppercase text-text-secondary tracking-widest">Inspector</span>
          {selectedEvent && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <AnimatePresence initial={false}>
                {copyFeedback !== 'idle' && (
                  <motion.span
                    key={copyFeedback}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    aria-live="polite"
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[10px] font-semibold tracking-wide",
                      copyFeedback === 'success'
                        ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                        : "border-rose-500/25 bg-rose-500/10 text-rose-300"
                    )}
                  >
                    {copyFeedback === 'success' ? (
                      <Check className="w-3 h-3" />
                    ) : (
                      <AlertCircle className="w-3 h-3" />
                    )}
                    {copyFeedback === 'success' ? 'JSON copied' : 'Copy failed'}
                  </motion.span>
                )}
              </AnimatePresence>
              <button
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                  copyFeedback === 'success'
                    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                    : copyFeedback === 'error'
                      ? "border-rose-500/25 bg-rose-500/10 text-rose-300"
                      : "border-brand-blue/25 bg-brand-blue/10 text-brand-blue hover:border-brand-blue/45 hover:bg-brand-blue/15 hover:text-white"
                )}
                onClick={handleCopyPayload}
              >
                {copyFeedback === 'success' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                Copy JSON
              </button>
              {isFocusMode && (
                <button
                  className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border border-border-subtle bg-bg-base px-2.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary transition-colors hover:border-text-muted hover:bg-bg-elevated hover:text-text-bright"
                  onClick={onClose}
                >
                  <X className="w-3 h-3" />
                  Close
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 no-scrollbar">
        <AnimatePresence mode="wait">
          {selectedEvent ? (
            <motion.div
              key={selectedEvent.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              <div>
                <h3 className="text-brand-orange text-[10px] font-bold mb-2 uppercase tracking-widest">Structured Information</h3>
                <div className="grid grid-cols-[100px_1fr] gap-y-2 text-[11px] border border-border-subtle p-3 rounded bg-bg-base">
                  <div className="text-text-muted">Event Type</div>
                  <div className="font-mono text-text-primary">{selectedEvent.type}</div>
                  {selectedEvent.call_id && (
                    <>
                      <div className="text-text-muted">Call ID</div>
                      <div className="font-mono text-text-primary">{selectedEvent.call_id}</div>
                    </>
                  )}
                  <div className="text-text-muted">Category</div>
                  <div className="font-mono text-text-primary">{selectedEvent.category}</div>
                  <div className="text-text-muted">Timestamp</div>
                  <div className="text-text-secondary font-mono">{selectedEvent.timestamp}</div>
                  {renderedStructuredDetail}
                </div>
              </div>

              {renderedFormattedContent}

              <div>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <h3 className="text-text-secondary text-[10px] font-bold uppercase tracking-widest">Raw JSON Payload</h3>
                  <span className="text-[10px] text-text-muted">
                    {isEventDetailLoading
                      ? 'Loading full event...'
                      : selectedEventDetail
                        ? (selectedEventDetail.raw_truncated ? 'Truncated source' : 'Full source')
                        : 'Normalized payload'}
                  </span>
                </div>
                <div className="bg-black p-4 rounded border border-border-subtle font-mono text-[11px] leading-relaxed overflow-x-auto">
                  <pre className="text-text-bright/90 whitespace-pre">
                    {renderedInspectorPayload}
                  </pre>
                </div>
              </div>
            </motion.div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-text-muted text-center px-12 italic">
              <Activity className="w-10 h-10 mb-3 opacity-10" />
              <p className="text-xs">Select an event in the timeline index to inspect payload structure and relational metadata.</p>
            </div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
});

export default function App() {
  const [sessions, setSessions] = React.useState<ConversationSummary[]>([]);
  const [selectedSession, setSelectedSession] = React.useState<string | null>(null);
  const [parsedData, setParsedData] = React.useState<ParsedConversation | null>(null);
  const [selectedEvent, setSelectedEvent] = React.useState<TraceEvent | null>(null);
  const [selectedEventDetail, setSelectedEventDetail] = React.useState<EventDetail | null>(null);
  const [globalToolAnalytics, setGlobalToolAnalytics] = React.useState<ToolAnalytics | null>(null);
  const [search, setSearch] = React.useState('');
  const deferredSearch = React.useDeferredValue(search.trim());
  const [isLoading, setIsLoading] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [filter, setFilter] = React.useState<TraceEvent['category'][]>([]);
  const [isArchivedView, setIsArchivedView] = React.useState(false);
  const [isFocusMode, setIsFocusMode] = React.useState(false);
  const [toolScope, setToolScope] = React.useState<'session' | 'global'>('session');
  const [isEventDetailLoading, setIsEventDetailLoading] = React.useState(false);
  const [sessionRenderLimit, setSessionRenderLimit] = React.useState(DEFAULT_SESSION_RENDER_LIMIT);
  const [showAllEvents, setShowAllEvents] = React.useState(false);
  const [timelineWidth, setTimelineWidth] = React.useState(400);
  const [focusTimelineWidth, setFocusTimelineWidth] = React.useState(400);
  const [isResizing, setIsResizing] = React.useState(false);
  const sessionDetailCacheRef = React.useRef(new Map<string, ParsedConversation>());
  const eventDetailCacheRef = React.useRef(new Map<string, EventDetail>());

  const applySessionDetail = React.useCallback(
    (data: ParsedConversation, preserveSelectedEvent?: TraceEvent | null) => {
      const nextSelectedEvent = preserveSelectedEvent
        ? data.events.find(
            (event) =>
              event.index === preserveSelectedEvent.index ||
              event.id === preserveSelectedEvent.id
          ) ?? null
        : null;

      setParsedData(data);
      setSelectedEvent(nextSelectedEvent);
      if (!nextSelectedEvent) {
        setSelectedEventDetail(null);
      }
      return nextSelectedEvent;
    },
    []
  );

  const fetchSessions = async (
    query = deferredSearch,
    options?: { background?: boolean }
  ): Promise<ConversationSummary[]> => {
    if (!options?.background) {
      setIsRefreshing(true);
    }
    try {
      const params = new URLSearchParams();
      if (query) {
        params.set('q', query);
      }
      params.set('include_archived', '1');
      const res = await fetch(`/api/sessions?${params.toString()}`);
      const data = await res.json();
      setSessions(data);
      if (data.length === 0) {
        setSelectedSession(null);
        setParsedData(null);
        setSelectedEvent(null);
        setSelectedEventDetail(null);
      } else if (!data.some((session: ConversationSummary) => session.id === selectedSession)) {
        setSelectedSession(data[0].id);
      }
      return data;
    } catch (e) {
      console.error(e);
      return [];
    } finally {
      if (!options?.background) {
        setIsRefreshing(false);
      }
      setIsLoading(false);
    }
  };

  const fetchGlobalToolAnalytics = async (): Promise<ToolAnalytics | null> => {
    try {
      const res = await fetch('/api/tool-analytics?limit=6');
      const data = await res.json();
      setGlobalToolAnalytics(data);
      return data;
    } catch (e) {
      console.error(e);
      return null;
    }
  };

  const fetchSessionDetail = async (
    id: string,
    options?: { background?: boolean; preserveSelectedEvent?: TraceEvent | null; force?: boolean }
  ): Promise<ParsedConversation | null> => {
    if (!options?.background) {
      setIsLoading(true);
    }
    try {
      if (!options?.force) {
        const cached: ParsedConversation | undefined = getFromCappedCache<ParsedConversation>(
          sessionDetailCacheRef.current,
          id
        );
        if (cached !== undefined) {
          applySessionDetail(cached, options?.preserveSelectedEvent);
          return cached;
        }
      }

      const res = await fetch(`/api/sessions/${id}`);
      const data: ParsedConversation = await res.json();
      setToCappedCache(sessionDetailCacheRef.current, id, data, MAX_CACHED_SESSIONS);
      applySessionDetail(data, options?.preserveSelectedEvent);
      return data;
    } catch (e) {
      console.error(e);
      return null;
    } finally {
      if (!options?.background) {
        setIsLoading(false);
      }
    }
  };

  const fetchEventDetail = async (
    sessionId: string,
    eventIndex: number,
    options?: { background?: boolean; force?: boolean }
  ): Promise<EventDetail | null> => {
    if (!options?.background) {
      setIsEventDetailLoading(true);
    }
    try {
      const cacheKey = `${sessionId}:${eventIndex}`;
      if (!options?.force) {
        const cached: EventDetail | undefined = getFromCappedCache<EventDetail>(
          eventDetailCacheRef.current,
          cacheKey
        );
        if (cached !== undefined) {
          setSelectedEventDetail(cached);
          return cached;
        }
      }

      const res = await fetch(`/api/conversations/${sessionId}/events/${eventIndex}?full=1`);
      const data: EventDetail = await res.json();
      setToCappedCache(eventDetailCacheRef.current, cacheKey, data, MAX_CACHED_EVENT_DETAILS);
      setSelectedEventDetail(data);
      return data;
    } catch (e) {
      console.error(e);
      setSelectedEventDetail(null);
      return null;
    } finally {
      if (!options?.background) {
        setIsEventDetailLoading(false);
      }
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    const preservedSessionId = selectedSession;
    const preservedEvent = selectedEvent;
    try {
      sessionDetailCacheRef.current.clear();
      eventDetailCacheRef.current.clear();
      const [refreshedSessions] = await Promise.all([
        fetchSessions(deferredSearch, { background: true }),
        fetchGlobalToolAnalytics(),
      ]);
      const activeSessionId =
        preservedSessionId && refreshedSessions.some((session) => session.id === preservedSessionId)
          ? preservedSessionId
          : refreshedSessions[0]?.id ?? null;

      if (!activeSessionId) {
        setParsedData(null);
        setSelectedEvent(null);
        setSelectedEventDetail(null);
        return;
      }

      await fetchSessionDetail(activeSessionId, {
        background: true,
        preserveSelectedEvent: activeSessionId === preservedSessionId ? preservedEvent : null,
        force: true,
      });
      if (activeSessionId === preservedSessionId && preservedEvent?.index !== undefined) {
        await fetchEventDetail(activeSessionId, preservedEvent.index, { background: true, force: true });
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchSessions(deferredSearch);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [deferredSearch]);

  React.useEffect(() => {
    void fetchGlobalToolAnalytics();
  }, []);

  React.useEffect(() => {
    if (selectedSession) {
      void fetchSessionDetail(selectedSession);
    }
  }, [selectedSession]);

  React.useEffect(() => {
    if (selectedSession && selectedEvent?.index !== undefined) {
      void fetchEventDetail(selectedSession, selectedEvent.index);
      return;
    }
    setSelectedEventDetail(null);
  }, [selectedSession, selectedEvent]);

  React.useEffect(() => {
    setSessionRenderLimit(DEFAULT_SESSION_RENDER_LIMIT);
  }, [deferredSearch, isArchivedView]);

  const filterKey = filter.join('|');

  React.useEffect(() => {
    setShowAllEvents(false);
  }, [selectedSession, isFocusMode, filterKey]);

  const filteredSessions = React.useMemo(
    () => sessions.filter((session) => (isArchivedView ? session.isArchived : !session.isArchived)),
    [sessions, isArchivedView]
  );

  const visibleSessions = React.useMemo(
    () => filteredSessions.slice(0, sessionRenderLimit),
    [filteredSessions, sessionRenderLimit]
  );

  const filteredEvents = React.useMemo(
    () => parsedData?.events.filter((event) => filter.length === 0 || filter.includes(event.category)) || [],
    [parsedData, filter]
  );

  const eventRenderLimit = isFocusMode ? 120 : DEFAULT_EVENT_RENDER_LIMIT;
  const timelineEvents = React.useMemo(
    () => (showAllEvents ? filteredEvents : filteredEvents.slice(0, eventRenderLimit)),
    [filteredEvents, showAllEvents, eventRenderLimit]
  );
  const hiddenEventCount = filteredEvents.length - timelineEvents.length;

  const visibleToolAnalytics = toolScope === 'global' ? globalToolAnalytics : parsedData?.toolAnalytics;
  const visibleToolRows = toolScope === 'global'
    ? (globalToolAnalytics?.top_tools || [])
    : (parsedData?.toolStats || []);
  const visibleToolMax = visibleToolRows[0]?.count || 1;
  const toolRootsPreview = visibleToolAnalytics?.top_command_roots?.slice(0, 3).map(item => item.name).join(', ');
  const handleSelectSession = React.useCallback((sessionId: string) => {
    React.startTransition(() => setSelectedSession(sessionId));
  }, []);
  const handleLoadMoreSessions = React.useCallback(() => {
    setSessionRenderLimit((current) => current + DEFAULT_SESSION_RENDER_LIMIT);
  }, []);
  const handleClearFilter = React.useCallback(() => {
    setFilter([]);
  }, []);
  const handleToggleFilter = React.useCallback((category: TraceEvent['category']) => {
    setFilter((current) => (current[0] === category ? [] : [category]));
  }, []);
  const handleToggleShowAllEvents = React.useCallback(() => {
    setShowAllEvents((current) => !current);
  }, []);
  const handleSelectEvent = React.useCallback((event: TraceEvent) => {
    React.startTransition(() => setSelectedEvent(event));
  }, []);
  const handleCloseInspector = React.useCallback(() => {
    setSelectedEvent(null);
  }, []);

  const handleResizeStart = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  React.useEffect(() => {
    if (!isResizing) return;

    let rafId: number | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      if (rafId !== null) return;

      rafId = requestAnimationFrame(() => {
        const sidebarWidth = isFocusMode ? 0 : 256;
        const newWidth = e.clientX - sidebarWidth;
        const clampedWidth = Math.max(300, Math.min(800, newWidth));

        if (isFocusMode) {
          setFocusTimelineWidth(clampedWidth);
        } else {
          setTimelineWidth(clampedWidth);
        }
        rafId = null;
      });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [isResizing, isFocusMode]);

  return (
    <div className="flex flex-col h-screen bg-bg-base text-text-primary overflow-hidden font-sans">
      {/* High Density Header */}
      <header className="h-12 border-b border-border-subtle flex items-center px-4 justify-between shrink-0 bg-bg-base">
        <div className="flex items-center gap-4">
          <div className="bg-brand-orange text-bg-deep font-bold px-2 py-0.5 text-[10px] rounded tracking-tighter">CODEX TRACE</div>
          <div className="h-4 w-px bg-border-subtle"></div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-text-secondary select-none">Session:</span>
            <span className="font-mono text-text-primary">{selectedSession || 'None'}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 border-r border-border-subtle pr-3 mr-1">
            <button 
              onClick={() => setIsFocusMode(!isFocusMode)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded text-[10px] font-bold uppercase transition-all",
                isFocusMode 
                  ? "bg-brand-blue text-white shadow-lg shadow-brand-blue/20" 
                  : "bg-bg-elevated text-text-muted hover:text-text-bright border border-border-subtle"
              )}
            >
              <Zap className={cn("w-3 h-3", isFocusMode && "fill-current")} />
              {isFocusMode ? "Focus Active" : "Focus Mode"}
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
            <input 
              type="text" 
              placeholder="Search..." 
              className="bg-bg-elevated border border-border-subtle text-[11px] rounded px-8 py-1.5 w-48 focus:outline-none focus:border-brand-orange transition-colors placeholder:text-text-muted"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 border-l border-border-subtle pl-3">
            <button 
              onClick={handleRefresh}
              className={cn("p-1.5 hover:bg-bg-surface rounded text-text-secondary hover:text-text-bright transition-colors", isRefreshing && "animate-spin")}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setIsArchivedView(!isArchivedView)}
              className={cn(
                "text-[10px] uppercase font-bold border px-2 py-1 rounded transition-colors",
                isArchivedView 
                  ? "bg-brand-orange/10 border-brand-orange text-brand-orange" 
                  : "border-border-subtle text-text-muted hover:text-text-bright hover:border-text-muted"
              )}
            >
              Archived
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar - Discussion List */}
        <AnimatePresence>
          {!isFocusMode && (
            <motion.aside 
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 256, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="border-r border-border-subtle flex flex-col shrink-0 bg-bg-deep overflow-hidden"
            >
              <SessionSidebar
                filteredSessionCount={filteredSessions.length}
                selectedSession={selectedSession}
                visibleSessions={visibleSessions}
                onLoadMore={handleLoadMoreSessions}
                onSelectSession={handleSelectSession}
              />
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Main Content */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden bg-bg-base">
          {parsedData ? (
            <>
              {/* Summary Metrics Bar - HIDDEN IN FOCUS MODE */}
              <AnimatePresence>
                {!isFocusMode && (
                  <motion.section 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="p-4 grid grid-cols-4 gap-4 bg-bg-surface border-b border-border-subtle overflow-hidden grow-0"
                  >
                    <div className="space-y-1">
                      <div className="text-[9px] uppercase font-bold text-text-muted tracking-wide">Model / Thread</div>
                      <div className="text-[12px] font-mono text-text-bright truncate">{parsedData.summary?.model || 'Unknown'} / {parsedData.summary?.threadId || 'Unknown'}</div>
                      <div className="text-[10px] text-text-secondary">Started {parsedData.summary?.createdAt ? formatFullDate(parsedData.summary.createdAt) : 'Unknown'}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[9px] uppercase font-bold text-text-muted tracking-wide">Context Utilization</div>
                      <div className="text-[12px] font-mono text-text-bright">
                        {parsedData.summary?.metrics.peakTokens.toLocaleString() || 0} / 128k 
                        <span className="text-brand-orange text-[10px] ml-2">({parsedData.summary ? Math.round((parsedData.summary.metrics.peakTokens / 128000) * 100) : 0}%)</span>
                      </div>
                      <div className="w-full h-1 bg-border-subtle rounded-full overflow-hidden">
                        <div className="bg-brand-orange h-full" style={{ width: `${parsedData.summary ? Math.min(100, (parsedData.summary.metrics.peakTokens / 128000) * 100) : 0}%` }}></div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[9px] uppercase font-bold text-text-muted tracking-wide">Event Metrics</div>
                      <div className="text-[12px] font-mono text-text-bright">{parsedData.summary?.metrics.events || 0} Total Events</div>
                      <div className="text-[10px] text-text-secondary">{parsedData.summary?.metrics.turns || 0} Msg, {parsedData.summary?.metrics.tools || 0} Tool</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[9px] uppercase font-bold text-text-muted tracking-wide">Origin</div>
                      <div className="text-[12px] font-medium flex items-center gap-1.5 text-text-bright uppercase tracking-tighter">
                        <div className="w-1.5 h-1.5 bg-brand-blue rounded-full"></div>
                        {parsedData.summary?.origin || 'User'} Agent
                      </div>
                      <div className="text-[10px] text-text-secondary">Connected via Local Trace</div>
                    </div>
                  </motion.section>
                )}
              </AnimatePresence>

              {/* Sub-Header area with Charts/Patterns - HIDDEN IN FOCUS MODE */}
              {!isFocusMode && (
                <section className="h-[140px] min-w-0 flex border-b border-border-subtle shrink-0">
                <div className="flex-[1.5] min-w-0 border-r border-border-subtle p-3 flex flex-col bg-bg-base">
                  <div className="flex justify-between items-center mb-2">
                    <div className="text-[10px] font-bold uppercase text-text-secondary">Token Arc & Compaction</div>
                    <div className="text-[10px] font-mono text-brand-orange">Peak: {parsedData.summary.metrics.peakTokens.toLocaleString()}</div>
                  </div>
                  <div className="flex-1 min-w-0 min-h-0">
                    <React.Suspense fallback={<div className="h-full w-full rounded border border-border-subtle bg-bg-surface/50" />}>
                      <TokenArcChart data={parsedData.tokenSeries} />
                    </React.Suspense>
                  </div>
                </div>
                <div className="flex-1 min-w-0 p-3 flex flex-col bg-bg-deep">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold uppercase text-text-secondary">Top Tools</div>
                      <div className="mt-1 text-[9px] text-text-muted flex items-center gap-1.5">
                        <Workflow className="w-3 h-3 shrink-0" />
                        <span className="truncate">
                          {visibleToolAnalytics
                            ? `${visibleToolAnalytics.tool_calls_total} calls / ${visibleToolAnalytics.threads_analyzed} thread${visibleToolAnalytics.threads_analyzed === 1 ? '' : 's'}`
                            : 'Loading analytics...'}
                        </span>
                      </div>
                      {toolRootsPreview && (
                        <div className="mt-1 text-[9px] text-text-muted truncate">
                          Roots: <span className="font-mono text-text-secondary">{toolRootsPreview}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex rounded border border-border-subtle overflow-hidden shrink-0">
                      <button
                        onClick={() => setToolScope('session')}
                        className={cn(
                          "px-2 py-1 text-[9px] uppercase font-bold transition-colors",
                          toolScope === 'session'
                            ? "bg-brand-blue text-white"
                            : "bg-bg-base text-text-muted hover:text-text-bright"
                        )}
                      >
                        Session
                      </button>
                      <button
                        onClick={() => setToolScope('global')}
                        className={cn(
                          "px-2 py-1 text-[9px] uppercase font-bold transition-colors border-l border-border-subtle",
                          toolScope === 'global'
                            ? "bg-brand-orange text-bg-deep border-l-brand-orange"
                            : "bg-bg-base text-text-muted hover:text-text-bright"
                        )}
                      >
                        Global
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5 overflow-y-auto no-scrollbar">
                    {visibleToolRows.slice(0, 4).map((stat) => (
                      <div key={stat.name} className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] font-mono text-text-primary truncate">{stat.name}</div>
                          {'type' in stat && (
                            <div className="text-[9px] uppercase text-text-muted">{stat.type}</div>
                          )}
                        </div>
                        <div className="flex-1 h-2 bg-bg-elevated rounded-full overflow-hidden">
                          <div className="bg-brand-blue h-full" style={{ width: `${Math.min(100, (stat.count / visibleToolMax) * 100)}%` }}></div>
                        </div>
                        <div className="text-[10px] font-mono w-4 text-text-secondary">{stat.count}</div>
                      </div>
                    ))}
                    {visibleToolRows.length === 0 && (
                      <div className="text-[10px] text-text-muted italic">
                        {toolScope === 'global' ? 'No global tool usage available.' : 'No tools recorded in this session.'}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* Event Explorer Split */}
            <div className={cn("flex-1 flex overflow-hidden", isFocusMode && "bg-bg-deep")}>
              <TimelinePanel
                eventRenderLimit={eventRenderLimit}
                filter={filter}
                filteredEventCount={filteredEvents.length}
                hiddenEventCount={hiddenEventCount}
                isFocusMode={isFocusMode}
                selectedEventId={selectedEvent?.id ?? null}
                showAllEvents={showAllEvents}
                timelineEvents={timelineEvents}
                timelineWidth={isFocusMode ? focusTimelineWidth : timelineWidth}
                onClearFilter={handleClearFilter}
                onSelectEvent={handleSelectEvent}
                onToggleFilter={handleToggleFilter}
                onToggleShowAllEvents={handleToggleShowAllEvents}
              />

              {((!isFocusMode) || (isFocusMode && selectedEvent)) && (
                <div
                  className={cn(
                    "w-1 bg-border-subtle hover:bg-brand-orange cursor-col-resize transition-colors shrink-0 relative group",
                    isResizing && "bg-brand-orange"
                  )}
                  onMouseDown={handleResizeStart}
                >
                  <div className="absolute inset-y-0 -left-1 -right-1" />
                </div>
              )}

              <InspectorPanel
                isEventDetailLoading={isEventDetailLoading}
                isFocusMode={isFocusMode}
                selectedEvent={selectedEvent}
                selectedEventDetail={selectedEventDetail}
                onClose={handleCloseInspector}
              />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center flex-col text-text-muted">
              {isLoading ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-8 h-8 rounded-full border-2 border-brand-orange border-t-transparent animate-spin"></div>
                  <p className="text-[11px] font-mono tracking-widest uppercase animate-pulse">Scanning Rollout Stream...</p>
                </div>
              ) : (
                <div className="text-center group">
                  <Layers className="w-12 h-12 mb-4 mx-auto opacity-10 group-hover:opacity-20 transition-opacity" />
                  <p className="text-[11px] font-mono tracking-widest uppercase">Select Session Context</p>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* High Density Footer */}
      <footer className="h-6 bg-bg-deep border-t border-border-subtle flex items-center px-3 justify-between shrink-0 select-none">
        <div className="flex items-center gap-4 text-[9px] uppercase tracking-widest text-text-muted font-bold">
          <span className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-brand-orange rotate-45"></div>
            Trace Engine v1.0.4
          </span>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
            <span>Connected</span>
          </div>
        </div>
        <div className="text-[9px] text-text-muted font-mono">
          Rollout Buffer: {sessions.length} sessions detected | Archive: {sessions.filter(s => s.isArchived).length}
        </div>
      </footer>
    </div>
  );
}

function stringifyForDisplay(value: unknown, indent = 2) {
  if (typeof value === 'string') {
    return value;
  }
  try {
    const json = JSON.stringify(value ?? null, null, indent);
    return typeof json === 'string' ? json : String(value ?? '');
  } catch {
    return String(value ?? '');
  }
}

function truncateText(value: string, max = 120) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function getEventPreviewText(event: TraceEvent) {
  const p = event.payload;
  const preferred = [
    event.preview,
    event.summary,
    typeof p?.message === 'string' ? p.message : null,
    typeof p?.summary === 'string' ? p.summary : null,
    typeof p?.content === 'string' ? p.content : null,
  ].find((value): value is string => Boolean(value && value.trim()));

  if (preferred) {
    return preferred.trim();
  }

  if (event.type === 'tool_call' && typeof p?.name === 'string') {
    const command = typeof p.command === 'string' && p.command.trim() ? ` · ${p.command}` : '';
    return `${p.name}${command}`;
  }

  if (event.type === 'tool_result' && p?.content !== undefined) {
    return typeof p.content === 'string' ? p.content : stringifyForDisplay(p.content, 0);
  }

  if (event.type === 'token_count') {
    return `Total ${p?.total ?? 0} · Prompt ${p?.prompt ?? 0} · Completion ${p?.completion ?? 0}`;
  }

  if (typeof p?.name === 'string' && p.name.trim()) {
    return p.name.trim();
  }

  return stringifyForDisplay(p, 0).replace(/\s+/g, ' ').trim();
}

function renderEventSimplePreview(event: TraceEvent) {
  return truncateText(getEventPreviewText(event) || 'No preview', 88);
}

const FOCUS_PREVIEW_CLAMP_STYLE: React.CSSProperties = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 5,
  overflow: 'hidden',
};

function renderImmersivePreview(event: TraceEvent) {
  const p = event.payload;

  if (event.category === 'context') {
    return (
      <div className="bg-amber-500/5 border border-amber-500/15 rounded p-3 text-amber-100/80 whitespace-pre-wrap">
        <div style={FOCUS_PREVIEW_CLAMP_STYLE}>
          {getEventPreviewText(event)}
        </div>
      </div>
    );
  }

  if (event.category === 'system') {
    return (
      <div className="bg-fuchsia-500/5 border border-fuchsia-500/15 rounded p-3 text-fuchsia-100/80 whitespace-pre-wrap">
        <div style={FOCUS_PREVIEW_CLAMP_STYLE}>
          {getEventPreviewText(event)}
        </div>
      </div>
    );
  }

  switch (event.type) {
    case 'message':
      return (
        <div className={cn(
          "whitespace-pre-wrap font-mono leading-relaxed",
          p.role === 'user' ? "text-text-bright" : "text-brand-blue"
        )} style={FOCUS_PREVIEW_CLAMP_STYLE}>
          {p.content || getEventPreviewText(event)}
        </div>
      );
    case 'reasoning':
      return (
        <div
          className="italic text-purple-400 font-mono opacity-80 whitespace-pre-wrap"
          style={FOCUS_PREVIEW_CLAMP_STYLE}
        >
          {p.content || getEventPreviewText(event)}
        </div>
      );
    case 'tool_call':
      return (
        <div className="bg-black/20 p-2 rounded border border-white/5 space-y-2">
          <div className="text-emerald-400 font-bold">{p.name}(...)</div>
          {p.command && (
            <div className="text-[10px] text-brand-orange font-mono break-all" style={FOCUS_PREVIEW_CLAMP_STYLE}>
              {p.command}
            </div>
          )}
          <div className="text-[10px] text-text-muted whitespace-pre-wrap break-words" style={FOCUS_PREVIEW_CLAMP_STYLE}>
            {stringifyForDisplay(p.arguments, 2)}
          </div>
        </div>
      );
    case 'tool_result':
      return (
        <div className="bg-emerald-500/5 p-2 rounded border border-emerald-500/10 space-y-2">
          <div className="flex flex-wrap gap-2 text-[9px] uppercase text-text-muted">
            {p.status && <span>Status {p.status}</span>}
            {typeof p.exit_code === 'number' && <span>Exit {p.exit_code}</span>}
            {typeof p.duration_ms === 'number' && <span>{p.duration_ms} ms</span>}
            {p.content_truncated && <span className="text-brand-orange">Preview truncated</span>}
          </div>
          <div
            className="text-emerald-500/90 whitespace-pre-wrap break-words"
            style={FOCUS_PREVIEW_CLAMP_STYLE}
          >
            {typeof p.content === 'string' ? p.content : stringifyForDisplay(p.content, 2)}
          </div>
        </div>
      );
    case 'compaction':
      return (
        <div className="flex items-center gap-4 text-orange-500 font-bold">
          <span>BEFORE: {p.before}</span>
          <ChevronRight className="w-3 h-3" />
          <span>AFTER: {p.after}</span>
          <span className="ml-auto text-[9px] bg-orange-500/10 px-2 py-0.5 rounded">-{p.removed} TOKENS</span>
        </div>
      );
    case 'token_count':
      return (
        <div className="flex flex-wrap gap-4 text-[10px] text-sky-400 font-mono">
          <span>PROMPT: {p.prompt}</span>
          <span>COMPLETION: {p.completion}</span>
          <span className="font-bold text-text-bright">TOTAL: {p.total}</span>
          {typeof p.contextFillPercent === 'number' && <span>FILL: {p.contextFillPercent}%</span>}
        </div>
      );
    default:
      return (
        <div className="text-text-muted italic whitespace-pre-wrap break-words" style={FOCUS_PREVIEW_CLAMP_STYLE}>
          {truncateText(getEventPreviewText(event), 240)}
        </div>
      );
  }
}

function renderStructuredDetail(event: TraceEvent) {
  const p = event.payload;
  if (event.type === 'message') {
    return (
      <>
        <div className="text-text-muted">Role</div>
        <div className="font-mono text-brand-blue uppercase">{p.role}</div>
        <div className="text-text-muted">Turn Index</div>
        <div className="font-mono text-text-primary">{p.turn_index ?? 'N/A'}</div>
      </>
    );
  }
  if (event.type === 'tool_call') {
    return (
      <>
        <div className="text-text-muted">Tool Name</div>
        <div className="font-mono text-brand-orange">{p.name}</div>
        <div className="text-text-muted">Args Count</div>
        <div className="font-mono text-text-primary">{Object.keys(p.arguments || {}).length}</div>
        {p.commandRoot && (
          <>
            <div className="text-text-muted">Command Root</div>
            <div className="font-mono text-text-primary">{p.commandRoot}</div>
          </>
        )}
      </>
    );
  }
  if (event.type === 'tool_result') {
    return (
      <>
        <div className="text-text-muted">Tool Name</div>
        <div className="font-mono text-emerald-400">{p.name || 'Unknown'}</div>
        <div className="text-text-muted">Status</div>
        <div className="font-mono text-text-primary">{p.status || 'Unknown'}</div>
        {typeof p.exit_code === 'number' && (
          <>
            <div className="text-text-muted">Exit Code</div>
            <div className="font-mono text-text-primary">{p.exit_code}</div>
          </>
        )}
        {typeof p.duration_ms === 'number' && (
          <>
            <div className="text-text-muted">Duration</div>
            <div className="font-mono text-text-primary">{p.duration_ms} ms</div>
          </>
        )}
      </>
    );
  }
  if (event.type === 'token_count') {
    return (
      <>
        <div className="text-text-muted">Prompt</div>
        <div className="font-mono text-text-primary">{p.prompt}</div>
        <div className="text-text-muted">Completion</div>
        <div className="font-mono text-text-primary">{p.completion}</div>
        <div className="text-text-muted">Total</div>
        <div className="font-mono text-brand-orange font-bold">{p.total}</div>
        {typeof p.contextFillPercent === 'number' && (
          <>
            <div className="text-text-muted">Context Fill</div>
            <div className="font-mono text-text-primary">{p.contextFillPercent}%</div>
          </>
        )}
      </>
    );
  }
  if (event.type === 'compaction') {
    return (
      <>
        <div className="text-text-muted">Before</div>
        <div className="font-mono text-text-primary">{p.before ?? 'N/A'}</div>
        <div className="text-text-muted">After</div>
        <div className="font-mono text-text-primary">{p.after ?? 'N/A'}</div>
        <div className="text-text-muted">Removed</div>
        <div className="font-mono text-brand-orange font-bold">{p.removed ?? 'N/A'}</div>
      </>
    );
  }
  if (event.category === 'context' || event.category === 'system') {
    return (
      <>
        <div className="text-text-muted">Subtype</div>
        <div className="font-mono text-text-primary">{event.subtype || event.top_type || 'N/A'}</div>
        <div className="text-text-muted">Summary</div>
        <div className="text-text-primary">{truncateText(getEventPreviewText(event), 120)}</div>
      </>
    );
  }
  return null;
}

function getContextualFormattedContent(event: TraceEvent) {
  const p = event.payload;
  const baseInstructionsText =
    typeof p?.base_instructions?.text === 'string' && p.base_instructions.text.trim()
      ? p.base_instructions.text.trim()
      : null;

  if ((event.type === 'session_meta' || event.top_type === 'session_meta') && baseInstructionsText) {
    return {
      text: baseInstructionsText,
      source: 'base_instructions.text',
    };
  }

  return {
    text: getEventPreviewText(event),
    source: null,
  };
}

function renderFormattedContent(event: TraceEvent) {
  const p = event.payload;
  const isMessage = event.type === 'message';
  const isReasoning = event.type === 'reasoning';
  const isToolCall = event.type === 'tool_call';
  const isToolResult = event.type === 'tool_result';
  const isContextual = event.category === 'context' || event.category === 'system';
  const contextualContent = isContextual ? getContextualFormattedContent(event) : null;
  const contentSource =
    typeof p?.content_source === 'string' ? p.content_source : contextualContent?.source || null;
  const isEncryptedReasoning = isReasoning && Boolean(p?.encrypted);
  const reasoningContent =
    typeof p?.content === 'string' && p.content.trim() && p.content !== 'Reasoning item'
      ? p.content
      : null;

  if (!isMessage && !isReasoning && !isToolCall && !isToolResult && !isContextual) return null;

  return (
    <div className="mb-2">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h3 className="text-text-secondary text-[10px] font-bold uppercase tracking-widest">Formatted Content</h3>
        {contentSource && (
          <span className="rounded border border-emerald-500/20 bg-emerald-500/8 px-2 py-1 font-mono text-[10px] text-emerald-300/90">
            {contentSource}
          </span>
        )}
      </div>
      <div className={cn(
        "rounded p-4 text-[12px] leading-relaxed font-mono border",
        isReasoning
          ? "bg-purple-900/10 border-purple-500/20"
          : isContextual
            ? "bg-amber-950/10 border-amber-500/15"
            : "bg-bg-elevated border-border-subtle"
      )}>
        {isMessage || isReasoning ? (
          <div className={cn(
            "whitespace-pre-wrap break-words",
            isReasoning ? "text-purple-300 italic" : (p.role === 'user' ? "text-text-bright" : "text-brand-blue")
          )}>
            {isEncryptedReasoning && !reasoningContent ? (
              <span className="not-italic text-purple-200/80">
                Encrypted reasoning trace. No readable formatted content is available in this event.
              </span>
            ) : (
              (isReasoning ? reasoningContent : p.content) ||
              getEventPreviewText(event) ||
              <span className="opacity-30 italic">Empty content payload</span>
            )}
          </div>
        ) : isToolCall ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-brand-orange font-bold text-sm">
              <Terminal className="w-4 h-4" />
              {p.name}(...)
            </div>
            {p.command && (
              <div className="text-[11px] text-text-muted break-all">{p.command}</div>
            )}
            <div className="bg-black/40 p-3 rounded border border-white/5 text-emerald-400/90 whitespace-pre-wrap break-words">
              {stringifyForDisplay(p.arguments, 2)}
            </div>
          </div>
        ) : isToolResult ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-text-muted uppercase">
              <span>Execution Result</span>
              {p.status && <span>Status {p.status}</span>}
              {typeof p.exit_code === 'number' && <span>Exit {p.exit_code}</span>}
              {typeof p.duration_ms === 'number' && <span>{p.duration_ms} ms</span>}
              {p.content_truncated && <span className="text-brand-orange">Truncated preview</span>}
            </div>
            <div className="text-emerald-400 whitespace-pre-wrap break-words bg-emerald-500/5 p-3 rounded border border-emerald-500/10">
              {typeof p.content === 'string' ? p.content : stringifyForDisplay(p.content, 2)}
            </div>
          </div>
        ) : isContextual ? (
          <div className="whitespace-pre-wrap break-words text-text-primary">
            {contextualContent?.text || <span className="opacity-30 italic">No formatted content</span>}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function renderJSONPayload(payload: any) {
  const json = stringifyForDisplay(payload, 2);
  if (json.length > 8000) {
    return json;
  }
  // Basic highlighting logic
  return json.split('\n').map((line, i) => {
    const parts = line.split(/(".*?"|true|false|null|-?\d+(?:\.\d+)?)/g);
    return (
      <div key={i}>
        {parts.map((part, j) => {
          if (part.startsWith('"') && part.endsWith('"') && part.includes(':')) {
             return <span key={j} className="text-pink-400">{part}</span>;
          }
          if (part.startsWith('"') && part.endsWith('"')) {
            return <span key={j} className="text-orange-300">{part}</span>;
          }
          if (['true', 'false', 'null'].includes(part)) {
            return <span key={j} className="text-purple-400">{part}</span>;
          }
          if (/^\d+$/.test(part)) {
            return <span key={j} className="text-sky-300">{part}</span>;
          }
          return <span key={j}>{part}</span>;
        })}
      </div>
    );
  });
}
