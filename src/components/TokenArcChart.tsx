import React from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatFullDate } from '../lib/utils';
import { CompactionImpact, TokenSnapshot } from '../types';

interface TokenArcChartProps {
  data: TokenSnapshot[];
  compactions?: CompactionImpact[];
  onSelectSnapshot?: (snapshot: TokenSnapshot) => void;
  onSelectCompaction?: (impact: CompactionImpact) => void;
  selectedCompactionEventIndex?: number | null;
  selectedTokenEventIndex?: number | null;
}

interface CompactionMarkerDatum extends CompactionImpact {
  id: string;
  timestamp: string;
  totalTokens: number;
}

interface OverlayPoint {
  id: string;
  left: number;
  top: number;
  eventIndex?: number;
}

const CHART_MARGIN = { top: 5, right: 0, left: -20, bottom: 0 } as const;

function findNearestTokenIndex(left: number, points: OverlayPoint[]): number | null {
  if (points.length === 0) return null;

  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < points.length; index += 1) {
    const distance = Math.abs(points[index].left - left);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  return nearestIndex;
}

function useElementSize<T extends HTMLElement>() {
  const ref = React.useRef<T | null>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });

  React.useEffect(() => {
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
  }, []);

  return { ref, size };
}

function CompactionMarker({
  cx = 0,
  cy = 0,
  payload,
  selected,
  onSelect,
}: {
  cx?: number;
  cy?: number;
  payload?: CompactionMarkerDatum;
  selected: boolean;
  onSelect?: (impact: CompactionImpact) => void;
}) {
  if (!payload) return null;

  const stroke = selected ? '#f59e0b' : '#f97316';
  const fill = selected ? '#f59e0b' : '#0A0A0C';
  const markerY = Math.max(12, cy - 12);
  const lineEndY = Math.max(16, markerY - 8);

  return (
    <g
      className="cursor-pointer"
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.(payload);
      }}
    >
      <line
        x1={cx}
        x2={cx}
        y1={8}
        y2={lineEndY}
        stroke={stroke}
        strokeWidth={selected ? 2 : 1}
        strokeDasharray="3 3"
        opacity={selected ? 0.95 : 0.7}
      />
      <path
        d={`M ${cx} ${markerY - 7} L ${cx + 7} ${markerY} L ${cx} ${markerY + 7} L ${cx - 7} ${markerY} Z`}
        fill={fill}
        stroke={stroke}
        strokeWidth={selected ? 2 : 1.5}
      />
    </g>
  );
}

