import React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatFullDate } from '../lib/utils';
import { TokenSnapshot } from '../types';

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

export default function TokenArcChart({ data }: { data: TokenSnapshot[] }) {
  const { ref, size } = useElementSize<HTMLDivElement>();

  return (
    <div ref={ref} className="h-full w-full min-w-0 min-h-0">
      {size.width > 0 && size.height > 0 && (
        <AreaChart
          width={size.width}
          height={size.height}
          data={data}
          margin={{ top: 5, right: 0, left: -20, bottom: 0 }}
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
          <Area type="monotone" dataKey="totalTokens" stroke="#3b82f6" fill="url(#tokenGrad)" strokeWidth={1} />
        </AreaChart>
      )}
    </div>
  );
}
