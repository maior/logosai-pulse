'use client';

/**
 * Traffic & Latency Trend — 공유 X축 스몰 멀티플.
 *
 * 이전 버전은 스케일이 다른 두 측정치(응답 수천 ms vs 호출 수 개)를 한 y축에
 * 겹쳐 calls가 바닥에 눌린 평평한 선이었다. 측정치마다 패널을 분리하되
 * 시간축을 공유해 "트래픽이 몰릴 때 지연이 어떻게 변하나"를 세로로 대조한다.
 */

import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';

interface TrendPoint {
  hour: string;
  calls: number;
  avg_duration_ms: number;
  cost_usd: number;
}

const TOOLTIP = {
  contentStyle: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, fontSize: 11, padding: '6px 10px' },
  labelStyle: { color: '#cbd5e1', fontSize: 11 },
};
const AXIS_TICK = { fill: '#64748b', fontSize: 10 };

function fmtMs(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
}

export function TrendChart({ trend }: { trend: TrendPoint[] }) {
  const data = (trend || []).map(t => ({
    time: t.hour ? new Date(t.hour).toLocaleTimeString('ko', { hour: '2-digit', minute: '2-digit' }) : '',
    calls: t.calls || 0,
    duration: Math.round(t.avg_duration_ms || 0),
  }));

  const peak = data.reduce((m, d) => Math.max(m, d.calls), 0);
  const worst = data.reduce((m, d) => Math.max(m, d.duration), 0);

  return (
    <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Traffic &amp; Latency Trend</h3>
        <span className="text-[10px] text-slate-600 tabular-nums">
          peak {peak} calls · worst {fmtMs(worst)}
        </span>
      </div>

      {data.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-slate-600 text-xs">No data</div>
      ) : (
        <div className="p-4 pt-3 space-y-1">
          {/* 패널 1 — 호출량 (건수는 막대가 정직) */}
          <div>
            <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-[2px] bg-cyan-400/85 inline-block" />Calls / hour
            </div>
            <ResponsiveContainer width="100%" height={92}>
              <BarChart data={data} margin={{ top: 2, right: 8, left: 0, bottom: 0 }} barCategoryGap="35%">
                <XAxis dataKey="time" hide />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={34} allowDecimals={false} />
                <Tooltip {...TOOLTIP} cursor={{ fill: '#1e293b', fillOpacity: 0.35 }}
                         formatter={(v: any) => [`${v}건`, 'Calls']} />
                <Bar dataKey="calls" fill="#22d3ee" fillOpacity={0.8} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* 패널 2 — 평균 응답시간 (연속 추이는 라인) · X축은 여기서만 표기 */}
          <div>
            <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1 flex items-center gap-1.5">
              <span className="w-3 h-[2px] bg-indigo-400 inline-block" />Avg response
            </div>
            <ResponsiveContainer width="100%" height={110}>
              <LineChart data={data} margin={{ top: 2, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="time" tick={AXIS_TICK} axisLine={{ stroke: '#1e293b' }} tickLine={false} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={34}
                       tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}s` : `${v}`)} />
                <Tooltip {...TOOLTIP} cursor={{ stroke: '#334155', strokeDasharray: '3 3' }}
                         formatter={(v: any) => [fmtMs(Number(v)), 'Avg']} />
                <Line type="monotone" dataKey="duration" stroke="#818cf8" strokeWidth={2}
                      dot={false} activeDot={{ r: 3.5, strokeWidth: 0 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
