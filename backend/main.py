"""
ImpactAI backend — frame extraction for coaching/visual analysis + GolfCourseAPI proxy.
"""
from __future__ import annotations

import base64
import os
import tempfile
from pathlib import Path

import cv2
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from golf_api import register_golf_routes
from video_frames import detect_audio_impact, open_video, preprocess_frame, resize_for_ai

load_dotenv(Path(__file__).resolve().parent / ".env")

app = FastAPI(title="ImpactAI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

register_golf_routes(app)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/extract-frames")
async def extract_frames(
    video: UploadFile = File(...),
    frameCount: int = Form(8),
    mode: str = Form("analysis"),
):
    """
    Extract evenly-spaced JPEG frames with OpenCV.

    Modes:
      • analysis        — few frames for LLM coaching (trim 8% head/tail)
      • phaseDetection  — dense frames + motion + optional audio impact hint
    """
    if mode not in ("analysis", "phaseDetection"):
        mode = "analysis"

    if mode == "phaseDetection":
        frameCount = max(24, min(120, frameCount))
        lo_pct, hi_pct = 0.02, 0.98
        max_side = 384
        jpeg_q = 55
    else:
        frameCount = max(4, min(12, frameCount))
        lo_pct, hi_pct = 0.08, 0.92
        max_side = 640
        jpeg_q = 72

    tmp_path = None
    cleanup_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            tmp.write(await video.read())
            tmp_path = tmp.name

        cap, _, cleanup_path = open_video(tmp_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
        duration_ms = int((total_frames / max(fps, 1.0)) * 1000) if total_frames > 0 else 0
        print(
            f"[extract-frames] mode={mode} requested={frameCount} "
            f"total_frames={total_frames} fps={fps:.2f}"
        )
        if total_frames <= 0:
            cap.release()
            return {
                "frames": [],
                "mode": mode,
                "fps": fps,
                "total_frames": 0,
                "duration_ms": 0,
                "lo_pct": lo_pct,
                "hi_pct": hi_pct,
            }

        count = min(frameCount, total_frames)
        lo = int(total_frames * lo_pct)
        hi = int(total_frames * hi_pct)
        span = max(1, hi - lo)
        indices = [lo + int(i * span / max(count - 1, 1)) for i in range(count)]
        frames_b64: list[str] = []
        motion: list[float] = []
        prev_gray = None
        motion_h = 90

        for idx in indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, min(idx, total_frames - 1)))
            ret, frame = cap.read()
            if not ret:
                continue
            processed = preprocess_frame(frame) if mode == "analysis" else frame
            small = resize_for_ai(processed, max_side=max_side)
            _, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, jpeg_q])
            frames_b64.append(base64.b64encode(buf).decode("utf-8"))

            if mode == "phaseDetection":
                h0, w0 = frame.shape[:2]
                if h0 > 0:
                    sw = max(1, int(w0 * motion_h / h0))
                    tiny = cv2.resize(frame, (sw, motion_h), interpolation=cv2.INTER_AREA)
                    gray = cv2.cvtColor(tiny, cv2.COLOR_BGR2GRAY)
                    if prev_gray is None or prev_gray.shape != gray.shape:
                        motion.append(0.0)
                    else:
                        diff = cv2.absdiff(gray, prev_gray)
                        motion.append(float(diff.mean()))
                    prev_gray = gray
                else:
                    motion.append(0.0)

        cap.release()

        audio_impact_out = None
        if mode == "phaseDetection":
            ai = detect_audio_impact(tmp_path, fps, total_frames, lo_pct, hi_pct)
            if ai and indices:
                dense_idx = int(min(range(len(indices)), key=lambda i: abs(indices[i] - ai["frame_idx"])))
                audio_impact_out = {
                    "frameIdx": int(ai["frame_idx"]),
                    "denseIdx": dense_idx,
                    "timeMs": int(ai["time_ms"]),
                    "confidence": float(ai["confidence"]),
                    "peakToMedianRatio": float(ai["peak_to_median_ratio"]),
                }

        if mode == "analysis":
            sizes = [len(f) for f in frames_b64]
            print(f"[extract-frames] returning {len(frames_b64)} analysis frames, sizes: {sizes}")
        else:
            avg = sum(len(f) for f in frames_b64) // max(len(frames_b64), 1)
            mx = max(motion) if motion else 0.0
            mn = min(motion) if motion else 0.0
            ai_tag = (
                f" audio_impact_dense={audio_impact_out['denseIdx']} "
                f"conf={audio_impact_out['confidence']:.2f}"
                if audio_impact_out
                else ""
            )
            print(
                f"[extract-frames] returning {len(frames_b64)} phaseDetection frames, "
                f"avg_size={avg} motion_range=[{mn:.2f},{mx:.2f}]{ai_tag}"
            )

        return {
            "frames": frames_b64,
            "mode": mode,
            "fps": fps,
            "total_frames": total_frames,
            "duration_ms": duration_ms,
            "lo_pct": lo_pct,
            "hi_pct": hi_pct,
            "motion": motion,
            "audio_impact": audio_impact_out,
        }

    except Exception as e:
        print(f"[extract-frames] error: {e}")
        return {"frames": [], "mode": mode}
    finally:
        for p in [tmp_path, cleanup_path]:
            if p and os.path.exists(p):
                os.remove(p)
