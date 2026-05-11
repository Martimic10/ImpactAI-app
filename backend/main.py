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

# Prompt for vision-assisted event selection
_EVENT_PROMPT = (
    "You are a golf swing video analyst. Your ONLY task is to identify the correct "
    "event frames — do NOT analyze swing quality.\n\n"
    "TOP OF BACKSWING: club/hands at maximum backswing position, immediately before "
    "the downswing starts. NOT address. NOT early takeaway. NOT mid-downswing.\n\n"
    "IMPACT: clubhead at or closest to the golf ball / contact point. "
    "If exact contact is between frames, choose the frame immediately BEFORE contact. "
    "Do NOT choose follow-through. Do NOT choose a frame after the club has clearly passed.\n\n"
    "Rules: use visible club position if possible; use hand/wrist as backup. "
    "Bias impact slightly early rather than late. If unsure, lower confidence.\n\n"
    "Return ONLY valid JSON — no markdown, no explanation:\n"
    '{"topOfBackswing":{"candidateId":"top_NN","confidence":0.0},'
    '"impact":{"candidateId":"impact_NN","confidence":0.0}}'
)

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


def find_swing_burst(cap, total_frames: int, fps: float):
    """
    Scan for the main swing burst.
    Only considers runs that START before 75% of the video —
    the actual swing never begins in the last quarter of the clip.
    Picks the run with the highest total motion score among those.
    """
    scan_n = min(40, total_frames)
    step = max(1, total_frames // scan_n)
    scores, prev_gray = [], None

    for i in range(0, total_frames, step):
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ret, frame = cap.read()
        if not ret:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape
        roi = cv2.resize(gray[int(h*0.05):int(h*0.92), int(w*0.08):int(w*0.92)], (80, 140))
        score = 0.0 if prev_gray is None else float(cv2.absdiff(roi, prev_gray).mean())
        prev_gray = roi
        scores.append((i, score))

    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    if len(scores) < 3:
        return 0, total_frames - 1

    motion = np.array([s for _, s in scores], dtype=np.float32)
    threshold = max(float(np.percentile(motion, 55)), float(motion.mean() * 0.7), 1.0)
    active_flags = [s >= threshold for _, s in scores]

    max_gap = max(1, int(len(scores) * 0.10))
    runs, run_start, prev_active = [], None, -max_gap - 1
    for idx in range(len(scores)):
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

    # Only consider runs that START before 75% of the video
    cutoff_idx = int(len(scores) * 0.75)
    early_runs = [r for r in runs if r[0] < cutoff_idx]
    candidates = early_runs if early_runs else runs

    best = max(candidates, key=lambda r: sum(scores[i][1] for i in range(r[0], r[1] + 1)))
    start_fi = max(0, scores[best[0]][0] - step)
    end_fi   = min(total_frames - 1, scores[best[1]][0] + step * 2)

    print(f"[burst] {int(start_fi/fps*1000)}ms–{int(end_fi/fps*1000)}ms "
          f"({len(runs)} runs, {len(candidates)} early, picked {best})")
    return start_fi, end_fi


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
    """
    if total_frames <= 0:
        return []

    # 50 samples: enough resolution for fast swings, stays well under Render timeout
    max_samples = 50
    step = max(1, int(np.ceil(total_frames / max_samples)))

    samples = []
    prev_gray = None
    # model_complexity=0 for speed — we process up to 80 frames here
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

            enhanced = _preprocess(frame)
            gray = cv2.cvtColor(enhanced, cv2.COLOR_BGR2GRAY)
            h, w = gray.shape
            roi = cv2.resize(gray[int(h * 0.05):int(h * 0.95), int(w * 0.05):int(w * 0.95)], (96, 160))
            motion = 0.0 if prev_gray is None else float(cv2.absdiff(roi, prev_gray).mean())
            prev_gray = roi

            rgb = cv2.cvtColor(enhanced, cv2.COLOR_BGR2RGB)
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


def extract_candidate_window(cap, fps: float, total_frames: int,
                             lo_fi: int, hi_fi: int,
                             n: int, prefix: str) -> List[Dict]:
    """
    Extract n evenly-spaced thumbnail frames between lo_fi and hi_fi.
    Returns list of {id, fi, time_ms, frame} dicts (frame = base64 JPEG).
    """
    lo_fi = max(0, lo_fi)
    hi_fi = min(total_frames - 1, hi_fi)
    if hi_fi <= lo_fi or n < 1:
        return []
    step = max(1, (hi_fi - lo_fi) // max(n - 1, 1))
    fis  = []
    fi   = lo_fi
    while fi <= hi_fi and len(fis) < n:
        fis.append(fi)
        fi += step

    results = []
    for idx, fi in enumerate(fis):
        cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
        ret, frame = cap.read()
        if not ret:
            continue
        # Small thumbnails — 320px max is enough for vision selection
        small = resize_for_ai(frame, max_side=320)
        b64   = encode_jpg(small, quality=65)
        results.append({
            "id":      f"{prefix}_{idx+1:02d}",
            "fi":      fi,
            "time_ms": int(fi / fps * 1000),
            "frame":   b64,
        })
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    return results


def select_events_with_vision(top_cands: List[Dict], impact_cands: List[Dict],
                               club: str = "unknown") -> Optional[Dict]:
    """
    Send candidate thumbnails to OpenRouter vision and get the best top/impact frame.
    Returns {"top_fi", "top_ms", "top_conf", "impact_fi", "impact_ms", "impact_conf"} or None.
    Falls back silently if the API key is missing or the call fails.
    """
    if not OPENROUTER_KEY or not top_cands or not impact_cands:
        return None

    # Build the multimodal message — label each candidate clearly
    content = []
    content.append({"type": "text",
                    "text": f"Club: {club}\n\nTOP OF BACKSWING CANDIDATES ({len(top_cands)} frames):"})
    for c in top_cands:
        content.append({"type": "text", "text": f"[{c['id']}] t={c['time_ms']}ms"})
        content.append({"type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{c['frame']}",
                                      "detail": "low"}})

    content.append({"type": "text",
                    "text": f"\nIMPACT CANDIDATES ({len(impact_cands)} frames):"})
    for c in impact_cands:
        content.append({"type": "text", "text": f"[{c['id']}] t={c['time_ms']}ms"})
        content.append({"type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{c['frame']}",
                                      "detail": "low"}})

    content.append({"type": "text", "text": "\nReturn JSON only."})

    body = json.dumps({
        "model": "openai/gpt-4o",
        "messages": [
            {"role": "system", "content": _EVENT_PROMPT},
            {"role": "user",   "content": content},
        ],
        "max_tokens": 120,
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
        with urllib.request.urlopen(req, timeout=22) as resp:
            raw = json.loads(resp.read())["choices"][0]["message"]["content"]
        start = raw.index("{")
        end   = raw.rindex("}") + 1
        sel   = json.loads(raw[start:end])

        top_id     = sel.get("topOfBackswing", {}).get("candidateId", "")
        impact_id  = sel.get("impact",         {}).get("candidateId", "")
        top_conf   = float(sel.get("topOfBackswing", {}).get("confidence", 0.5))
        impact_conf = float(sel.get("impact",        {}).get("confidence", 0.5))

        top_c    = next((c for c in top_cands    if c["id"] == top_id),    None)
        impact_c = next((c for c in impact_cands if c["id"] == impact_id), None)

        if not top_c or not impact_c:
            print(f"[vision] candidate lookup failed: top={top_id} impact={impact_id}")
            return None

        print(f"[vision] top={top_c['time_ms']}ms(conf={top_conf:.2f}) "
              f"impact={impact_c['time_ms']}ms(conf={impact_conf:.2f})")
        return {
            "top_fi":      top_c["fi"],
            "top_ms":      top_c["time_ms"],
            "top_conf":    top_conf,
            "impact_fi":   impact_c["fi"],
            "impact_ms":   impact_c["time_ms"],
            "impact_conf": impact_conf,
        }
    except Exception as exc:
        print(f"[vision] selection failed: {exc}")
        return None


def detect_and_extract(cap, fps: float, include_overlays: bool = False,
                       quality: str = "fast", club: str = "unknown") -> List[dict]:
    """
    Pose-based phase detection:

       SETUP   — stable early hand position near address
       TOP     — high, far hand position before the fast downswing
       IMPACT  — fast post-top return near the setup hand position
       FOLLOW  — first post-impact slowdown, or a short time after impact

    Falls back to the older motion-burst percentages when landmark coverage is
    too sparse or noisy to produce ordered phase frames.
    """
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total_frames <= 0:
        return [{"frame": None, "overlay_frame": None, "landmarks": None,
                 "time_ms": int(total_frames * p / fps * 1000)}
                for p in [0.08, 0.40, 0.62, 0.82]]

    try:
        samples   = _sample_pose_track(cap, fps, total_frames, quality)
        detection = detect_swing_events(samples, total_frames, fps)

        if detection is not None:
            phase_fis, confidence, methods = detection
            addr_fi, top_fi_h, impact_fi_h, ft_fi = phase_fis

            # ── Vision-assisted top + impact selection ──────────────────────
            # Build candidate windows around the heuristic estimates
            top_lo    = addr_fi + max(3, int(total_frames * 0.08))
            top_hi    = min(int(total_frames * 0.62), top_fi_h + int(fps * 1.5))
            impact_lo = top_fi_h + max(2, int(fps * 0.05))
            impact_hi = min(int(total_frames * 0.88), impact_fi_h + int(fps * 1.2))

            top_cands    = extract_candidate_window(cap, fps, total_frames,
                                                    top_lo, top_hi, 7, "top")
            impact_cands = extract_candidate_window(cap, fps, total_frames,
                                                    impact_lo, impact_hi, 7, "impact")

            vision = select_events_with_vision(top_cands, impact_cands, club)

            if vision and vision["top_fi"] < vision["impact_fi"]:
                phase_fis = [addr_fi, vision["top_fi"], vision["impact_fi"], ft_fi]
                confidence["top"]    = vision["top_conf"]
                confidence["impact"] = vision["impact_conf"]
                methods["top"]    = "vision_assisted"
                methods["impact"] = "vision_assisted"
                print("[events] using vision-selected top+impact")
            else:
                if vision:
                    print("[events] vision result invalid (out of order) — using heuristic")
                phase_fis = refine_phase_indices(cap, fps, total_frames, phase_fis, quality)

            # Validate final ordering
            if not (phase_fis[0] < phase_fis[1] < phase_fis[2] < phase_fis[3]):
                print("[events] final phase_fis out of order — fallback")
                raise ValueError("out of order")

            frames  = extract_phase_frames_at_indices(
                cap, fps, total_frames, phase_fis, include_overlays)
            metrics = compute_temporal_metrics(phase_fis, fps, samples)
            metrics["eventConfidence"]  = confidence
            metrics["detectionMethods"] = methods
            return frames, metrics

        print("[events] insufficient pose track; falling back to motion burst structure")
    except Exception as exc:
        print(f"[events] detection threw: {exc} — falling back to motion burst")
        samples = []

    burst_start, burst_end = find_swing_burst(cap, total_frames, fps)
    frames = extract_phase_frames_by_structure(cap, fps, total_frames, burst_start, burst_end)
    span   = max(1, burst_end - burst_start)
    fallback_fis = [
        int(total_frames * 0.08),
        burst_start,
        burst_start + int(span * 0.25),
        burst_start + int(span * 0.82),
    ]
    metrics = compute_temporal_metrics(fallback_fis, fps, samples)
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
        results, metrics = detect_and_extract(cap, fps, include_overlays, quality)

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
async def extract_frames(video: UploadFile = File(...), frameCount: int = Form(6)):
    """
    Accept a video file, extract evenly-spaced frames using OpenCV,
    return them as base64 JPEG strings for AI analysis.
    """
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            tmp.write(await video.read())
            tmp_path = tmp.name

        cap, _, cleanup_path = open_video(tmp_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        print(f"[extract-frames] total_frames={total_frames}")
        if total_frames <= 0:
            cap.release()
            return {"frames": []}

        count = min(frameCount, total_frames)
        # Skip first and last 8% — usually just the golfer walking up or
        # standing still after the swing; the real swing is in the middle.
        lo = int(total_frames * 0.08)
        hi = int(total_frames * 0.92)
        span = max(1, hi - lo)
        indices = [lo + int(i * span / max(count - 1, 1)) for i in range(count)]
        frames_b64 = []

        for idx in indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, min(idx, total_frames - 1)))
            ret, frame = cap.read()
            if not ret:
                continue
            # CLAHE enhances contrast for outdoor/flat-lit footage
            enhanced = _preprocess(frame)
            small = resize_for_ai(enhanced, max_side=640)
            _, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 72])
            frames_b64.append(base64.b64encode(buf).decode("utf-8"))

        cap.release()
        sizes = [len(f) for f in frames_b64]
        print(f"[extract-frames] returning {len(frames_b64)} frames, sizes: {sizes}")
        return {"frames": frames_b64}

    except Exception as e:
        print(f"[extract-frames] error: {e}")
        return {"frames": []}
    finally:
        for p in [tmp_path, cleanup_path if 'cleanup_path' in dir() else None]:
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
