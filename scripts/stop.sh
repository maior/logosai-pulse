#!/bin/bash
# LogosPulse 정지 스크립트 (2026-07-19 신설)
#
# 배경: 정지 스크립트가 없어 매번 수동 kill 에 의존했고, LearningLoop 백그라운드
# 작업이 graceful shutdown 을 막아("Waiting for background tasks to complete")
# 프로세스가 포트를 쥔 채 매달렸다. 실측으로 좀비 8개까지 누적.
# → PID 파일 → LISTEN 포트 → 포트-한정 pkill 3단계로 확실히 정리한다.
#
# ⚠️ kill 패턴은 반드시 --port 로 한정할 것. logos_api 도 동일하게
#    `uvicorn app.main:app` 로 뜨기 때문에, 포트 없는 패턴은 logos_api 를 함께 죽인다.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PORT=8095
PID_FILE="$PROJECT_DIR/logs/logos_pulse.pid"

echo "🛑 LogosPulse 정지 중... (포트: $PORT)"

# 1) PID 파일
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE" 2>/dev/null)
    if [ -n "$PID" ] && ps -p "$PID" > /dev/null 2>&1; then
        kill "$PID" 2>/dev/null
        sleep 2
        ps -p "$PID" > /dev/null 2>&1 && kill -9 "$PID" 2>/dev/null
        echo "✅ PID $PID 종료됨"
    fi
    rm -f "$PID_FILE"
fi

# 2) LISTEN 소켓 점유 프로세스 (클라이언트 연결은 제외 — -sTCP:LISTEN)
PIDS=$(lsof -t -i :$PORT -sTCP:LISTEN 2>/dev/null)
if [ -n "$PIDS" ]; then
    echo "포트 $PORT LISTEN 프로세스 종료: $PIDS"
    echo "$PIDS" | xargs kill 2>/dev/null
    sleep 2
    PIDS=$(lsof -t -i :$PORT -sTCP:LISTEN 2>/dev/null)
    [ -n "$PIDS" ] && echo "$PIDS" | xargs kill -9 2>/dev/null
fi

# 3) 잔여 프로세스 (포트 한정 — logos_api 보호)
pkill -9 -f "uvicorn app.main:app.*--port $PORT" 2>/dev/null

sleep 1
if lsof -i :$PORT -sTCP:LISTEN > /dev/null 2>&1; then
    echo "⚠️  포트 $PORT 아직 점유 중"
else
    echo "✅ LogosPulse 정지 완료"
fi
