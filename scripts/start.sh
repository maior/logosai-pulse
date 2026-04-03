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

# 포트 확인
if lsof -i :$PORT > /dev/null 2>&1; then
    echo "⚠️  포트 $PORT 이미 사용 중"
    exit 1
fi

echo "💓 LogosPulse 시작 중... (포트: $PORT)"
nohup uvicorn app.main:app --host 0.0.0.0 --port $PORT >> logs/logos_pulse.log 2>&1 &
echo $! > logs/logos_pulse.pid

sleep 3
if curl -s http://localhost:$PORT/health > /dev/null 2>&1; then
    echo "✅ LogosPulse 시작 완료 (PID: $(cat logs/logos_pulse.pid))"
else
    echo "⚠️  시작 대기 중..."
fi
