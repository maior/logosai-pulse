'use client';

/**
 * LearningTab — 자율 학습(Self-Evolution) 루프 모니터링.
 *
 * 이 탭이 보여주는 것: LogosAI 에이전트가 스스로 성능을 감시하고,
 * 실패 패턴을 감지해 FORGE 로 자동 개선하는 자율 진화 파이프라인.
 *
 * 구성: 파이프라인 다이어그램(무엇을 하는지) → 성과 KPI → 에이전트 건강 → 개선 이력.
 * 데이터: /api/v1/learning/{status,summary,health-report,history}
 */

import { useState, useEffect, useCallback } from 'react';

const API = process.env.NEXT_PUBLIC_PULSE_API || 'http://localhost:8095';

const HEALTH_TONE: Record<string, { dot: string; label: string }> = {
  healthy: { dot: 'bg-emerald-400', label: '정상' },
  warning: { dot: 'bg-amber-400', label: '주의' },
  degraded: { dot: 'bg-orange-400', label: '저하' },
  critical: { dot: 'bg-rose-400', label: '위험' },
};

// 자율 학습 파이프라인 5단계 (CLAUDE.md 피드백 루프)
const STAGES = [
  { key: 'monitor', label: '성능 감시', desc: '실행·성공률·피드백 수집' },
  { key: 'detect', label: '실패 감지', desc: '실패율·약한 에이전트 식별' },
  { key: 'analyze', label: '패턴 분석', desc: '실패 원인 클러스터링' },
  { key: 'improve', label: 'FORGE 개선', desc: '코드 자동 수정·재생성' },
  { key: 'deploy', label: 'Shadow·배포', desc: '검증 후 배포 / 롤백' },
];

