import os
import json
import base64
import subprocess
import cv2
import numpy as np
import tempfile
import urllib.request
import urllib.error
import mediapipe as mp
from fastapi import FastAPI, BackgroundTasks, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict
from supabase import create_client, Client

app = FastAPI(title="ImpactAI MediaPipe Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
BUCKET = "swing-videos"
OPENROUTER_KEY = os.environ.get("OPENROUTER_API_KEY", "")

# Prompt for contact-sheet vision selection
# Two labeled strips are sent: TOP STRIP and IMPACT STRIP, each showing frames
# in chronological order. GPT-4o sees the full temporal progression.
_SHEET_PROMPT = """\
You are a golf swing phase analyst. You will see TWO contact sheets.
Each sheet is a row of numbered frames in time order (left = earlier, right = later).
Each frame is labeled "N: Xms" showing its number and timestamp.

SHEET 1 — TOP OF BACKSWING candidates.
SHEET 2 — IMPACT candidates.

Definitions:
• TOP OF BACKSWING: The frame where the golfer's hands/wrists are at their HIGHEST point in the image (maximum backswing height, body fully turned away, club at the top). Do NOT pick address or early takeaway.
• IMPACT: The frame where the club is at or just before contact with the ball. The hands have returned to roughly hip height. The body has rotated toward the target. Choose the frame just BEFORE the club passes — do NOT choose follow-through.

For each sheet, pick the single best frame number.
Return ONLY valid JSON — no markdown, no text:
{"top":{"frame":N,"confidence":0.0},"impact":{"frame":N,"confidence":0.0}}"""

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

mp_pose = mp.solutions.pose
OVERLAY_GREEN = (76, 175, 80)
OVERLAY_WHITE = (255, 255, 255)
OVERLAY_MIN_VISIBILITY = 0.45


class ProcessRequest(BaseModel):
    swing_id: str
    video_url: str
    user_id: str


class AnalyzeFramesRequest(BaseModel):
    frames: List[str]  # base64-encoded JPEG images (empty string = skip)


@app.get("/health")
def health():
    return {"status": "ok"}


class ExtractKeyFramesRequest(BaseModel):
    video_url: str
    timestamps_ms: Optional[List[int]] = None
    include_overlays: bool = False
    quality: str = "fast"
    club: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# Audio-based impact detection
# ─────────────────────────────────────────────────────────────────────────────
# Pose tracking is great at finding "the body is moving fast around here", but
# the clubface-on-ball moment is a sharp, sub-frame transient that's much
# easier to pin down in the audio waveform. The microphone picks up a brief
# broadband click whenever a clubhead meets a ball — typically the loudest
# event in the entire recording.
#
# Locating that click in the audio gives us impact accuracy of ±1 video frame
# (≈ ±33ms at 30fps), which is far better than the 3-5 frame uncertainty of
# pose-only detection. Once impact is locked, top/address/finish derive
# naturally from it: top ≈ 0.3-0.8s before impact, finish ≈ 0.4s after.

_FFMPEG_PATH: Optional[str] = None


def _get_ffmpeg_path() -> Optional[str]:
    """
    Resolve a working ffmpeg binary. Prefers imageio_ffmpeg's bundled binary
    (~30MB pip install, no system deps) but falls back to a system-installed
    ffmpeg if that's already there. Cached so repeated calls are free.
    """
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
    _FFMPEG_PATH = ""  # cached sentinel for "we already checked, none available"
    return None


def detect_audio_impact(
    video_path: str,
    fps: float,
    total_frames: int,
    lo_pct: float = 0.10,
    hi_pct: float = 0.92,
) -> Optional[Dict]:
    """
    Find the impact moment from the audio track.

    Pipeline (~200-500ms total on typical phone-captured swings):
      1. ffmpeg: extract a mono 22050Hz 16-bit PCM WAV.
      2. Compute short-time energy (squared amplitude, 20ms boxcar window).
      3. Find the global energy peak inside the candidate window
         (lo_pct..hi_pct of the clip — skips microphone-handling thumps
         at the very start and any putdown noise at the end).
      4. Convert peak-sample-index → video-frame-index via fps.

    Returns:
      { frame_idx, time_ms, confidence, peak_to_median_ratio }
        confidence is log10(peak/median)/2, clamped to [0,1]. >0.6 = a clear,
        loud impact; <0.3 = no audible impact (mic too far, very windy, or
        the video has muted audio). The caller should fall back to pose-based
        detection when confidence is below the threshold.
      None if audio extraction fails, the clip is too short, or no peak.
    """
    if fps <= 0 or total_frames <= 0:
        return None

    ffmpeg = _get_ffmpeg_path()
    if not ffmpeg:
        print("[audio-impact] no ffmpeg available — skipping")
        return None

    wav_path = None
    try:
        wav_fd, wav_path = tempfile.mkstemp(suffix=".wav")
        os.close(wav_fd)
        cmd = [
            ffmpeg, "-y", "-i", video_path,
            "-ac", "1",       # mono
            "-ar", "22050",   # 22.05kHz — way above the 1-5kHz band where
                              # impact lives, plenty for our purposes
            "-vn",            # no video stream
            "-f", "wav",
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

        # PCM dtype depends on ffmpeg's chosen sample format. Default for our
        # `-f wav` invocation is 16-bit signed.
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
            return None  # < 0.5s of audio, not a real swing recording

        # Short-time energy. Squared amplitude is more selective for sharp
        # impulsive peaks than abs amplitude (the squaring suppresses the
        # body of speech / wind / ambient and lifts the click).
        win = max(32, int(sr * 0.02))  # 20ms window
        energy = audio * audio
        kernel = np.ones(win, dtype=np.float32) / float(win)
        smoothed = np.convolve(energy, kernel, mode="same")

        # Bound search to the candidate swing window.
        lo = max(0, int(len(smoothed) * lo_pct))
        hi = min(len(smoothed), int(len(smoothed) * hi_pct))
        if hi - lo < int(sr * 0.3):
            return None

        region = smoothed[lo:hi]
        peak_idx_in_region = int(np.argmax(region))
        peak_idx = lo + peak_idx_in_region
        peak_val = float(smoothed[peak_idx])

        # Confidence: how prominent is the peak vs. ambient? Median is robust
        # to the peak itself (the peak occupies ~1 of len(smoothed) samples).
        median_val = float(np.median(smoothed))
        if median_val <= 1e-12 or peak_val <= 1e-12:
            return None
        ratio = peak_val / (median_val + 1e-12)
        # ratio = 1 → confidence 0; ratio = 100 → confidence 1.0; log-scaled
        # so a 10x peak is moderately confident, a 100x peak is very confident.
        confidence = float(min(1.0, max(0.0, np.log10(max(ratio, 1.0)) / 2.0)))

        # Convert audio-sample-index → video-frame-index.
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


def _walk_motion_samples(cap, total_frames: int, sample_n: int = 60):
    """
    ONE forward pass through the video collecting motion-only samples at evenly
    spaced indices. Uses cap.grab() to skip decoding of non-sample frames, which
    is ~10x faster than seeking every time. Returns a list of dicts:

        [{ "fi": int, "motion": float }, ...]

    No pose, no CLAHE, no color conversion to RGB — keeps the scan cheap so
    we can do other work synchronously without blowing the Render timeout.
    """
    if total_frames <= 0:
        return []

    sample_n = max(8, min(sample_n, total_frames))
    step = max(1, total_frames // sample_n)
    sample_fis = set(range(0, total_frames, step))

    samples = []
    prev_roi = None
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

    fi = 0
    while fi < total_frames:
        if fi in sample_fis:
            ret, frame = cap.read()
            if not ret:
                break
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            h, w = gray.shape
            roi = cv2.resize(
                gray[int(h * 0.05):int(h * 0.92), int(w * 0.08):int(w * 0.92)],
                (80, 140),
            )
            motion = 0.0 if prev_roi is None else float(cv2.absdiff(roi, prev_roi).mean())
            prev_roi = roi
            samples.append({"fi": fi, "motion": motion})
        else:
            # grab() advances the decoder pointer without producing a numpy frame —
            # roughly 5-10x faster than read() per non-sample frame.
            if not cap.grab():
                break
        fi += 1

    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    return samples


def _detect_burst_from_samples(samples, total_frames: int, fps: float):
    """
    Identify the main swing burst from precomputed motion samples.
    Returns (burst_start_fi, burst_end_fi).
    """
    if len(samples) < 3:
        return 0, total_frames - 1

    motion = np.array([s["motion"] for s in samples], dtype=np.float32)
    threshold = max(float(np.percentile(motion, 55)), float(motion.mean() * 0.7), 1.0)
    active_flags = [v >= threshold for v in motion]

    max_gap = max(1, int(len(samples) * 0.10))
    step = samples[1]["fi"] - samples[0]["fi"] if len(samples) > 1 else 1

    runs, run_start, prev_active = [], None, -max_gap - 1
    for idx in range(len(samples)):
        if active_flags[idx]:
            if run_start is None or idx - prev_active > max_gap:
                run_start = idx
            prev_active = idx
        elif run_start is not None and idx - prev_active > max_gap:
            runs.append((run_start, prev_active))
            run_start = None
    if run_start is not None:
        runs.append((run_start, prev_active))

    if not runs:
        return 0, total_frames - 1

    cutoff_idx = int(len(samples) * 0.75)
    early_runs = [r for r in runs if r[0] < cutoff_idx]
    candidates = early_runs if early_runs else runs

    best = max(
        candidates,
        key=lambda r: sum(float(motion[i]) for i in range(r[0], r[1] + 1)),
    )
    start_fi = max(0, samples[best[0]]["fi"] - step)
    end_fi = min(total_frames - 1, samples[best[1]]["fi"] + step * 2)

    print(
        f"[burst] {int(start_fi/fps*1000)}ms–{int(end_fi/fps*1000)}ms "
        f"({len(runs)} runs, {len(candidates)} early, picked {best})"
    )
    return start_fi, end_fi


def find_swing_burst(cap, total_frames: int, fps: float):
    """
    Back-compat wrapper. Equivalent to walking 40 motion samples and detecting
    the burst from them. New code should call _walk_motion_samples directly
    and reuse the samples for downstream work (smoothness, address detection).
    """
    samples = _walk_motion_samples(cap, total_frames, sample_n=40)
    return _detect_burst_from_samples(samples, total_frames, fps)


def find_top_of_backswing(cap, fps: float, fi_address: int, burst_start: int) -> int:
    """
    Find the top of backswing by locating the minimum-motion frame in the
    window between address and burst_start. The pause at the top is the
    moment of lowest movement before the downswing explosion begins.
    """
    # Search from 0.4s after address up to 0.08s before burst
    search_start = fi_address + max(2, int(fps * 0.4))
    search_end   = max(search_start + 2, burst_start - max(2, int(fps * 0.08)))

    if search_end <= search_start:
        return max(0, burst_start - int(fps * 0.2))

    sample_step = max(1, (search_end - search_start) // 20)
    motion_samples = []
    prev_gray = None

    for fi in range(search_start, search_end, sample_step):
        cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
        ret, frame = cap.read()
        if not ret:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape
        roi = cv2.resize(gray[int(h*0.05):int(h*0.92), int(w*0.08):int(w*0.92)], (80, 140))
        score = 0.0 if prev_gray is None else float(cv2.absdiff(roi, prev_gray).mean())
        prev_gray = roi
        motion_samples.append((fi, score))

    if not motion_samples:
        return max(0, burst_start - int(fps * 0.2))

    # The top of backswing is the frame CLOSEST to burst_start that has
    # near-minimum motion — i.e. the last pause before the downswing.
    min_score = min(s for _, s in motion_samples)
    threshold = min_score * 1.8  # frames within 80% of minimum
    candidates = [(fi, s) for fi, s in motion_samples if s <= threshold]

    # Pick the candidate closest to burst_start (most recent pause)
    fi_top = max(candidates, key=lambda x: x[0])[0]
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    return fi_top


def extract_phase_frames_by_structure(cap, fps: float, total_frames: int,
                                      burst_start: int, burst_end: int) -> List[dict]:
    """
    Pick exactly 4 frame indices by structure, run MediaPipe on each.

      address        = 8% into total video (static setup)
      top            = minimum-motion frame between address and burst_start
                       (the pause at the top of the backswing)
      impact         = burst_start + 25% of burst span
                       (early in the downswing, just at ball contact)
      follow_through = burst_start + 82% of burst span
    """
    span = max(1, burst_end - burst_start)

    fi_address = max(0, int(total_frames * 0.08))
    fi_top     = find_top_of_backswing(cap, fps, fi_address, burst_start)
    fi_impact  = burst_start + int(span * 0.25)
    fi_ft      = burst_start + int(span * 0.82)

    phase_fis = [fi_address, fi_top, fi_impact, fi_ft]
    print(f"[phases] addr={int(fi_address/fps*1000)}ms  top={int(fi_top/fps*1000)}ms  "
          f"impact={int(fi_impact/fps*1000)}ms  ft={int(fi_ft/fps*1000)}ms")

    results = []
    with mp_pose.Pose(static_image_mode=True, model_complexity=0,
                      enable_segmentation=False, min_detection_confidence=0.2) as pose:
        for fi in phase_fis:
            fi = max(0, min(int(fi), total_frames - 1))
            cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
            ret, frame = cap.read()
            time_ms = int(fi / fps * 1000)
            if not ret:
                results.append({"frame": None, "overlay_frame": None,
                                 "landmarks": None, "time_ms": time_ms})
                continue
            b64 = encode_jpg(resize_for_ai(frame))
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            det = pose.process(rgb)
            lm  = landmarks_to_json(det.pose_landmarks) if det.pose_landmarks else None
            results.append({"frame": b64, "overlay_frame": None,
                             "landmarks": lm, "time_ms": time_ms})
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    return results


def _smooth(values: np.ndarray, window: int = 5) -> np.ndarray:
    if len(values) == 0 or window <= 1:
        return values
    pad = window // 2
    padded = np.pad(values, (pad, pad), mode="edge")
    kernel = np.ones(window, dtype=np.float32) / window
    return np.convolve(padded, kernel, mode="valid").astype(np.float32)


def _norm_signal(values: np.ndarray) -> np.ndarray:
    if len(values) == 0:
        return values
    lo = float(np.nanpercentile(values, 10))
    hi = float(np.nanpercentile(values, 90))
    if hi - lo < 1e-6:
        return np.zeros_like(values, dtype=np.float32)
    return np.clip((values - lo) / (hi - lo), 0.0, 1.0).astype(np.float32)


def _landmark_xy(landmarks, idx: int, min_visibility: float = 0.2):
    lm = landmarks.landmark[idx]
    if lm.visibility < min_visibility:
        return None
    return np.array([float(lm.x), float(lm.y)], dtype=np.float32), float(lm.visibility)


def _midpoint(landmarks, left_idx: int, right_idx: int, min_visibility: float = 0.2):
    left = _landmark_xy(landmarks, left_idx, min_visibility)
    right = _landmark_xy(landmarks, right_idx, min_visibility)
    points = [p for p in [left, right] if p is not None]
    if not points:
        return None
    total_vis = sum(v for _, v in points)
    xy = sum(p * v for p, v in points) / max(total_vis, 1e-6)
    return xy, total_vis / len(points)


def _body_scale(landmarks) -> float:
    left_shoulder = _landmark_xy(landmarks, mp_pose.PoseLandmark.LEFT_SHOULDER.value, 0.1)
    right_shoulder = _landmark_xy(landmarks, mp_pose.PoseLandmark.RIGHT_SHOULDER.value, 0.1)
    left_hip = _landmark_xy(landmarks, mp_pose.PoseLandmark.LEFT_HIP.value, 0.1)
    right_hip = _landmark_xy(landmarks, mp_pose.PoseLandmark.RIGHT_HIP.value, 0.1)
    distances = []
    for a, b in [(left_shoulder, right_shoulder), (left_hip, right_hip)]:
        if a is not None and b is not None:
            distances.append(float(np.linalg.norm(a[0] - b[0])))
    return max(distances or [0.12], 0.08)


def _preprocess(frame):
    """CLAHE contrast enhancement — helps in flat/outdoor/overcast lighting."""
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    lab = cv2.merge([clahe.apply(l), a, b])
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


def _sample_pose_track(cap, fps: float, total_frames: int, quality: str = "fast") -> List[Dict]:
    """
    Sample the whole clip and track the hand/wrist center. The phase detector uses
    normalized pose coordinates so it is much less sensitive to clip length, fps,
    pauses, or extra motion after the swing.

    Only used in quality="accurate" mode now — the fast path reuses the cheaper
    motion-only walk from _walk_motion_samples().
    """
    if total_frames <= 0:
        return []

    # Fewer samples in fast mode (kept around for accurate mode); the trade-off
    # is +25-40% speed for ~5% lower phase-localization precision.
    max_samples = 50 if quality == "accurate" else 30
    step = max(1, int(np.ceil(total_frames / max_samples)))

    samples = []
    prev_gray = None
    with mp_pose.Pose(
        static_image_mode=False,
        model_complexity=0,
        smooth_landmarks=True,
        enable_segmentation=False,
        min_detection_confidence=0.25,
        min_tracking_confidence=0.25,
    ) as pose:
        for fi in range(0, total_frames, step):
            cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
            ret, frame = cap.read()
            if not ret:
                continue

            # No CLAHE: MediaPipe handles low-contrast frames well, and CLAHE
            # was costing ~30ms per sample (~1.5s total on 50 samples).
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            h, w = gray.shape
            roi = cv2.resize(gray[int(h * 0.05):int(h * 0.95), int(w * 0.05):int(w * 0.95)], (96, 160))
            motion = 0.0 if prev_gray is None else float(cv2.absdiff(roi, prev_gray).mean())
            prev_gray = roi

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            det = pose.process(rgb)
            if not det.pose_landmarks:
                samples.append({"fi": fi, "time": fi / fps, "hand": None, "vis": 0.0,
                                "scale": 0.12, "motion": motion})
                continue

            hand = _midpoint(
                det.pose_landmarks,
                mp_pose.PoseLandmark.LEFT_WRIST.value,
                mp_pose.PoseLandmark.RIGHT_WRIST.value,
                0.15,
            )
            if hand is None:
                hand = _midpoint(
                    det.pose_landmarks,
                    mp_pose.PoseLandmark.LEFT_INDEX.value,
                    mp_pose.PoseLandmark.RIGHT_INDEX.value,
                    0.15,
                )

            if hand is None:
                samples.append({"fi": fi, "time": fi / fps, "hand": None, "vis": 0.0,
                                "scale": _body_scale(det.pose_landmarks), "motion": motion})
            else:
                samples.append({"fi": fi, "time": fi / fps, "hand": hand[0], "vis": hand[1],
                                "scale": _body_scale(det.pose_landmarks), "motion": motion})

    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    return samples


def detect_swing_events(samples: List[Dict], total_frames: int, fps: float):
    """
    Motion-based swing phase detection. Camera-angle independent.

    ADDRESS  — lowest energy frame in first 22% (golfer still at setup)
    IMPACT   — peak energy frame in 22-87% (fastest moment = ball contact)
    TOP      — last local energy minimum between address and impact
               (the brief pause before the downswing reversal)
    FT       — ~0.35s after impact

    Uses frame-difference motion as primary signal — no pose required.
    Wrist speed from pose is blended in as a bonus when available.
    """
    if not samples or len(samples) < 6:
        return None

    n     = len(samples)
    times = np.array([s["time"] for s in samples], dtype=np.float32)
    fis   = np.array([s["fi"]   for s in samples], dtype=np.float32)

    # ── Motion signal — always available, camera-angle independent ───────────
    raw_motion = np.array([s.get("motion", 0.0) for s in samples], dtype=np.float32)
    motion     = _smooth(raw_motion, 5)
    motion_n   = _norm_signal(motion)

    # ── Wrist speed — supplementary bonus when pose is available ─────────────
    valid    = [i for i, s in enumerate(samples) if s["hand"] is not None and s["vis"] >= 0.15]
    has_pose = len(valid) >= max(3, int(n * 0.10))
    speed_n  = np.zeros(n, dtype=np.float32)

    if has_pose:
        scales = np.array([s.get("scale", 0.12) for s in samples], dtype=np.float32)
        hands  = np.full((n, 2), np.nan, dtype=np.float32)
        for i in valid:
            hands[i] = samples[i]["hand"]
        speed = np.zeros(n, dtype=np.float32)
        for pos, i in enumerate(valid):
            pi = valid[max(0, pos - 1)]
            ni = valid[min(len(valid) - 1, pos + 1)]
            dt = max(float(times[ni] - times[pi]), 1.0 / max(fps, 1.0))
            if not (np.isnan(hands[ni]).any() or np.isnan(hands[pi]).any()):
                speed[i] = float(np.linalg.norm(hands[ni] - hands[pi])) / dt / max(float(scales[i]), 0.08)
        speed   = _smooth(speed, 5)
        speed_n = _norm_signal(speed)

    # Combined energy — motion dominates (no pose needed)
    energy = motion_n * 0.65 + speed_n * 0.35

    # ── 1. ADDRESS ───────────────────────────────────────────────────────────
    # Lowest energy frame in first 22% → golfer still at setup
    addr_end = max(1, int(n * 0.22))
    addr_idx = int(np.argmin(energy[:addr_end]))

    # ── 2. IMPACT ────────────────────────────────────────────────────────────
    # Peak energy between 22% and 87% of video.
    # Physics: the downswing produces the highest total scene motion.
    imp_lo = max(addr_idx + 1, int(n * 0.22))
    imp_hi = min(n - 1, int(n * 0.87))
    if imp_lo >= imp_hi:
        imp_lo, imp_hi = addr_idx + 1, n - 1

    impact_idx  = imp_lo + int(np.argmax(energy[imp_lo:imp_hi + 1]))
    impact_conf = min(1.0, float(energy[impact_idx]) + 0.30)

    # ── 3. TOP OF BACKSWING ──────────────────────────────────────────────────
    # The top is the LAST local energy minimum between address and impact.
    # Physics: the wrists/club momentarily pause before reversing →
    # local minimum in combined motion+speed right before the downswing burst.
    # Taking the LAST one (closest to impact) avoids picking early takeaway.
    pre_impact = list(range(addr_idx + 1, impact_idx))

    if len(pre_impact) < 3:
        top_idx  = (addr_idx + impact_idx) // 2
        top_conf = 0.30
        top_meth = "fallback_midpoint"
    else:
        local_mins = [
            pre_impact[k]
            for k in range(1, len(pre_impact) - 1)
            if energy[pre_impact[k]] <= energy[pre_impact[k - 1]]
            and energy[pre_impact[k]] <= energy[pre_impact[k + 1]]
        ]

        # Only consider minima in the LATTER 45% of the pre-impact window
        split       = pre_impact[max(0, int(len(pre_impact) * 0.45))]
        latter_mins = [m for m in local_mins if m >= split]

        if latter_mins:
            top_idx  = min(latter_mins, key=lambda i: float(energy[i]))
            top_conf = 0.80
            top_meth = "local_minimum"
        elif local_mins:
            top_idx  = local_mins[-1]   # last minimum, even if early
            top_conf = 0.55
            top_meth = "local_minimum_early"
        else:
            top_idx  = pre_impact[int(len(pre_impact) * 0.60)]
            top_conf = 0.30
            top_meth = "fallback_percentage"

    # ── 4. FOLLOW-THROUGH ────────────────────────────────────────────────────
    ft_min_t  = float(times[impact_idx]) + 0.30
    ft_max_fi = total_frames * 0.96
    ft_pool   = [i for i in range(impact_idx + 1, n)
                 if float(times[i]) >= ft_min_t and fis[i] <= ft_max_fi]

    if ft_pool:
        ft_idx  = ft_pool[min(2, len(ft_pool) - 1)]
        ft_conf = 0.78
        ft_meth = "post_impact_window"
    else:
        ft_idx  = min(n - 1, impact_idx + max(2, int(n * 0.10)))
        ft_conf = 0.40
        ft_meth = "fallback"

    # ── Validate ─────────────────────────────────────────────────────────────
    phase_fis = [int(fis[i]) for i in [addr_idx, top_idx, impact_idx, ft_idx]]

    if not (phase_fis[0] < phase_fis[1] < phase_fis[2] < phase_fis[3]):
        print(f"[events] REJECTED order: {[int(f/fps*1000) for f in phase_fis]}ms")
        return None

    min_gap = max(1, int(fps * 0.06))
    if any(phase_fis[i + 1] - phase_fis[i] < min_gap for i in range(3)):
        print(f"[events] REJECTED gap: {[int(f/fps*1000) for f in phase_fis]}ms")
        return None

    confidence = {
        "address":       0.85,
        "top":           round(top_conf,    2),
        "impact":        round(impact_conf, 2),
        "followThrough": round(ft_conf,     2),
    }
    methods = {
        "address":       "energy_minimum",
        "top":           top_meth,
        "impact":        "energy_peak",
        "followThrough": ft_meth,
    }

    print(f"[events] "
          f"addr={int(times[addr_idx]*1000)}ms  "
          f"top={int(times[top_idx]*1000)}ms({top_conf:.2f},{top_meth})  "
          f"impact={int(times[impact_idx]*1000)}ms({impact_conf:.2f})  "
          f"ft={int(times[ft_idx]*1000)}ms  "
          f"pose={'yes' if has_pose else 'no'}({len(valid)}/{n})")

    return phase_fis, confidence, methods


def _read_pose_point(pose, cap, fi: int, fps: float):
    cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
    ret, frame = cap.read()
    if not ret:
        return None

    enhanced = _preprocess(frame)
    gray = cv2.cvtColor(enhanced, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    roi = cv2.resize(gray[int(h * 0.05):int(h * 0.95), int(w * 0.05):int(w * 0.95)], (96, 160))

    rgb = cv2.cvtColor(enhanced, cv2.COLOR_BGR2RGB)
    det = pose.process(rgb)
    if not det.pose_landmarks:
        return {"fi": fi, "time": fi / fps, "hand": None, "vis": 0.0, "scale": 0.12, "roi": roi}

    hand = _midpoint(
        det.pose_landmarks,
        mp_pose.PoseLandmark.LEFT_WRIST.value,
        mp_pose.PoseLandmark.RIGHT_WRIST.value,
        0.15,
    )
    if hand is None:
        hand = _midpoint(
            det.pose_landmarks,
            mp_pose.PoseLandmark.LEFT_INDEX.value,
            mp_pose.PoseLandmark.RIGHT_INDEX.value,
            0.15,
        )

    if hand is None:
        return {"fi": fi, "time": fi / fps, "hand": None, "vis": 0.0,
                "scale": _body_scale(det.pose_landmarks), "roi": roi}

    return {"fi": fi, "time": fi / fps, "hand": hand[0], "vis": hand[1],
            "scale": _body_scale(det.pose_landmarks), "roi": roi}


def _window_track(cap, fps: float, total_frames: int, center_fi: int, radius_s: float, stride: int = 1) -> List[Dict]:
    start = max(0, int(center_fi - fps * radius_s))
    end = min(total_frames - 1, int(center_fi + fps * radius_s))
    points = []
    with mp_pose.Pose(
        static_image_mode=True,
        model_complexity=0,
        enable_segmentation=False,
        min_detection_confidence=0.2,
    ) as pose:
        for fi in range(start, end + 1, max(1, stride)):
            point = _read_pose_point(pose, cap, fi, fps)
            if point is not None:
                points.append(point)

    prev_roi = None
    for point in points:
        point["motion"] = 0.0 if prev_roi is None else float(cv2.absdiff(point["roi"], prev_roi).mean())
        prev_roi = point["roi"]
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    return points


def refine_phase_indices(cap, fps: float, total_frames: int, phase_fis: List[int], quality: str = "fast") -> List[int]:
    """
    Coarse pose sampling gets the swing in the right neighborhood. This pass checks
    nearby actual frames so top/impact can move by single-frame increments.
    """
    if len(phase_fis) != 4:
        return phase_fis

    setup_fi, top_fi, impact_fi, finish_fi = phase_fis
    stride = max(1, int(round(fps / (60 if quality == "accurate" else 24))))
    setup_track = _window_track(cap, fps, total_frames, setup_fi, 0.14 if quality == "fast" else 0.18, stride)
    setup_valid = [p for p in setup_track if p["hand"] is not None and p["vis"] >= 0.15]
    if not setup_valid:
        return phase_fis

    setup_hand = np.median(np.array([p["hand"] for p in setup_valid], dtype=np.float32), axis=0)
    setup_scale = max(float(np.median([p["scale"] for p in setup_valid])), 0.08)

    top_track = _window_track(cap, fps, total_frames, top_fi, 0.22 if quality == "fast" else 0.28, stride)
    top_valid = [p for p in top_track if p["hand"] is not None and p["vis"] >= 0.15]
    refined_top = top_fi
    if top_valid:
        motions = _norm_signal(_smooth(np.array([p["motion"] for p in top_valid], dtype=np.float32), 5))

        def local_top_score(item):
            idx, point = item
            high = (setup_hand[1] - point["hand"][1]) / setup_scale
            away = float(np.linalg.norm(point["hand"] - setup_hand)) / setup_scale
            calm = 1.0 - float(motions[idx])
            return high * 1.65 + away * 0.85 + calm * 0.20

        refined_top = max(enumerate(top_valid), key=local_top_score)[1]["fi"]

    impact_track = _window_track(cap, fps, total_frames, impact_fi, 0.18 if quality == "fast" else 0.24, stride)
    impact_valid = [
        p for p in impact_track
        if p["hand"] is not None and p["vis"] >= 0.15 and p["fi"] > refined_top
    ]
    refined_impact = impact_fi
    if impact_valid:
        motions = _norm_signal(_smooth(np.array([p["motion"] for p in impact_valid], dtype=np.float32), 5))

        def local_impact_score(item):
            idx, point = item
            return_dist = float(np.linalg.norm(point["hand"] - setup_hand)) / setup_scale
            y_error = abs(float(point["hand"][1] - setup_hand[1])) / setup_scale
            motion_bonus = float(motions[idx])
            return return_dist * 0.45 + y_error * 1.55 - motion_bonus * 0.55

        refined_impact = min(enumerate(impact_valid), key=local_impact_score)[1]["fi"]

    refined = [setup_fi, refined_top, refined_impact, finish_fi]
    if not (refined[0] <= refined[1] <= refined[2] <= refined[3]):
        return phase_fis

    if refined != phase_fis:
        print("[pose-refine] "
              f"top {int(top_fi/fps*1000)}ms->{int(refined_top/fps*1000)}ms  "
              f"impact {int(impact_fi/fps*1000)}ms->{int(refined_impact/fps*1000)}ms")
    return refined


def detect_pose_landmarks(pose, frame):
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    det = pose.process(rgb)
    return landmarks_to_json(det.pose_landmarks) if det.pose_landmarks else None


def extract_phase_frames_at_indices(
    cap,
    fps: float,
    total_frames: int,
    phase_fis: List[int],
    include_overlays: bool = False,
) -> List[dict]:
    results = []
    with mp_pose.Pose(static_image_mode=True, model_complexity=0,
                      enable_segmentation=False, min_detection_confidence=0.2) as pose:
        for fi in phase_fis:
            fi = max(0, min(int(fi), total_frames - 1))
            cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
            ret, frame = cap.read()
            time_ms = int(fi / fps * 1000)
            if not ret:
                results.append({"frame": None, "overlay_frame": None,
                                "landmarks": None, "time_ms": time_ms})
                continue

            small = resize_for_ai(frame)
            frame_b64 = encode_jpg(small)
            if include_overlays:
                landmarks, overlay_b64 = try_detect_pose(pose, frame)
            else:
                landmarks = detect_pose_landmarks(pose, frame)
                overlay_b64 = None
            results.append({"frame": frame_b64, "overlay_frame": overlay_b64,
                            "landmarks": landmarks, "time_ms": time_ms})

    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    return results


def _find_quietest_frame(cap, lo_fi: int, hi_fi: int) -> int:
    """Return the frame index with the least inter-frame motion in [lo_fi, hi_fi]."""
    lo_fi = max(0, int(lo_fi))
    hi_fi = max(lo_fi + 1, int(hi_fi))
    step  = max(1, (hi_fi - lo_fi) // 24)
    samples, prev_roi = [], None
    for fi in range(lo_fi, hi_fi + 1, step):
        cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
        ret, frame = cap.read()
        if not ret:
            continue
        # No CLAHE: we only need motion DIFFERENCES, not contrast — saves ~30ms/frame.
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape
        roi  = cv2.resize(gray[int(h*0.05):int(h*0.92), int(w*0.08):int(w*0.92)], (80, 120))
        motion = 0.0 if prev_roi is None else float(cv2.absdiff(roi, prev_roi).mean())
        prev_roi = roi
        samples.append((fi, motion))
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    if not samples:
        return lo_fi
    # Skip the very first sample (motion=0 by definition); pick quietest of the rest
    rest = samples[1:] if len(samples) > 1 else samples
    return min(rest, key=lambda x: x[1])[0]


def _extract_strip_frames(cap, fps: float, total_frames: int,
                           lo_fi: int, hi_fi: int, n: int,
                           enhance: bool = True) -> List[Dict]:
    """
    Extract n evenly-spaced frames between lo_fi and hi_fi.
    Returns list of {fi, time_ms, frame_bgr} dicts.

    `enhance` toggles CLAHE preprocessing. Vision contact-sheet selection
    benefits from contrast-enhanced frames, but motion-energy fallback does
    not — pass enhance=False there to save ~30ms per frame.
    """
    lo_fi = max(0, int(lo_fi))
    hi_fi = min(int(total_frames) - 1, int(hi_fi))
    if hi_fi <= lo_fi or n < 1:
        return []
    fis = [int(lo_fi + (hi_fi - lo_fi) * i / max(n - 1, 1)) for i in range(n)]
    fis = list(dict.fromkeys(fis))  # deduplicate while preserving order

    results = []
    for fi in fis:
        cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
        ret, frame = cap.read()
        if not ret:
            continue
        results.append({
            "fi":       fi,
            "time_ms":  int(fi / fps * 1000),
            "frame_bgr": _preprocess(frame) if enhance else frame,
        })
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    return results


def _compose_contact_sheet(strip_frames: List[Dict], cell_h: int = 200) -> Optional[str]:
    """
    Compose a horizontal contact sheet from strip frames.
    Each cell is resized to cell_h, labeled with its 1-based index and timestamp.
    Returns base64 JPEG or None.
    """
    if not strip_frames:
        return None
    cells = []
    for idx, info in enumerate(strip_frames):
        frame = info["frame_bgr"]
        h, w  = frame.shape[:2]
        scale = cell_h / max(h, 1)
        cw    = max(1, int(w * scale))
        cell  = cv2.resize(frame, (cw, cell_h), interpolation=cv2.INTER_AREA)
        # Label bar
        bar = np.zeros((26, cw, 3), dtype=np.uint8)
        cv2.putText(bar, f"{idx+1}: {info['time_ms']}ms",
                    (2, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 230, 100), 1, cv2.LINE_AA)
        cells.append(np.vstack([cell, bar]))
    sheet = np.hstack(cells)
    _, buf = cv2.imencode(".jpg", sheet, [cv2.IMWRITE_JPEG_QUALITY, 72])
    return base64.b64encode(buf).decode("utf-8")


def select_phases_with_vision(top_strip: List[Dict], impact_strip: List[Dict],
                              club: str = "unknown") -> Optional[Dict]:
    """
    Send two contact-sheet images to OpenRouter vision (one API call).
    Each sheet shows frames in time order with numbered labels.
    Returns {"top_fi", "top_ms", "top_conf", "impact_fi", "impact_ms", "impact_conf"} or None.
    """
    if not OPENROUTER_KEY or not top_strip or not impact_strip:
        return None

    top_sheet    = _compose_contact_sheet(top_strip)
    impact_sheet = _compose_contact_sheet(impact_strip)
    if not top_sheet or not impact_sheet:
        return None

    n_top    = len(top_strip)
    n_impact = len(impact_strip)

    content = [
        {"type": "text",
         "text": f"Club: {club}\nSHEET 1 — TOP OF BACKSWING candidates ({n_top} frames, left=earlier):"},
        {"type": "image_url",
         "image_url": {"url": f"data:image/jpeg;base64,{top_sheet}", "detail": "auto"}},
        {"type": "text",
         "text": f"SHEET 2 — IMPACT candidates ({n_impact} frames, left=earlier):"},
        {"type": "image_url",
         "image_url": {"url": f"data:image/jpeg;base64,{impact_sheet}", "detail": "auto"}},
        {"type": "text", "text": "Return ONLY the JSON."},
    ]

    body = json.dumps({
        "model": "openai/gpt-4o",
        "messages": [
            {"role": "system", "content": _SHEET_PROMPT},
            {"role": "user",   "content": content},
        ],
        "max_tokens": 80,
        "temperature": 0.05,
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=body,
        headers={
            "Authorization": f"Bearer {OPENROUTER_KEY}",
            "Content-Type":  "application/json",
            "HTTP-Referer":  "https://impactai.app",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=28) as resp:
            raw = json.loads(resp.read())["choices"][0]["message"]["content"]
        start = raw.index("{")
        end   = raw.rindex("}") + 1
        sel   = json.loads(raw[start:end])

        top_n    = int(sel.get("top",    {}).get("frame", 0))
        impact_n = int(sel.get("impact", {}).get("frame", 0))
        top_conf    = float(sel.get("top",    {}).get("confidence", 0.5))
        impact_conf = float(sel.get("impact", {}).get("confidence", 0.5))

        if not (1 <= top_n <= n_top and 1 <= impact_n <= n_impact):
            print(f"[vision] frame numbers out of range: top={top_n}/{n_top} impact={impact_n}/{n_impact}")
            return None

        tc = top_strip[top_n - 1]
        ic = impact_strip[impact_n - 1]
        print(f"[vision] top={tc['time_ms']}ms(conf={top_conf:.2f})  "
              f"impact={ic['time_ms']}ms(conf={impact_conf:.2f})")
        return {
            "top_fi":      tc["fi"],
            "top_ms":      tc["time_ms"],
            "top_conf":    top_conf,
            "impact_fi":   ic["fi"],
            "impact_ms":   ic["time_ms"],
            "impact_conf": impact_conf,
        }
    except Exception as exc:
        print(f"[vision] sheet selection failed: {exc}")
        return None


def detect_and_extract(cap, fps: float, include_overlays: bool = False,
                       quality: str = "fast", club: str = "unknown"):
    """
    Burst-anchored phase detection. Designed around a single forward decoder
    walk + a few targeted seeks for final phase frames.

    Two quality tiers:

      • "fast" (default, used in production):
          - One motion-only walk of the video (~60 samples, cap.grab() for skips)
          - Address = quietest sample in pre-burst window
          - Top     = lowest-motion sample in [address, burst_start+0.35s]
          - Impact  = highest-motion sample in [burst_start-0.15s, burst_start+62%]
          - Follow  = offset from impact
          - Skips OpenRouter vision contact-sheet call (5–15s saved)
          - Skips _sample_pose_track (5–10s saved) — motionSmoothness comes
            from the same walk samples we already have

      • "accurate": adds the vision contact-sheet selection for top + impact
          and a 50-frame MediaPipe pose track for a tighter motionSmoothness.

    Pose detection is ALWAYS run on the 4 final phase frames (cheap — only 4
    MediaPipe inferences).
    """
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total_frames <= 0:
        empty = [{"frame": None, "overlay_frame": None, "landmarks": None, "time_ms": t}
                 for t in [200, 1400, 2600, 3400]]
        return empty, {}

    accurate = quality == "accurate"

    # ── 1. Single motion walk — reused for burst + smoothness ────────────────
    sample_n = 80 if accurate else 60
    walk_samples = _walk_motion_samples(cap, total_frames, sample_n=sample_n)
    burst_start, burst_end = _detect_burst_from_samples(walk_samples, total_frames, fps)
    burst_span = max(1, burst_end - burst_start)

    # Build a fi → motion lookup for picking phase frames without re-seeking
    sample_motion = {s["fi"]: s["motion"] for s in walk_samples}
    sample_fis_sorted = sorted(sample_motion.keys())

    def _samples_in_window(lo_fi: int, hi_fi: int):
        return [(fi, sample_motion[fi]) for fi in sample_fis_sorted if lo_fi <= fi <= hi_fi]

    # ── 2. Address frame ──────────────────────────────────────────────────────
    # Quietest sample in the pre-burst window (player still at setup).
    addr_lo = max(0, burst_start - int(fps * 2.5))
    addr_hi = max(addr_lo + 3, burst_start - int(fps * 0.25))
    addr_window = _samples_in_window(addr_lo, addr_hi)
    if addr_window:
        # Skip the very first sample — motion is 0 by definition at index 0.
        candidates = addr_window[1:] if len(addr_window) > 1 else addr_window
        addr_fi = min(candidates, key=lambda x: x[1])[0]
    else:
        # No samples in window → fall back to a targeted quietest-frame search.
        addr_fi = _find_quietest_frame(cap, addr_lo, addr_hi)

    # ── 3 + 4. Top + impact windows ──────────────────────────────────────────
    top_lo = addr_fi + max(2, int(fps * 0.20))
    top_hi = min(burst_start + int(fps * 0.35), int(total_frames * 0.82))
    impact_lo = max(burst_start - int(fps * 0.15), top_lo + int(fps * 0.08))
    impact_hi = min(burst_start + int(burst_span * 0.62), int(total_frames * 0.88))

    if top_hi <= top_lo:
        top_hi = top_lo + max(2, int(fps * 0.5))
    if impact_hi <= impact_lo:
        impact_hi = impact_lo + max(2, int(fps * 0.3))

    print(f"[burst] addr={int(addr_fi/fps*1000)}ms  "
          f"burst={int(burst_start/fps*1000)}-{int(burst_end/fps*1000)}ms")
    print(f"[windows] top={int(top_lo/fps*1000)}-{int(top_hi/fps*1000)}ms  "
          f"impact={int(impact_lo/fps*1000)}-{int(impact_hi/fps*1000)}ms")

    # ── 5. Pick top + impact ─────────────────────────────────────────────────
    # Fallback indices (used if windows have no walk samples).
    top_fi = max(top_lo, burst_start - int(fps * 0.05))
    impact_fi = min(impact_hi, burst_start + int(burst_span * 0.25))
    top_method = "motion_minimum"
    impact_method = "motion_peak"
    vision = None

    if accurate:
        # Premium path: GPT-4o picks the best frame from a labeled contact sheet.
        N_STRIP = 12
        top_strip = _extract_strip_frames(cap, fps, total_frames, top_lo, top_hi, N_STRIP)
        impact_strip = _extract_strip_frames(cap, fps, total_frames, impact_lo, impact_hi, N_STRIP)
        vision = select_phases_with_vision(top_strip, impact_strip, club)
        if vision and vision["top_fi"] < vision["impact_fi"]:
            top_fi = vision["top_fi"]
            impact_fi = vision["impact_fi"]
            top_method = "vision_sheet"
            impact_method = "vision_sheet"
            print("[events] using vision-selected top + impact")
        else:
            vision = None

    if not vision:
        top_window = _samples_in_window(top_lo, top_hi)
        impact_window = _samples_in_window(impact_lo, impact_hi)
        if len(top_window) >= 2:
            # Top = lowest-motion sample in the top window (the pause at the top).
            # Drop the very first sample if motion=0 (boundary artefact).
            usable_top = [t for t in top_window if t[1] > 0] or top_window
            top_fi = min(usable_top, key=lambda x: x[1])[0]
        if impact_window:
            impact_fi = max(impact_window, key=lambda x: x[1])[0]
        print(f"[events] motion-energy: top={int(top_fi/fps*1000)}ms  "
              f"impact={int(impact_fi/fps*1000)}ms")

    # ── 6. Follow-through ─────────────────────────────────────────────────────
    ft_min = impact_fi + max(2, int(fps * 0.30))
    ft_fi = min(ft_min + int(fps * 0.20), int(total_frames * 0.96) - 1)

    # ── 7. Enforce ordering ───────────────────────────────────────────────────
    min_gap = max(1, int(fps * 0.04))
    if top_fi <= addr_fi + min_gap:
        top_fi = addr_fi + min_gap
    if impact_fi <= top_fi + min_gap:
        impact_fi = top_fi + min_gap
    if ft_fi <= impact_fi + min_gap:
        ft_fi = impact_fi + min_gap
    ft_fi = min(ft_fi, total_frames - 1)

    phase_fis = [int(addr_fi), int(top_fi), int(impact_fi), int(ft_fi)]
    print(f"[phases] addr={int(addr_fi/fps*1000)}ms  top={int(top_fi/fps*1000)}ms  "
          f"impact={int(impact_fi/fps*1000)}ms  ft={int(ft_fi/fps*1000)}ms")

    # ── 8. Extract final frames + temporal metrics ────────────────────────────
    frames = extract_phase_frames_at_indices(cap, fps, total_frames, phase_fis, include_overlays)

    if accurate:
        # High-resolution motion track for tighter smoothness numbers.
        metric_samples = _sample_pose_track(cap, fps, total_frames, quality)
    else:
        # Reuse the walk samples we already have — no extra video pass.
        metric_samples = walk_samples

    metrics = compute_temporal_metrics(phase_fis, fps, metric_samples)
    metrics["detectionMethods"] = {
        "address": "motion_minimum",
        "top": top_method,
        "impact": impact_method,
        "followThrough": "offset",
    }
    return frames, metrics


def compute_temporal_metrics(phase_fis: List[int], fps: float, samples: List[Dict]) -> Dict:
    """
    Derive timing and smoothness metrics from phase frame indices.
    Returns deterministic values the frontend can include in the AI prompt.
    """
    if len(phase_fis) != 4 or fps <= 0:
        return {"backswingDurationMs": None, "downswingDurationMs": None,
                "tempoRatio": None, "motionSmoothness": None, "computedTempoScore": None}

    addr_fi, top_fi, impact_fi, ft_fi = phase_fis
    backswing_ms = round((top_fi    - addr_fi)   / fps * 1000)
    downswing_ms = round((impact_fi - top_fi)    / fps * 1000)
    ft_ms        = round((ft_fi     - impact_fi) / fps * 1000)

    tempo_ratio = round(backswing_ms / max(downswing_ms, 1), 2)

    # Motion smoothness: inverse of motion variance in the backswing window
    motion_vals = [
        s.get("motion", 0.0) for s in samples
        if addr_fi <= s.get("fi", -1) <= top_fi
    ]
    if len(motion_vals) >= 3:
        arr = np.array(motion_vals, dtype=np.float32)
        cv = float(np.std(arr)) / max(float(np.mean(arr)), 1e-6)  # coefficient of variation
        smoothness = round(max(0, min(100, 100 - cv * 60)), 1)
    else:
        smoothness = None

    # Deterministic tempo score from ratio (tour pros average ~3:1)
    # 2.5–3.5 → 85-95, 2.0–4.0 → 70-84, outside → lower
    if tempo_ratio is not None:
        r = tempo_ratio
        if 2.5 <= r <= 3.5:
            tempo_score = round(85 + min(10, (1 - abs(r - 3.0)) * 10))
        elif 2.0 <= r < 2.5 or 3.5 < r <= 4.0:
            tempo_score = round(70 + (1 - abs(r - 3.0) / 1.5) * 14)
        elif 1.5 <= r < 2.0 or 4.0 < r <= 5.0:
            tempo_score = round(55 + (1 - abs(r - 3.0) / 3.0) * 14)
        else:
            tempo_score = round(max(30, 55 - abs(r - 3.0) * 8))
        tempo_score = max(30, min(98, tempo_score))
    else:
        tempo_score = None

    print(f"[metrics] backswing={backswing_ms}ms downswing={downswing_ms}ms "
          f"ft={ft_ms}ms ratio={tempo_ratio} smoothness={smoothness} tempoScore={tempo_score}")

    return {
        "backswingDurationMs": backswing_ms,
        "downswingDurationMs": downswing_ms,
        "tempoRatio": tempo_ratio,
        "motionSmoothness": smoothness,
        "computedTempoScore": tempo_score,
    }


def transcode_to_h264(input_path: str) -> str:
    """Convert any video format (HEVC, MOV, etc.) to H.264 MP4 OpenCV can decode."""
    output_path = input_path.replace(".mp4", "_h264.mp4")
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", input_path,
             "-c:v", "libx264", "-preset", "fast", "-crf", "23",
             "-an", output_path],
            capture_output=True, timeout=60
        )
        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            print(f"[ffmpeg] transcoded {os.path.getsize(output_path)} bytes")
            return output_path
    except Exception as e:
        print(f"[ffmpeg] transcode failed: {e}")
    return input_path


def open_video(path: str):
    """Open video with OpenCV, auto-transcoding if HEVC/unreadable."""
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


def landmarks_to_json(pose_landmarks):
    return [
        {"x": float(lm.x), "y": float(lm.y), "z": float(lm.z), "visibility": float(lm.visibility)}
        for lm in pose_landmarks.landmark
    ]


def _cv_point(pose_landmarks, idx: int, width: int, height: int, min_visibility: float = OVERLAY_MIN_VISIBILITY):
    lm = pose_landmarks.landmark[idx]
    if lm.visibility < min_visibility:
        return None
    return (
        int(max(0.0, min(1.0, lm.x)) * width),
        int(max(0.0, min(1.0, lm.y)) * height),
    )


def _draw_polyline(frame, points, color, thickness=3, glow=True, dotted=False):
    clean = [p for p in points if p is not None]
    if len(clean) != len(points) or len(clean) < 2:
        return

    if glow:
        glow_layer = frame.copy()
        for start, end in zip(clean, clean[1:]):
            cv2.line(glow_layer, start, end, color, thickness + 7, cv2.LINE_AA)
        cv2.addWeighted(glow_layer, 0.22, frame, 0.78, 0, frame)

    for start, end in zip(clean, clean[1:]):
        if dotted:
            distance = max(1.0, float(np.linalg.norm(np.array(end) - np.array(start))))
            steps = max(2, int(distance // 14))
            for i in range(0, steps, 2):
                a = i / steps
                b = min((i + 1) / steps, 1.0)
                p1 = (int(start[0] + (end[0] - start[0]) * a), int(start[1] + (end[1] - start[1]) * a))
                p2 = (int(start[0] + (end[0] - start[0]) * b), int(start[1] + (end[1] - start[1]) * b))
                cv2.line(frame, p1, p2, color, thickness, cv2.LINE_AA)
        else:
            cv2.line(frame, start, end, color, thickness, cv2.LINE_AA)


def _draw_dot(frame, point, color=OVERLAY_GREEN, radius=4):
    if point is None:
        return
    cv2.circle(frame, point, radius + 2, OVERLAY_WHITE, -1, cv2.LINE_AA)
    cv2.circle(frame, point, radius, color, -1, cv2.LINE_AA)


def draw_golf_overlay(frame, pose_landmarks, handedness: str = "right", show_head_ring: bool = False):
    """
    Minimal ImpactAI biomech overlay. Draws only golf-relevant structure lines,
    not the full MediaPipe skeleton.
    """
    h, w = frame.shape[:2]
    lm = mp_pose.PoseLandmark

    ls = _cv_point(pose_landmarks, lm.LEFT_SHOULDER.value, w, h)
    rs = _cv_point(pose_landmarks, lm.RIGHT_SHOULDER.value, w, h)
    lh = _cv_point(pose_landmarks, lm.LEFT_HIP.value, w, h)
    rh = _cv_point(pose_landmarks, lm.RIGHT_HIP.value, w, h)
    nose = _cv_point(pose_landmarks, lm.NOSE.value, w, h, 0.35)

    lead = "right" if handedness == "left" else "left"
    side_map = {
        "left": {
            "shoulder": lm.LEFT_SHOULDER.value,
            "elbow": lm.LEFT_ELBOW.value,
            "wrist": lm.LEFT_WRIST.value,
            "hip": lm.LEFT_HIP.value,
            "knee": lm.LEFT_KNEE.value,
            "ankle": lm.LEFT_ANKLE.value,
        },
        "right": {
            "shoulder": lm.RIGHT_SHOULDER.value,
            "elbow": lm.RIGHT_ELBOW.value,
            "wrist": lm.RIGHT_WRIST.value,
            "hip": lm.RIGHT_HIP.value,
            "knee": lm.RIGHT_KNEE.value,
            "ankle": lm.RIGHT_ANKLE.value,
        },
    }
    lead_shoulder = _cv_point(pose_landmarks, side_map[lead]["shoulder"], w, h)
    lead_elbow = _cv_point(pose_landmarks, side_map[lead]["elbow"], w, h)
    lead_wrist = _cv_point(pose_landmarks, side_map[lead]["wrist"], w, h)
    lead_hip = _cv_point(pose_landmarks, side_map[lead]["hip"], w, h)
    lead_knee = _cv_point(pose_landmarks, side_map[lead]["knee"], w, h)
    lead_ankle = _cv_point(pose_landmarks, side_map[lead]["ankle"], w, h)

    shoulder_mid = None
    hip_mid = None
    if ls and rs:
        shoulder_mid = ((ls[0] + rs[0]) // 2, (ls[1] + rs[1]) // 2)
        _draw_polyline(frame, [ls, rs], OVERLAY_GREEN, 3, glow=True)
    if lh and rh:
        hip_mid = ((lh[0] + rh[0]) // 2, (lh[1] + rh[1]) // 2)
        _draw_polyline(frame, [lh, rh], OVERLAY_GREEN, 3, glow=True)
    if shoulder_mid and hip_mid:
        _draw_polyline(frame, [shoulder_mid, hip_mid], OVERLAY_WHITE, 3, glow=False, dotted=True)

    _draw_polyline(frame, [lead_shoulder, lead_elbow, lead_wrist], OVERLAY_GREEN, 3, glow=True)
    _draw_polyline(frame, [lead_hip, lead_knee, lead_ankle], OVERLAY_GREEN, 3, glow=True)

    for point in [ls, rs, lh, rh, lead_elbow, lead_wrist, lead_knee, lead_ankle]:
        _draw_dot(frame, point)

    if show_head_ring and nose and ls and rs:
        span = max(24, abs(rs[0] - ls[0]))
        size = int(max(22, min(58, span * 0.42)))
        x = int(nose[0] - size / 2)
        y = int(nose[1] - size * 0.8)
        cv2.rectangle(frame, (x, y), (x + size, y + size), OVERLAY_WHITE, 2, cv2.LINE_AA)


def encode_jpg(frame, quality=80) -> str:
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return base64.b64encode(buf).decode("utf-8")


def resize_for_ai(frame, max_side=640):
    """Resize frame so the longest side is max_side px — keeps AI request small."""
    h, w = frame.shape[:2]
    if max(h, w) <= max_side:
        return frame
    scale = max_side / max(h, w)
    return cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)


def try_detect_pose(pose, frame):
    """Try pose detection with multiple preprocessing passes — returns (landmarks_json, overlay_b64)."""
    h, w = frame.shape[:2]

    def _run(f):
        rgb = cv2.cvtColor(f, cv2.COLOR_BGR2RGB)
        return pose.process(rgb)

    # Attempt 1: CLAHE-enhanced frame (helps outdoor / flat lighting)
    enhanced = _preprocess(frame)
    det = _run(enhanced)
    if det.pose_landmarks:
        overlay = frame.copy()
        draw_golf_overlay(overlay, det.pose_landmarks)
        return landmarks_to_json(det.pose_landmarks), encode_jpg(overlay)

    # Attempt 2: upscale small frames — MediaPipe needs ≥256px on short side
    if min(h, w) < 480:
        scale = 480 / min(h, w)
        upscaled = cv2.resize(enhanced, (int(w * scale), int(h * scale)))
        det2 = _run(upscaled)
        if det2.pose_landmarks:
            overlay = cv2.resize(frame, (int(w * scale), int(h * scale)))
            draw_golf_overlay(overlay, det2.pose_landmarks)
            return landmarks_to_json(det2.pose_landmarks), encode_jpg(overlay)

    # Attempt 3: stronger contrast boost for very flat / overcast footage
    boosted = cv2.convertScaleAbs(enhanced, alpha=1.35, beta=15)
    det3 = _run(boosted)
    if det3.pose_landmarks:
        overlay = frame.copy()
        draw_golf_overlay(overlay, det3.pose_landmarks)
        return landmarks_to_json(det3.pose_landmarks), encode_jpg(overlay)

    # Attempt 4: large upscale regardless of size
    big = cv2.resize(enhanced, (int(w * 1.5), int(h * 1.5)))
    det4 = _run(big)
    if det4.pose_landmarks:
        overlay = frame.copy()
        draw_golf_overlay(overlay, det4.pose_landmarks)
        return landmarks_to_json(det4.pose_landmarks), encode_jpg(overlay)

    print(f"[pose] detection failed on all 4 attempts ({w}x{h})")
    return None, None


def extract_frames_with_pose(cap, ts_list: List[int], fps: float, include_overlays: bool = False):
    results = []
    # model_complexity=0 is lighter and more robust for side-on/bent-over golf poses
    with mp_pose.Pose(
        static_image_mode=True,
        model_complexity=0,
        enable_segmentation=False,
        min_detection_confidence=0.2,
        min_tracking_confidence=0.2,
    ) as pose:
        for ms in ts_list:
            frame_idx = int((ms / 1000.0) * fps)
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = cap.read()
            if not ret:
                print(f"[pose] could not read frame at {ms}ms (idx {frame_idx})")
                results.append({"frame": None, "overlay_frame": None, "landmarks": None, "time_ms": ms})
                continue

            frame_b64 = encode_jpg(resize_for_ai(frame))
            if include_overlays:
                landmarks, overlay_b64 = try_detect_pose(pose, frame)
            else:
                landmarks = detect_pose_landmarks(pose, frame)
                overlay_b64 = None
            print(f"[pose] {ms}ms — landmarks: {'YES' if landmarks else 'NO'}")

            results.append({
                "frame": frame_b64,
                "overlay_frame": overlay_b64,
                "landmarks": landmarks,
                "time_ms": ms,
            })
    return results


@app.post("/extract-key-frames")
def extract_key_frames(req: ExtractKeyFramesRequest):
    """
    Download a video from a URL, extract frames at specific timestamps (ms),
    run MediaPipe pose detection on each, and return base64 frames + landmarks.
    """
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            urllib.request.urlretrieve(req.video_url, tmp.name)
            tmp_path = tmp.name

        cap, _, cleanup = open_video(tmp_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        quality = req.quality if req.quality in ["fast", "accurate"] else "fast"
        if req.timestamps_ms:
            results = extract_frames_with_pose(cap, req.timestamps_ms, fps, req.include_overlays)
            metrics = {}
        else:
            results, metrics = detect_and_extract(
                cap, fps, req.include_overlays, quality, club=req.club or "unknown"
            )

        cap.release()
        if cleanup and os.path.exists(cleanup):
            os.remove(cleanup)
        return {"frames": results, "metrics": metrics}

    except Exception as e:
        print(f"[extract-key-frames] error: {e}")
        return {"frames": []}
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


@app.post("/extract-key-frames-upload")
async def extract_key_frames_upload(
    video: UploadFile = File(...),
    include_overlays: bool = Form(False),
    quality: str = Form("fast"),
    club: str = Form("unknown"),
):
    tmp_path = None
    cleanup = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            tmp.write(await video.read())
            tmp_path = tmp.name

        cap, _, cleanup = open_video(tmp_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        quality = quality if quality in ["fast", "accurate"] else "fast"
        results, metrics = detect_and_extract(cap, fps, include_overlays, quality, club=club)

        cap.release()
        return {"frames": results, "metrics": metrics}

    except Exception as e:
        print(f"[extract-key-frames-upload] error: {e}")
        return {"frames": [], "metrics": {}}
    finally:
        for p in [tmp_path, cleanup]:
            if p and os.path.exists(p):
                os.remove(p)


@app.post("/extract-frames")
async def extract_frames(
    video: UploadFile = File(...),
    frameCount: int = Form(8),
    mode: str = Form("analysis"),
):
    """
    Accept a video file, extract evenly-spaced frames using OpenCV,
    return them as base64 JPEG strings.

    Two modes:

      • "analysis"        — 6 to 8 frames. For OpenRouter coaching.
                            Trims first/last 8% to avoid pre/post-swing dead time.
                            Higher JPEG quality (72), 640px max side.

      • "phaseDetection"  — 60 to 90 frames. For client-side selection of
                            Address / Top / Impact / Follow-Through.
                            Trims first/last 2% only (we need the whole swing).
                            Smaller JPEGs (quality 62, 480px max side) since
                            we're shipping many more.
    """
    if mode not in ("analysis", "phaseDetection"):
        mode = "analysis"

    if mode == "phaseDetection":
        frameCount = max(24, min(120, frameCount))
        lo_pct, hi_pct = 0.02, 0.98
        # Phone screens are ~390px wide and the VA modal renders frames at
        # less than that. 384px is plenty of resolution for both display
        # AND the motion-energy calc, and saves ~25% in JPEG encode +
        # transfer time over the previous 480.
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
        print(f"[extract-frames] mode={mode} requested={frameCount} total_frames={total_frames} fps={fps:.2f}")
        if total_frames <= 0:
            cap.release()
            return {"frames": [], "mode": mode, "fps": fps, "total_frames": 0, "duration_ms": 0,
                    "lo_pct": lo_pct, "hi_pct": hi_pct}

        count = min(frameCount, total_frames)
        lo = int(total_frames * lo_pct)
        hi = int(total_frames * hi_pct)
        span = max(1, hi - lo)
        indices = [lo + int(i * span / max(count - 1, 1)) for i in range(count)]
        frames_b64: list[str] = []
        # Per-sample motion energy. Only populated for phaseDetection mode
        # because the client uses it to find the swing burst. For analysis
        # mode we'd just be paying the cost for no benefit.
        motion: list[float] = []
        prev_gray = None
        motion_h = 90  # downscale-then-diff is plenty for burst detection

        for idx in indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, min(idx, total_frames - 1)))
            ret, frame = cap.read()
            if not ret:
                continue
            # CLAHE only for analysis — phaseDetection wants raw motion fidelity
            processed = _preprocess(frame) if mode == "analysis" else frame
            small = resize_for_ai(processed, max_side=max_side)
            _, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, jpeg_q])
            frames_b64.append(base64.b64encode(buf).decode("utf-8"))

            if mode == "phaseDetection":
                # Downscale aggressively for motion calc — we only need a
                # rough scalar per frame. ~90px tall keeps the math <0.1ms.
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

        # Audio impact detection for phaseDetection mode. The mic-captured
        # click is the most precise signal we have for impact (±1 frame).
        # We additionally compute the dense-frame index so the client picker
        # can use it directly without inverting the index mapping. Sequential
        # after the frame loop (~200-500ms) — short enough that we don't
        # bother making it async.
        audio_impact_out = None
        if mode == "phaseDetection":
            ai = detect_audio_impact(tmp_path, fps, total_frames, lo_pct, hi_pct)
            if ai:
                # Map the audio-derived video frame index onto the dense
                # frames array we just emitted. `indices` is the actual list
                # of source-video frame indices for each dense frame, in
                # order, so the dense index is just the position of the
                # nearest entry.
                if indices:
                    diffs = [abs(idx - ai["frame_idx"]) for idx in indices]
                    dense_idx = int(diffs.index(min(diffs)))
                else:
                    dense_idx = -1
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
            avg = (sum(len(f) for f in frames_b64) // max(len(frames_b64), 1))
            mx = max(motion) if motion else 0.0
            mn = min(motion) if motion else 0.0
            ai_tag = (f" audio_impact_dense={audio_impact_out['denseIdx']} "
                      f"conf={audio_impact_out['confidence']:.2f}"
                      if audio_impact_out else "")
            print(f"[extract-frames] returning {len(frames_b64)} phaseDetection frames, "
                  f"avg_size={avg} motion_range=[{mn:.2f},{mx:.2f}]{ai_tag}")

        # Return video metadata alongside frames so the client can convert
        # picked frame indices back to video timestamps — needed for accurate
        # tempo metrics in the dense-frame phase-detection pipeline.
        return {
            "frames": frames_b64,
            "mode": mode,
            "fps": fps,
            "total_frames": total_frames,
            "duration_ms": duration_ms,
            "lo_pct": lo_pct,
            "hi_pct": hi_pct,
            # motion[i] = grayscale absdiff mean between sampled frame i and i-1.
            # motion[0] = 0 by convention. Only present in phaseDetection mode.
            "motion": motion,
            # Audio-derived impact location. Only present (and only attempted)
            # in phaseDetection mode. null when no ffmpeg available, audio is
            # silent, or no clear peak.
            "audio_impact": audio_impact_out,
        }

    except Exception as e:
        print(f"[extract-frames] error: {e}")
        return {"frames": [], "mode": mode}
    finally:
        for p in [tmp_path, cleanup_path]:
            if p and os.path.exists(p):
                os.remove(p)


@app.post("/detect-phases-pose")
async def detect_phases_pose(
    video: UploadFile = File(...),
    club: str = Form("unknown"),
    include_overlays: bool = Form(False),
):
    """
    Pose-based swing phase detection — the right way.

    Pipeline (single pass, ~3-5s total):
    1. Sample ~30 frames evenly across the video.
    2. Run MediaPipe Pose on each, tracking the golfer's hand (wrist) Y-position
       and frame-to-frame motion. (Same proven _sample_pose_track helper that
       the slower /extract-key-frames-upload "accurate" path uses.)
    3. Hand-off to detect_swing_events, which finds:
        - Impact = peak combined motion+wrist-speed energy
        - Top of backswing = last local energy minimum before impact (the
          brief pause where the club reverses direction)
        - Address = lowest-energy frame in the first 22% (golfer still still)
        - Finish = ~0.35s after impact
    4. Seek to those exact video-frame indices, encode at full quality, and
       run MediaPipe again to attach landmarks for the overlay.
    5. Compute deterministic tempo metrics from the picked indices.

    This bypasses the brittle /extract-key-frames-upload flow and the
    percentage-window dense fallback. The phase decisions come straight
    from physical signal in the video (hand trajectory + scene motion),
    so they're correct regardless of how the user trimmed the recording.
    """
    tmp_path = None
    cleanup_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            tmp.write(await video.read())
            tmp_path = tmp.name

        cap, _, cleanup_path = open_video(tmp_path)
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration_ms = int((total_frames / max(fps, 1.0)) * 1000) if total_frames > 0 else 0

        if total_frames <= 0:
            cap.release()
            print("[detect-phases-pose] empty video")
            return {"frames": [], "metrics": None, "fps": fps, "total_frames": 0}

        print(f"[detect-phases-pose] total_frames={total_frames} fps={fps:.2f} club={club}")

        # 1-2. Pose-tracked motion samples (~30 frames, ~1.5-2.5s).
        samples = _sample_pose_track(cap, fps, total_frames, quality="fast")
        if not samples or len(samples) < 6:
            cap.release()
            print(f"[detect-phases-pose] not enough samples ({len(samples) if samples else 0})")
            return {"frames": [], "metrics": None, "fps": fps, "total_frames": total_frames}

        # 3. Phase detection from energy curve.
        events = detect_swing_events(samples, total_frames, fps)
        if not events:
            cap.release()
            print("[detect-phases-pose] detect_swing_events returned None")
            return {"frames": [], "metrics": None, "fps": fps, "total_frames": total_frames}

        phase_fis, confidence, methods = events
        phase_labels = ["setup", "top", "impact", "finish"]
        phase_fis = list(phase_fis)
        print(f"[detect-phases-pose] pose indices={phase_fis} "
              f"ms={[int(fi/fps*1000) for fi in phase_fis]} "
              f"methods={methods}")

        # 3b. AUDIO-OVERRIDE — try locating impact from the audio click. When
        # confident, replace the pose-derived impact frame with the audio one
        # and shift top / finish to maintain a sensible swing arc around it.
        # This is the single biggest accuracy win for phase detection: impact
        # is the only phase that produces a deterministic, sub-frame signal
        # that's directly observable (the sound of the clubface meeting the
        # ball). Pose tracking can only see "the body moved fast around here",
        # which is ±3-5 frames at best.
        audio_impact = detect_audio_impact(tmp_path, fps, total_frames,
                                            lo_pct=0.10, hi_pct=0.92)
        AUDIO_CONFIDENCE_THRESHOLD = 0.40
        if audio_impact and audio_impact["confidence"] >= AUDIO_CONFIDENCE_THRESHOLD:
            audio_fi = int(audio_impact["frame_idx"])
            pose_fi = int(phase_fis[2])
            delta = audio_fi - pose_fi
            print(f"[detect-phases-pose] audio override: pose impact={pose_fi} "
                  f"→ audio impact={audio_fi} (Δ={delta} frames, conf={audio_impact['confidence']:.2f})")
            phase_fis[2] = audio_fi
            methods["impact"] = "audio_peak"
            confidence["impact"] = max(confidence.get("impact", 0.5),
                                       audio_impact["confidence"])

            # Keep the swing arc coherent: top must be before impact, finish
            # must be after. Shift each by `delta` if they end up on the wrong
            # side, then clamp to plausible distances from impact.
            #   • Top: pose detector placed it relative to old impact, so just
            #     translate it by the same delta. Then ensure it's ≥0.15s and
            #     ≤1.2s before audio impact (anything outside that is implausible
            #     for a normal swing tempo).
            min_top_gap = max(2, int(0.15 * fps))   # tour-fast = ~0.18s
            max_top_gap = max(min_top_gap + 1, int(1.20 * fps))
            new_top = phase_fis[1] + delta
            if new_top < 0 or new_top >= phase_fis[2] - min_top_gap:
                new_top = phase_fis[2] - max(min_top_gap, int(0.45 * fps))
            elif phase_fis[2] - new_top > max_top_gap:
                new_top = phase_fis[2] - max_top_gap
            phase_fis[1] = max(0, new_top)

            # Address: just nudge by the same delta if it stays valid; otherwise
            # re-anchor at the lowest-energy sample in the first quarter.
            new_addr = phase_fis[0] + delta if delta < 0 else phase_fis[0]
            if new_addr < 0 or new_addr >= phase_fis[1]:
                new_addr = max(0, phase_fis[1] - max(2, int(0.30 * fps)))
            phase_fis[0] = new_addr

            # Finish: ~0.35s after impact is a reliable target for a clean
            # hold-finish frame; clamp to the actual video length.
            post_impact = max(2, int(0.35 * fps))
            phase_fis[3] = min(total_frames - 1, phase_fis[2] + post_impact)

            # Sanity: ensure strict monotonicity.
            for i in range(1, 4):
                if phase_fis[i] <= phase_fis[i - 1]:
                    phase_fis[i] = min(total_frames - 1, phase_fis[i - 1] + 1)

            print(f"[detect-phases-pose] post-audio indices={phase_fis} "
                  f"ms={[int(fi/fps*1000) for fi in phase_fis]}")
        elif audio_impact:
            print(f"[detect-phases-pose] audio impact found but confidence "
                  f"{audio_impact['confidence']:.2f} below threshold "
                  f"{AUDIO_CONFIDENCE_THRESHOLD} — using pose-only result")

        # 4. Extract the 4 phase frames at full quality + landmarks.
        ts_list = [int(fi / fps * 1000) for fi in phase_fis]
        results = extract_frames_with_pose(cap, ts_list, fps, include_overlays)

        # 5. Tempo metrics from the picked indices + smoothness from samples.
        metrics = compute_temporal_metrics(phase_fis, fps, samples)

        # Attach confidence + detection method metadata for downstream consumers.
        metrics_out = dict(metrics) if metrics else {}
        metrics_out["confidence"] = confidence
        metrics_out["detectionMethods"] = {
            "address": methods.get("address", "energy_minimum"),
            "top": methods.get("top", "local_minimum"),
            "impact": methods.get("impact", "energy_peak"),
            "followThrough": methods.get("followThrough", "post_impact_window"),
        }
        if audio_impact:
            metrics_out["audioImpact"] = {
                "frameIdx": int(audio_impact["frame_idx"]),
                "timeMs": int(audio_impact["time_ms"]),
                "confidence": float(audio_impact["confidence"]),
                "peakToMedianRatio": float(audio_impact["peak_to_median_ratio"]),
            }

        # Annotate each phase frame with its label + confidence so the client
        # can drop them straight into VisualAnalysis without re-indexing.
        for i, label in enumerate(phase_labels):
            if i < len(results):
                results[i]["phase"] = label
                results[i]["confidence"] = confidence.get(label if label != "finish" else "followThrough", 0.5)

        cap.release()
        print(f"[detect-phases-pose] returning {len(results)} frames "
              f"({sum(1 for r in results if r.get('frame'))} valid)")
        return {
            "frames": results,
            "metrics": metrics_out,
            "fps": fps,
            "total_frames": total_frames,
            "duration_ms": duration_ms,
        }

    except Exception as e:
        print(f"[detect-phases-pose] error: {e}")
        import traceback
        traceback.print_exc()
        return {"frames": [], "metrics": None}
    finally:
        for p in [tmp_path, cleanup_path]:
            if p and os.path.exists(p):
                os.remove(p)


@app.post("/analyze-frames")
def analyze_frames(req: AnalyzeFramesRequest):
    """
    Accept up to 4 base64 JPEG frames, run MediaPipe Pose on each (static mode),
    return normalized landmarks per frame. Null entry = detection failed.
    """
    results = []
    with mp_pose.Pose(
        static_image_mode=True,
        model_complexity=1,
        enable_segmentation=False,
        min_detection_confidence=0.5,
    ) as pose:
        for frame_b64 in req.frames:
            if not frame_b64:
                results.append(None)
                continue
            try:
                img_bytes = base64.b64decode(frame_b64)
                np_arr = np.frombuffer(img_bytes, np.uint8)
                img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
                if img is None:
                    results.append(None)
                    continue
                rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                detection = pose.process(rgb)
                if detection.pose_landmarks:
                    landmarks = [
                        {
                            "x": float(lm.x),
                            "y": float(lm.y),
                            "z": float(lm.z),
                            "visibility": float(lm.visibility),
                        }
                        for lm in detection.pose_landmarks.landmark
                    ]
                    results.append(landmarks)
                else:
                    results.append(None)
            except Exception as e:
                print(f"[analyze-frames] frame error: {e}")
                results.append(None)
    return {"frames": results}


@app.post("/process-overlay")
async def process_overlay(req: ProcessRequest, background_tasks: BackgroundTasks):
    supabase.table("swings").update({"overlay_status": "processing"}).eq("id", req.swing_id).execute()
    background_tasks.add_task(run_mediapipe, req.swing_id, req.video_url, req.user_id)
    return {"status": "processing", "swing_id": req.swing_id}


def run_mediapipe(swing_id: str, video_url: str, user_id: str):
    input_path = None
    output_path = None
    try:
        # Download original video
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            urllib.request.urlretrieve(video_url, tmp.name)
            input_path = tmp.name

        output_path = input_path.replace(".mp4", "_overlay.mp4")

        cap = cv2.VideoCapture(input_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(output_path, fourcc, fps, (w, h))

        with mp_pose.Pose(
            static_image_mode=False,
            model_complexity=1,
            smooth_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        ) as pose:
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret:
                    break

                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                results = pose.process(rgb)

                if results.pose_landmarks:
                    draw_golf_overlay(frame, results.pose_landmarks)

                writer.write(frame)

        cap.release()
        writer.release()

        # Upload overlay video to Supabase Storage
        overlay_storage_path = f"{user_id}/{swing_id}_overlay.mp4"
        with open(output_path, "rb") as f:
            supabase.storage.from_(BUCKET).upload(
                overlay_storage_path,
                f,
                {"content-type": "video/mp4", "upsert": "true"},
            )

        overlay_url = supabase.storage.from_(BUCKET).get_public_url(overlay_storage_path)

        supabase.table("swings").update({
            "overlay_video_url": overlay_url,
            "overlay_status": "completed",
        }).eq("id", swing_id).execute()

        print(f"[mediapipe] overlay complete for swing {swing_id}")

    except Exception as e:
        print(f"[mediapipe] error for swing {swing_id}: {e}")
        supabase.table("swings").update({"overlay_status": "failed"}).eq("id", swing_id).execute()
    finally:
        for path in [input_path, output_path]:
            if path and os.path.exists(path):
                os.remove(path)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
