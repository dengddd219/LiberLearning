"""
手动集成测试：模拟前端向 /api/ws/live-asr 发送音频，打印实时转录结果。

用法：
  python test_live_asr.py [音频文件路径]

若不提供文件路径，使用 backend/test_documents/lec01/test_audio_1min.wav。
音频文件会先用 ffmpeg 转为 webm 格式，模拟浏览器 MediaRecorder 输出。
"""
import asyncio
import json
import os
import subprocess
import sys
import tempfile

import websockets

API_WS = "ws://localhost:8000/api/ws/live-asr"
CHUNK_MS = 250  # 与前端 MediaRecorder timeslice 一致


def find_test_audio() -> str:
    base = os.path.join(os.path.dirname(__file__), "test_documents", "lec01")
    return os.path.join(base, "test_audio_1min.wav")


def wav_to_webm(wav_path: str, out_path: str):
    """Convert WAV to WebM/Opus, simulating browser MediaRecorder output."""
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", wav_path, "-c:a", "libopus", "-f", "webm", out_path],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg conversion failed:\n{result.stderr}")


async def run_test(audio_path: str):
    print(f"Audio: {audio_path}")

    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        webm_path = tmp.name
    wav_to_webm(audio_path, webm_path)
    print(f"Converted to webm: {webm_path}")

    with open(webm_path, "rb") as f:
        webm_data = f.read()
    os.unlink(webm_path)

    # Split into ~250ms chunks; webm/opus ~16kbps → 250ms ≈ 500 bytes
    chunk_size = 500
    chunks = [webm_data[i:i + chunk_size] for i in range(0, len(webm_data), chunk_size)]
    print(f"Total chunks: {len(chunks)}, sending at {CHUNK_MS}ms intervals\n")

    async with websockets.connect(API_WS) as ws:
        print("WebSocket connected\n")

        async def send_chunks():
            for chunk in chunks:
                await ws.send(chunk)
                await asyncio.sleep(CHUNK_MS / 1000)
            await ws.close()

        async def recv_results():
            try:
                async for raw in ws:
                    msg = json.loads(raw)
                    if "error" in msg:
                        print(f"\n[ERROR] {msg['error']}")
                    elif msg.get("is_final"):
                        print(f"\n[FINAL] {msg['text']}")
                    else:
                        print(f"[inter] {msg['text']}", end="\r")
            except websockets.exceptions.ConnectionClosedOK:
                pass

        await asyncio.gather(send_chunks(), recv_results())

    print("\nDone.")


if __name__ == "__main__":
    audio = sys.argv[1] if len(sys.argv) > 1 else find_test_audio()
    asyncio.run(run_test(audio))