export default function TokenArcChart({
  data,
  compactions = [],
  onSelectSnapshot,
  onSelectCompaction,
  selectedCompactionEventIndex = null,
  selectedTokenEventIndex = null,
}: TokenArcChartProps) {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const [hoveredTokenIndex, setHoveredTokenIndex] = React.useState<number | null>(null);
  const compactionMarkers = React.useMemo(() => {
    if (data.length === 0 || compactions.length === 0) return [];

    const snapshotsByEventIndex = new Map<number, TokenSnapshot>();
    for (const snapshot of data) {
      if (typeof snapshot.eventIndex === 'number') {
        snapshotsByEventIndex.set(snapshot.eventIndex, snapshot);
      }
    }

    return compactions.flatMap((impact) => {
      const afterSnapshot =
        typeof impact.after_event_index === 'number'
          ? snapshotsByEventIndex.get(impact.after_event_index)
          : undefined;
      const beforeSnapshot =
        typeof impact.before_event_index === 'number'
          ? snapshotsByEventIndex.get(impact.before_event_index)
          : undefined;
      const anchorSnapshot = afterSnapshot ?? beforeSnapshot;

      if (!anchorSnapshot || typeof anchorSnapshot.totalTokens !== 'number') {
        return [];
      }

      return [{
        ...impact,
        id: `compaction-${impact.compaction_event_index}`,
        timestamp: anchorSnapshot.timestamp,
        totalTokens: anchorSnapshot.totalTokens,
      }];
    });
  }, [compactions, data]);
  const overlayState = React.useMemo(() => {
    const plotWidth = size.width - CHART_MARGIN.left - CHART_MARGIN.right;
    const plotHeight = size.height - CHART_MARGIN.top - CHART_MARGIN.bottom;
    const maxTokens = Math.max(0, ...data.map((point) => point.totalTokens));
    const domainMax = Math.max(1, maxTokens + 10000);

    const positionForPoint = (point: TokenSnapshot, index: number, total: number): OverlayPoint => {
      const xRatio = total <= 1 ? 1 : index / (total - 1);
      const yRatio = 1 - Math.min(1, Math.max(0, point.totalTokens / domainMax));
      return {
        id: `${point.eventIndex ?? index}`,
        left: CHART_MARGIN.left + (plotWidth * xRatio),
        top: CHART_MARGIN.top + (plotHeight * yRatio),
        eventIndex: point.eventIndex,
      };
    };

    const tokenPositions = data.map((point, index) => positionForPoint(point, index, data.length));
    const tokenPositionByEventIndex = new Map<number, OverlayPoint>();
    for (let index = 0; index < data.length; index += 1) {
      const eventIndex = data[index]?.eventIndex;
      const point = tokenPositions[index];
      if (typeof eventIndex === 'number' && point) tokenPositionByEventIndex.set(eventIndex, point);
    }

    const compactionPositions = compactionMarkers.flatMap((impact) => {
      const afterPoint =
        typeof impact.after_event_index === 'number'
          ? tokenPositionByEventIndex.get(impact.after_event_index)
          : undefined;
      const beforePoint =
        typeof impact.before_event_index === 'number'
          ? tokenPositionByEventIndex.get(impact.before_event_index)
          : undefined;
      const anchor = afterPoint ?? beforePoint;
      if (!anchor) return [];
      return [{
        id: impact.id,
        left: anchor.left,
        top: anchor.top,
        compactionEventIndex: impact.compaction_event_index,
      }];
    });

    return { tokenPositions, compactionPositions };
  }, [compactionMarkers, data, size.height, size.width]);
  const selectedTokenPosition = React.useMemo(() => {
    if (typeof selectedTokenEventIndex !== 'number') return null;
    const selectedIndex = data.findIndex((point) => point.eventIndex === selectedTokenEventIndex);
    if (selectedIndex < 0) return null;
    return overlayState.tokenPositions[selectedIndex] ?? null;
  }, [data, overlayState.tokenPositions, selectedTokenEventIndex]);
  const hoveredTokenPosition = hoveredTokenIndex !== null
    ? overlayState.tokenPositions[hoveredTokenIndex] ?? null
    : null;
  const activeTokenPosition = hoveredTokenPosition ?? selectedTokenPosition;
  const plotHeight = Math.max(0, size.height - CHART_MARGIN.top - CHART_MARGIN.bottom);
  const renderCompactionMarker = React.useCallback((props: unknown) => {
    const marker = props as { cx?: number; cy?: number; payload?: CompactionMarkerDatum };
    const payload = marker.payload;
    return (
      <CompactionMarker
        cx={marker.cx}
        cy={marker.cy}
        payload={payload}
        selected={payload?.compaction_event_index === selectedCompactionEventIndex}
        onSelect={onSelectCompaction}
      />
    );
  }, [onSelectCompaction, selectedCompactionEventIndex]);
  const resolveSnapshotFromPointer = React.useCallback((clientX: number) => {
    const node = ref.current;
    if (!node) return null;

    const bounds = node.getBoundingClientRect();
    const localLeft = clientX - bounds.left;
    const nearestIndex = findNearestTokenIndex(localLeft, overlayState.tokenPositions);
    if (nearestIndex === null) return null;

    return {
      index: nearestIndex,
      point: overlayState.tokenPositions[nearestIndex] ?? null,
      snapshot: data[nearestIndex] ?? null,
    };
  }, [data, overlayState.tokenPositions, ref]);
  const handlePlotPointerMove = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const resolved = resolveSnapshotFromPointer(event.clientX);
    if (!resolved) return;

    setHoveredTokenIndex((current) => (current === resolved.index ? current : resolved.index));
  }, [resolveSnapshotFromPointer]);
  const handlePlotPointerLeave = React.useCallback(() => {
    setHoveredTokenIndex(null);
  }, []);
  const handlePlotClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const resolved = resolveSnapshotFromPointer(event.clientX);
    if (!resolved?.snapshot) return;

    onSelectSnapshot?.(resolved.snapshot);
  }, [onSelectSnapshot, resolveSnapshotFromPointer]);

  return (
    <div
      ref={ref}
      className="relative h-full w-full min-w-0 min-h-0"
      style={{ cursor: onSelectSnapshot || onSelectCompaction ? 'pointer' : 'default' }}
    >
      {size.width > 0 && size.height > 0 && (
        <ComposedChart
          width={size.width}
          height={size.height}
          data={data}
          margin={CHART_MARGIN}
        >
          <defs>
            <linearGradient id="tokenGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2A2A2E" />
          <XAxis dataKey="timestamp" hide />
          <YAxis hide domain={[0, 'dataMax + 10000']} />
          <Tooltip
            contentStyle={{
              background: '#0A0A0C',
              border: '1px solid #2A2A2E',
              borderRadius: '4px',
              fontSize: '10px',
            }}
            labelFormatter={(label) => formatFullDate(String(label))}
          />
          <Area
            type="monotone"
            dataKey="totalTokens"
            stroke="#3b82f6"
            fill="url(#tokenGrad)"
            strokeWidth={1}
            activeDot={{ r: 4, stroke: '#0A0A0C', strokeWidth: 1, fill: '#f59e0b' }}
          />
          {compactionMarkers.length > 0 && (
            <Scatter
              data={compactionMarkers}
              dataKey="totalTokens"
              shape={renderCompactionMarker}
            />
          )}
        </ComposedChart>
      )}
      {size.width > 0 && size.height > 0 && (
        <div className="pointer-events-none absolute inset-0">
          <div
            data-testid="token-axis-overlay"
            className="absolute inset-0 pointer-events-auto"
            onMouseMove={handlePlotPointerMove}
            onMouseLeave={handlePlotPointerLeave}
            onClick={handlePlotClick}
          />
          {activeTokenPosition && (
            <div
              className="absolute w-px -translate-x-1/2 bg-sky-400/70 shadow-[0_0_16px_rgba(56,189,248,0.45)]"
              style={{
                left: activeTokenPosition.left,
                top: CHART_MARGIN.top,
                height: plotHeight,
              }}
            />
          )}
          {activeTokenPosition && (
            <>
              <div
                className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-sky-300/60 bg-sky-400/15 shadow-[0_0_18px_rgba(56,189,248,0.32)]"
                style={{
                  left: activeTokenPosition.left,
                  top: activeTokenPosition.top,
                }}
              />
              <div
                className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#0A0A0C] bg-sky-300 shadow-[0_0_12px_rgba(125,211,252,0.55)]"
                style={{
                  left: activeTokenPosition.left,
                  top: activeTokenPosition.top,
                }}
              />
            </>
          )}
          {overlayState.compactionPositions.map((point) => {
            const impact = compactions.find((item) => item.compaction_event_index === point.compactionEventIndex);
            if (!impact) return null;
            return (
              <button
                key={point.id}
                type="button"
                aria-label={`Jump to compaction event ${impact.compaction_event_index + 1}`}
                className="absolute z-10 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-auto"
                style={{ left: point.left, top: point.top }}
                onClick={() => onSelectCompaction?.(impact)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
