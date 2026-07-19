"""종료 차단 회귀 테스트 (2026-07-19).

배경: 2026-07-15 Pulse 가 SIGTERM 을 받고도 종료되지 못했다.
      열려 있던 SSE 연결(무한 while True) 때문에 uvicorn 의 graceful shutdown 이
      무한 대기 → lifespan shutdown 미실행 → LearningLoop 만 451 사이클 계속.
      포트는 닫혔으므로 프로세스는 '살아있으나 아무것도 서빙 못 하는' 상태로
      3일간 방치됐고 그동안 메트릭이 전량 유실됐다.

크래시보다 나쁘다 — 프로세스 감시로는 정상으로 보인다.

직접 실행: python tests/test_shutdown_resilience.py
"""

import os
import signal
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UVICORN = os.path.join(os.path.dirname(PROJECT_DIR), ".venv", "bin", "uvicorn")
PORT = 8099   # 운영 인스턴스(8095) 를 건드리지 않는다


def _start(extra_env=None, extra_args=()):
    env = {**os.environ, "LOGOS_PULSE_LEARNING_LOOP": "false", **(extra_env or {})}
    proc = subprocess.Popen(
        [UVICORN, "app.main:app", "--port", str(PORT), *extra_args],
        cwd=PROJECT_DIR, env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(40):                      # 기동 대기
        try:
            urllib.request.urlopen(f"http://localhost:{PORT}/health", timeout=1)
            return proc
        except Exception:
            time.sleep(0.5)
    proc.kill()
    raise RuntimeError("테스트 서버 기동 실패")


def _open_sse():
    """SSE 연결을 열어둔 채로 둔다 (읽지 않고 방치 — 브라우저 탭과 같은 상태)."""
    return subprocess.Popen(
        ["curl", "-s", "-N", "-m", "120", f"http://localhost:{PORT}/api/v1/stream"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def _cleanup(*procs):
    for p in procs:
        if p and p.poll() is None:
            p.kill()
            try:
                p.wait(timeout=5)
            except Exception:
                pass


# ── 테스트 ────────────────────────────────────────────────
def test_shutdown_completes_with_open_sse():
    """SSE 가 열려 있어도 SIGTERM 으로 종료돼야 한다 — 07-15 사고의 직접 재현."""
    server = _start(extra_args=("--timeout-graceful-shutdown", "10"))
    sse = None
    try:
        sse = _open_sse()
        time.sleep(3)                        # 연결 확립

        server.send_signal(signal.SIGTERM)
        exited = None
        for _ in range(30):                  # 최대 15초 관찰
            if server.poll() is not None:
                exited = True
                break
            time.sleep(0.5)

        assert exited, (
            "SSE 가 열려 있으면 종료되지 않는다 — 포트만 닫힌 채 좀비로 남아 "
            "메트릭이 전량 유실된다 (2026-07-15 재현)"
        )
        print("PASS shutdown_completes_with_open_sse")
    finally:
        _cleanup(sse, server)


def test_sse_stream_terminates_on_its_own():
    """스트림은 무한히 열려 있으면 안 된다 — 수명 상한 뒤 스스로 끝난다."""
    server = _start(extra_env={"LOGOS_PULSE_SSE_MAX_SECONDS": "3"})
    try:
        started = time.monotonic()
        with urllib.request.urlopen(
            f"http://localhost:{PORT}/api/v1/stream", timeout=30
        ) as resp:
            while resp.read(1):              # 서버가 끊을 때까지 읽는다
                if time.monotonic() - started > 20:
                    raise AssertionError("스트림이 상한을 넘겨도 끝나지 않음")
        elapsed = time.monotonic() - started

        assert elapsed < 15, f"수명 상한 미적용 (경과 {elapsed:.1f}s)"
        print(f"PASS sse_stream_terminates_on_its_own ({elapsed:.1f}s)")
    finally:
        _cleanup(server)


def test_normal_shutdown_still_clean():
    """SSE 가 없을 때의 정상 종료가 깨지지 않아야 한다 (회귀 방지)."""
    server = _start(extra_args=("--timeout-graceful-shutdown", "10"))
    try:
        server.send_signal(signal.SIGTERM)
        for _ in range(20):
            if server.poll() is not None:
                break
            time.sleep(0.5)
        assert server.poll() is not None, "SSE 없이도 종료 실패"
        print("PASS normal_shutdown_still_clean")
    finally:
        _cleanup(server)


def test_start_script_sets_graceful_timeout():
    """운영 기동 스크립트에 상한이 실제로 걸려 있어야 한다.

    위 두 테스트는 인자를 직접 넘기므로 '메커니즘'만 검증한다.
    운영 경로(start.sh)에 반영되지 않으면 사고는 그대로 재발한다.
    """
    with open(os.path.join(PROJECT_DIR, "scripts", "start.sh")) as f:
        script = f.read()
    assert "--timeout-graceful-shutdown" in script, (
        "start.sh 에 --timeout-graceful-shutdown 없음 — "
        "SSE 가 열려 있으면 좀비로 남는다"
    )
    print("PASS start_script_sets_graceful_timeout")


if __name__ == "__main__":
    test_start_script_sets_graceful_timeout()
    test_normal_shutdown_still_clean()
    test_shutdown_completes_with_open_sse()
    test_sse_stream_terminates_on_its_own()
    print("\n✅ 종료 회복력 테스트 3/3 통과")
