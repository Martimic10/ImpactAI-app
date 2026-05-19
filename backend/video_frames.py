"""OpenCV + ffmpeg helpers for /extract-frames (no MediaPipe)."""
from __future__ import annotations

import os
import subprocess
import tempfile
from typing import Dict, Optional, Tuple

import cv2
import numpy as np

_FFMPEG_PATH: Optional[str] = None


def get_ffmpeg_path() -> Optional[str]:
    global _FFMPEG_PATH
    if _FFMPEG_PATH is not None:
        return _FFMPEG_PATH or None
    try:
        import imageio_ffmpeg  # type: ignore

        _FFMPEG_PATH = imageio_ffmpeg.get_ffmpeg_exe()
        return _FFMPEG_PATH
    except Exception:
        pass
    try:
        result = subprocess.run(["ffmpeg", "-version"], capture_output=True, timeout=2)
        if result.returncode == 0:
            _FFMPEG_PATH = "ffmpeg"
            return _FFMPEG_PATH
    except Exception:
        pass
    _FFMPEG_PATH = ""
    return None


def detect_audio_impact(
    video_path: str,
    fps: float,
    total_frames: int,
    lo_pct: float = 0.10,
    hi_pct: float = 0.92,
) -> Optional[Dict]:
    if fps <= 0 or total_frames <= 0:
        return None

    ffmpeg = get_ffmpeg_path()
    if not ffmpeg:
        print("[audio-impact] no ffmpeg available — skipping")
        return None

    wav_path = None
    try:
        wav_fd, wav_path = tempfile.mkstemp(suffix=".wav")
        os.close(wav_fd)
        cmd = [
            ffmpeg,
            "-y",
            "-i",
            video_path,
            "-ac",
            "1",
            "-ar",
            "22050",
            "-vn",
            "-f",
            "wav",
            wav_path,
        ]
        result = subprocess.run(cmd, capture_output=True, timeout=15)
        if result.returncode != 0:
            err = result.stderr[:200].decode("utf-8", errors="ignore") if result.stderr else "(no stderr)"
            print(f"[audio-impact] ffmpeg failed: {err}")
            return None

        import wave

        with wave.open(wav_path, "rb") as wf:
            sr = wf.getframerate()
            n_audio = wf.getnframes()
            sampwidth = wf.getsampwidth()
            audio_bytes = wf.readframes(n_audio)

        if sampwidth == 2:
            audio = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        elif sampwidth == 4:
            audio = np.frombuffer(audio_bytes, dtype=np.int32).astype(np.float32) / 2147483648.0
        elif sampwidth == 1:
            audio = (np.frombuffer(audio_bytes, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
        else:
            print(f"[audio-impact] unsupported sample width: {sampwidth}")
            return None

        if len(audio) < int(sr * 0.5):
            return None

        win = max(32, int(sr * 0.02))
        energy = audio * audio
        kernel = np.ones(win, dtype=np.float32) / float(win)
        smoothed = np.convolve(energy, kernel, mode="same")

        lo = max(0, int(len(smoothed) * lo_pct))
        hi = min(len(smoothed), int(len(smoothed) * hi_pct))
        if hi - lo < int(sr * 0.3):
            return None

        region = smoothed[lo:hi]
        peak_idx_in_region = int(np.argmax(region))
        peak_idx = lo + peak_idx_in_region
        peak_val = float(smoothed[peak_idx])

        median_val = float(np.median(smoothed))
        if median_val <= 1e-12 or peak_val <= 1e-12:
            return None
        ratio = peak_val / (median_val + 1e-12)
        confidence = float(min(1.0, max(0.0, np.log10(max(ratio, 1.0)) / 2.0)))

        time_sec = peak_idx / float(sr)
        frame_idx = int(round(time_sec * fps))
        frame_idx = max(0, min(frame_idx, total_frames - 1))

        print(
            f"[audio-impact] peak at {time_sec:.3f}s = frame {frame_idx}/{total_frames} "
            f"ratio={ratio:.1f}x confidence={confidence:.2f}"
        )

        return {
            "frame_idx": frame_idx,
            "time_ms": int(time_sec * 1000),
            "confidence": confidence,
            "peak_to_median_ratio": float(ratio),
        }
    except Exception as e:
        print(f"[audio-impact] failed: {type(e).__name__}: {e}")
        return None
    finally:
        if wav_path and os.path.exists(wav_path):
            try:
                os.unlink(wav_path)
            except OSError:
                pass


def transcode_to_h264(input_path: str) -> str:
    output_path = input_path.replace(".mp4", "_h264.mp4")
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                input_path,
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-crf",
                "23",
                "-an",
                output_path,
            ],
            capture_output=True,
            timeout=60,
        )
        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            print(f"[ffmpeg] transcoded {os.path.getsize(output_path)} bytes")
            return output_path
    except Exception as e:
        print(f"[ffmpeg] transcode failed: {e}")
    return input_path


def open_video(path: str) -> Tuple[cv2.VideoCapture, str, Optional[str]]:
    cap = cv2.VideoCapture(path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total > 0:
        return cap, path, None
    cap.release()
    print(f"[ffmpeg] OpenCV couldn't read {path}, transcoding to H.264…")
    converted = transcode_to_h264(path)
    cap2 = cv2.VideoCapture(converted)
    cleanup = converted if converted != path else None
    return cap2, converted, cleanup


def preprocess_frame(frame):
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    lab = cv2.merge([clahe.apply(l), a, b])
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


def resize_for_ai(frame, max_side: int = 640):
    h, w = frame.shape[:2]
    if max(h, w) <= max_side:
        return frame
    scale = max_side / max(h, w)
    return cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