function fmtMs(ms: number): string {
  if (!ms) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

// ── 학습 파이프라인 다이어그램 (무엇을 하는 시스템인지 한눈에) ──
function Pipeline({ running, activeStage }: { running: boolean; activeStage: number }) {
  return (
    <div className="flex items-stretch gap-1.5 overflow-x-auto pb-1">
      {STAGES.map((s, i) => {
        const active = running && i === activeStage;
        return (
          <div key={s.key} className="flex items-center gap-1.5 shrink-0">
            <div className={`rounded-lg border px-3 py-2.5 min-w-[124px] transition-colors ${
              active ? 'border-indigo-400/60 bg-indigo-500/10'
                     : 'border-slate-800 bg-slate-900/40'}`}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-indigo-400 animate-pulse' : 'bg-slate-600'}`} />
                <span className={`text-[11px] font-semibold ${active ? 'text-indigo-200' : 'text-slate-300'}`}>{s.label}</span>
              </div>
              <div className="text-[9.5px] text-slate-500 leading-snug">{s.desc}</div>
            </div>
            {i < STAGES.length - 1 && <span className="text-slate-700 text-xs">→</span>}
          </div>
        );
      })}
    </div>
  );
}

function Kpi({ label, value, sub, tip, accent }: { label: string; value: string; sub: string; tip?: string; accent?: string }) {
  return (
    <div className="border border-slate-800 bg-slate-900/30 rounded-lg px-4 py-3.5" title={tip}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 font-medium">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums tracking-tight ${accent || 'text-slate-100'}`}>{value}</div>
      <div className="text-[11px] text-slate-500 mt-1">{sub}</div>
    </div>
  );
}

export function LearningTab() {
  const [status, setStatus] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [healthReport, setHealthReport] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [triggering, setTriggering] = useState(false);

  const refresh = useCallback(() => {
    Promise.all([
      fetch(`${API}/api/v1/learning/status`).then(r => r.json()).catch(() => null),
      fetch(`${API}/api/v1/learning/summary`).then(r => r.json()).catch(() => null),
      fetch(`${API}/api/v1/learning/health-report?period=24h`).then(r => r.json()).catch(() => []),
      fetch(`${API}/api/v1/learning/history`).then(r => r.json()).catch(() => []),
    ]).then(([s, sum, hr, h]) => {
      setStatus(s); setSummary(sum);
      setHealthReport(Array.isArray(hr) ? hr : []);
      setHistory(Array.isArray(h) ? h : []);
    });
  }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 15000); return () => clearInterval(t); }, [refresh]);

  const handleTrigger = async () => {
    setTriggering(true);
    try { await fetch(`${API}/api/v1/learning/trigger`, { method: 'POST' }).then(r => r.json()); refresh(); }
    finally { setTriggering(false); }
  };

  const running = !!status?.running;
  const cycles = status?.cycles_completed || 0;
  const satisfaction = summary?.feedback?.satisfaction;
  const satPct = satisfaction != null ? Math.round(satisfaction * 100) : null;
  const health = summary?.agent_health || {};
  const fb = summary?.feedback || {};

  return (
    <div className="space-y-4">
      {/* 헤더 — 이 탭이 무엇인지 명시 */}
      <div className="border border-slate-800 bg-slate-900/30 rounded-lg p-4">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              자율 학습 <span className="text-slate-500 font-normal">Self-Evolution</span>
            </h2>
            <p className="text-[12px] text-slate-500 mt-0.5 max-w-2xl leading-relaxed">
              에이전트가 스스로 성능을 감시하고, 실패 패턴을 감지해 FORGE 로 코드를 자동 개선한 뒤
              검증(Shadow Test)을 거쳐 배포합니다. 아래는 그 진화 파이프라인의 실시간 상태입니다.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border ${
              running ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
                      : 'text-slate-400 border-slate-700 bg-slate-800/40'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${running ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
              {running ? '가동 중' : '중지'}
            </span>
            <button onClick={handleTrigger} disabled={triggering}
                    className="text-[11px] font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 px-3 py-1.5 rounded hover:bg-indigo-500/20 disabled:opacity-50 transition-colors">
              {triggering ? '실행 중…' : '지금 학습 실행'}
            </button>
          </div>
        </div>
        <Pipeline running={running} activeStage={0} />
      </div>

      {/* 성과 KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="학습 사이클" value={String(cycles)} sub="완료된 진화 주기"
             tip="백그라운드 학습 루프가 지금까지 완료한 감시→개선 주기 횟수" />
        <Kpi label="자동 개선" value={String(summary?.improvements_applied || 0)} sub="배포된 코드 수정"
             tip="FORGE 가 자동으로 수정·배포한 에이전트 개선 건수" />
        <Kpi label="감시 에이전트" value={String(summary?.agents_monitored || 0)} sub="추적 중인 에이전트"
             tip="성능·성공률을 실시간 추적 중인 에이전트 수" />
        <Kpi label="사용자 만족도" value={satPct != null ? `${satPct}%` : '—'}
             sub={`👍 ${fb.positive || 0}  👎 ${fb.negative || 0}`}
             tip="채팅 👍/👎 피드백 기반 만족도"
             accent={satPct == null ? 'text-slate-100' : satPct >= 80 ? 'text-emerald-300' : satPct >= 50 ? 'text-amber-300' : 'text-rose-300'} />
      </div>

      {/* 에이전트 건강 */}
      <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">에이전트 건강 (최근 24h)</h3>
          <div className="flex gap-3 text-[10px]">
            {Object.entries(HEALTH_TONE).map(([k, t]) => (
              (health[k] ?? 0) > 0 ? (
                <span key={k} className="flex items-center gap-1.5 text-slate-400">
                  <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />{t.label}
                  <span className="text-slate-200 tabular-nums">{health[k]}</span>
                </span>
              ) : null
            ))}
          </div>
        </div>
        <div className="p-4">
          {healthReport.length === 0 ? (
            <div className="text-xs text-slate-600 text-center py-8">감시 중인 에이전트 데이터 없음</div>
          ) : (
            <>
              <div className="grid grid-cols-[16px_minmax(0,1.4fr)_minmax(0,1.5fr)_56px_64px_72px] gap-2 text-[9px] uppercase tracking-wider text-slate-600 pb-2">
                <span></span><span>에이전트</span><span>성공률</span>
                <span className="text-right">추세</span><span className="text-right">지연</span><span className="text-right">피드백</span>
              </div>
              <div className="space-y-1.5">
                {healthReport.map(a => {
                  const pct = Math.round((a.current_success_rate ?? 0) * 100);
                  const bar = pct >= 90 ? 'bg-emerald-400/70' : pct >= 70 ? 'bg-amber-400/70' : 'bg-rose-400/70';
                  const trend = a.trend === 'improving'
                    ? { cls: 'text-emerald-300', txt: '↑ 개선' }
                    : a.trend === 'degrading' ? { cls: 'text-rose-300', txt: '↓ 저하' }
                    : { cls: 'text-slate-500', txt: '→ 안정' };
                  const tone = HEALTH_TONE[a.health] || HEALTH_TONE.healthy;
                  return (
                    <div key={a.agent_id} className="grid grid-cols-[16px_minmax(0,1.4fr)_minmax(0,1.5fr)_56px_64px_72px] gap-2 items-center text-[11px]">
                      <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} title={tone.label} />
                      <span className="text-slate-300 truncate font-mono">{a.agent_id.replace(/_agent$/, '')}</span>
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="flex-1 bg-slate-800/60 rounded h-1.5 overflow-hidden">
                          <span className={`block h-full rounded ${bar}`} style={{ width: `${pct}%` }} />
                        </span>
                        <span className="text-slate-400 tabular-nums w-9 text-right">{pct}%</span>
                      </span>
                      <span className={`text-right ${trend.cls}`}>{trend.txt}</span>
                      <span className="text-right tabular-nums text-slate-500">{fmtMs(a.avg_duration_ms)}</span>
                      <span className="text-right tabular-nums text-slate-500">
                        <span className="text-emerald-400/80">{a.feedback?.positive || 0}</span>
                        <span className="text-slate-700 mx-0.5">/</span>
                        <span className="text-rose-400/80">{a.feedback?.negative || 0}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 개선 이력 */}
      <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">자동 개선 이력</h3>
        </div>
        <div className="max-h-80 overflow-auto">
          {history.length === 0 ? (
            <div className="text-center py-10 px-4">
              <div className="text-xs text-slate-500 mb-1">아직 자동 개선이 없습니다</div>
              <div className="text-[11px] text-slate-600 leading-relaxed max-w-md mx-auto">
                에이전트 성공률이 임계치 아래로 떨어지면 학습 루프가 FORGE 로 자동 개선을 시도하고,
                여기에 개선 내역(대상 에이전트·수정 쿼리·시각)이 기록됩니다.
              </div>
            </div>
          ) : history.map((h, i) => (
            <div key={i} className="flex items-center gap-3 text-xs px-4 py-2.5 border-t border-slate-800/40">
              <span className="text-emerald-400">✓</span>
              <span className="text-slate-200 font-medium font-mono text-[11px]">{h.agent_id}</span>
              <span className="text-slate-500 flex-1 truncate">{h.query}</span>
              <span className="text-slate-600 tabular-nums shrink-0 font-mono text-[11px]">
                {h.created_at ? new Date(h.created_at).toLocaleString('ko', { hour12: false }) : ''}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
