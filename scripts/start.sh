#!/bin/bash
# LogosPulse 시작 스크립트

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOGOS_ROOT="$(dirname "$PROJECT_DIR")"
PORT=8095

cd "$PROJECT_DIR"

# 가상환경
if [ -f "$LOGOS_ROOT/.venv/bin/activate" ]; then
    source "$LOGOS_ROOT/.venv/bin/activate"
fi

# 포트 확인 — LISTEN 소켓만 본다.
# `lsof -i :PORT` 는 이 포트로 향하는 '클라이언트 연결'까지 잡아서(예: 브라우저
# 탭이 열어둔 ESTABLISHED/CLOSE_WAIT), 서버가 죽어 있는데도 "사용 중"으로
# 오판해 재기동을 막았다 (2026-07-19 실측).
if lsof -i :$PORT -sTCP:LISTEN > /dev/null 2>&1; then
    echo "⚠️  포트 $PORT 이미 사용 중 (LISTEN)"
    exit 1
fi

# 잔여 프로세스 정리 — 종료가 LearningLoop 백그라운드 작업에 막혀 좀비가
# 쌓이면(실측 8개) 포트를 쥔 채 매달린다. 포트로 한정해 안전하게 정리.
STALE=$(pgrep -f "uvicorn app.main:app.*--port $PORT" 2>/dev/null)
if [ -n "$STALE" ]; then
    echo "🧹 잔여 프로세스 정리: $STALE"
    echo "$STALE" | xargs kill -9 2>/dev/null
    sleep 1
fi

echo "💓 LogosPulse 시작 중... (포트: $PORT)"
# 세션 분리 실행 — nohup 만으로는 다른 창의 세션 정리 시 SIGTERM 으로
# 함께 죽었다 (2026-07-19 실측). scripts/daemonize.sh 가 새 세션을 만든다.
"$LOGOS_ROOT/scripts/daemonize.sh" "$PROJECT_DIR/logs/logos_pulse.log" \
    uvicorn app.main:app --host 0.0.0.0 --port $PORT \
        --timeout-graceful-shutdown 10 > logs/logos_pulse.pid

sleep 3
if curl -s http://localhost:$PORT/health > /dev/null 2>&1; then
    echo "✅ LogosPulse API 시작 완료 (PID: $(cat logs/logos_pulse.pid))"
else
    echo "⚠️  API 시작 대기 중..."
fi

# ── 프론트엔드(8096) ──────────────────────────────────────────────────────
# 기존엔 UI 시작 스크립트가 없어 매번 수동 실행이었다 (2026-07-19 신설).
# 실행 모드는 기본 production — dev 서버(Turbopack)는 개당 500MB~1.5GB 를
# 써서, Next 앱 3개를 dev 로 띄우면 16GB 머신이 스왑으로 몰리고 macOS
# jetsam 이 Node 서비스만 골라 죽였다. HMR 필요시 PULSE_UI_DEV=true
UI_PORT=8096
UI_DIR="$PROJECT_DIR/frontend"
if [ -d "$UI_DIR" ]; then
    if lsof -i :$UI_PORT -sTCP:LISTEN > /dev/null 2>&1; then
        echo "⚠️  포트 $UI_PORT 이미 사용 중 (UI 기동 생략)"
    else
        cd "$UI_DIR"
        if [ "${PULSE_UI_DEV:-}" = "true" ]; then
            UI_CMD_ARGS=(npm run dev -- -p $UI_PORT)
        else
            if [ ! -d ".next" ]; then
                echo "   📦 UI 빌드 산출물이 없어 먼저 빌드합니다 (최초 1회)..."
                npm run build >> "$PROJECT_DIR/logs/frontend.log" 2>&1 || {
                    echo "   ❌ UI 빌드 실패"; exit 1; }
            fi
            UI_CMD_ARGS=(npm run start -- -p $UI_PORT)
        fi
        UI_PID=$("$LOGOS_ROOT/scripts/daemonize.sh" \
            "$PROJECT_DIR/logs/frontend.log" "${UI_CMD_ARGS[@]}")
        echo "$UI_PID" > "$PROJECT_DIR/logs/frontend.pid"
        echo "🖥️  LogosPulse UI 시작 (PID: $UI_PID, 포트: $UI_PORT)"
        cd "$PROJECT_DIR"
    fi
fi
