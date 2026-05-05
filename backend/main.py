import os
import base64
import subprocess
import cv2
import numpy as np
import tempfile
import urllib.request
import mediapipe as mp
from fastapi import FastAPI, BackgroundTasks, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
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

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

mp_pose = mp.solutions.pose
mp_drawing = mp.solutions.drawing_utils
mp_drawing_styles = mp.solutions.drawing_styles

# Landmark drawing customisation — green joints with white skeleton lines
LANDMARK_STYLE = mp_drawing.DrawingSpec(color=(76, 175, 80), thickness=4, circle_radius=4)
CONNECTION_STYLE = mp_drawing.DrawingSpec(color=(255, 255, 255), thickness=3)


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


def detect_and_extract(cap, fps: float) -> List[dict]:
    """
    48-frame single-pass phase detection + extraction.

    Uses 2D distance from contact zone (setup wrist position) to detect all
    phases — works for both face-on and down-the-line camera angles.

    Phases:
      setup   — first stable frame in first 15%
      top     — wrist farthest from contact zone (max 2D distance) before 65%
      impact  — wrist closest to contact zone (min 2D distance) after top,
                biased early using peak wrist speed
      follow  — first frame where wrists are clearly higher/further than impact

    Falls back to percentage windows when landmark coverage is < 30%.
    """
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fallback_pcts = [0.10, 0.35, 0.60, 0.75]

    def read_frame_result(pct, method="fallback"):
        fi = min(int(total_frames * pct), max(0, total_frames - 1))
        cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
        ret, frame = cap.read()
        time_ms = int(fi / fps * 1000)
        b64 = encode_jpg(resize_for_ai(frame)) if ret else None
        return {"frame": b64, "overlay_frame": None, "landmarks": None,
                "time_ms": time_ms, "method": method}

    if total_frames <= 0:
        return [read_frame_result(p) for p in fallback_pcts]

    # ── 1. Sample 48 frames ───────────────────────────────────────────────────
    N = max(4, min(48, total_frames))
    step = total_frames / N
    samples = []

    with mp_pose.Pose(
        static_image_mode=True,
        model_complexity=0,
        enable_segmentation=False,
        min_detection_confidence=0.2,
    ) as pose:
        for i in range(N):
            fi = min(int(i * step), total_frames - 1)
            cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
            ret, frame = cap.read()
            if not ret:
                continue
            time_ms = int(fi / fps * 1000)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            det = pose.process(rgb)

            wrist_y, wrist_x, landmarks = None, None, None
            if det.pose_landmarks:
                lms = det.pose_landmarks.landmark
                lw, rw = lms[15], lms[16]
                if lw.visibility > 0.2 and rw.visibility > 0.2:
                    wrist_y = (lw.y + rw.y) / 2.0
                    wrist_x = (lw.x + rw.x) / 2.0
                elif lw.visibility > 0.2:
                    wrist_y, wrist_x = lw.y, lw.x
                elif rw.visibility > 0.2:
                    wrist_y, wrist_x = rw.y, rw.x
                landmarks = landmarks_to_json(det.pose_landmarks)

            samples.append({
                "i": len(samples), "fi": fi, "time_ms": time_ms,
                "wy": wrist_y, "wx": wrist_x, "landmarks": landmarks,
                "frame_b64": encode_jpg(resize_for_ai(frame)),
                "smooth_y": None, "smooth_x": None,
                "speed": None, "dist": None,
            })

    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    n = len(samples)
    if n < 4:
        return [read_frame_result(p) for p in fallback_pcts]

    lm_count = sum(1 for s in samples if s["wy"] is not None)
    use_motion = lm_count >= int(n * 0.30)

    # ── 2. Smooth wrist positions (3-frame moving average) ────────────────────
    if use_motion:
        for i in range(n):
            ys = [samples[j]["wy"] for j in range(max(0, i - 1), min(n, i + 2))
                  if samples[j]["wy"] is not None]
            xs = [samples[j]["wx"] for j in range(max(0, i - 1), min(n, i + 2))
                  if samples[j]["wx"] is not None]
            samples[i]["smooth_y"] = sum(ys) / len(ys) if ys else None
            samples[i]["smooth_x"] = sum(xs) / len(xs) if xs else None

        # ── 3. Compute speed (2D displacement between adjacent samples) ────────
        for i in range(1, n):
            sy, sx = samples[i]["smooth_y"], samples[i]["smooth_x"]
            py, px = samples[i - 1]["smooth_y"], samples[i - 1]["smooth_x"]
            if sy is not None and py is not None:
                dy = sy - py
                dx = (sx or 0.5) - (px or 0.5)
                samples[i]["speed"] = (dy * dy + dx * dx) ** 0.5

    # ── 4a. Setup ─────────────────────────────────────────────────────────────
    si = 0
    if use_motion:
        for s in samples[: max(1, int(n * 0.15))]:
            if s["smooth_y"] is not None:
                si = s["i"]
                break

    setup_y = samples[si]["smooth_y"] or samples[si]["wy"] or 0.70
    setup_x = samples[si]["smooth_x"] or samples[si]["wx"] or 0.50

    if use_motion:
        # Compute 2D distance from contact zone for every sample
        for s in samples:
            sy = s["smooth_y"]
            sx = s["smooth_x"]
            if sy is not None:
                dy = sy - setup_y
                dx = (sx or setup_x) - setup_x
                s["dist"] = (dy * dy + dx * dx) ** 0.5

        # ── 4b. Top: max distance from contact zone before 65% ────────────────
        ti = min(si + 1, n - 1)
        max_dist = -1.0
        for s in samples[si + 1 : max(si + 2, int(n * 0.65))]:
            if s["dist"] is not None and s["dist"] > max_dist:
                max_dist = s["dist"]
                ti = s["i"]

        # ── 4c. Impact: min distance from contact zone after top ─────────────
        # Additionally bias early using peak wrist speed
        impact_win = samples[ti + 1 : max(ti + 2, int(n * 0.88))]

        # Find peak speed in the window
        peak_sp_i = ti + 1
        peak_sp = -1.0
        for s in impact_win:
            if s["speed"] is not None and s["speed"] > peak_sp:
                peak_sp, peak_sp_i = s["speed"], s["i"]

        # Find frame closest to contact zone (min dist) in window
        contact_i = ti + 1
        min_dist2 = float("inf")
        for s in impact_win:
            if s["dist"] is not None and s["dist"] < min_dist2:
                min_dist2 = s["dist"]
                contact_i = s["i"]
                if min_dist2 < 0.06:   # very close to contact zone — bias early
                    break

        # Impact = frame closest to contact zone (minimum 2D distance from setup)
        # Peak speed used only to reject frames that are clearly too early
        ii = contact_i
        # If contact zone frame is surprisingly late (>80%), try peak speed instead
        if ii >= int(n * 0.80) and peak_sp_i < ii:
            ii = peak_sp_i

        imp_y = samples[ii]["smooth_y"] or setup_y

        # ── 4d. Follow-through: start 4 frames after impact ──────────────────
        min_ft_gap = 4
        fi2 = min(ii + min_ft_gap, n - 1)
        for s in samples[ii + min_ft_gap : n]:
            # Wrists rising (y decreasing) = body released through the ball
            if s["smooth_y"] is not None and s["smooth_y"] < imp_y - 0.05:
                fi2 = s["i"]
                if fi2 < n - 2:   # avoid last frame
                    break

        idxs = [si, ti, ii, fi2]
        method = "motion"

    else:
        # ── Fallback: pick best frame within percentage windows ────────────────
        windows = [(0.05, 0.15), (0.25, 0.45), (0.50, 0.70), (0.70, 0.85)]
        idxs = []
        for lo, hi in windows:
            lo_i = max(0, int(n * lo))
            hi_i = min(n - 1, int(n * hi))
            # Pick the frame in the window with a valid landmark, else midpoint
            cand = next(
                (s["i"] for s in samples[lo_i: hi_i + 1] if s["wy"] is not None),
                (lo_i + hi_i) // 2,
            )
            idxs.append(cand)
        method = "fallback"

    # ── 5. Enforce strict ordering + minimum spacing ──────────────────────────
    for k in range(1, 4):
        if idxs[k] <= idxs[k - 1]:
            idxs[k] = idxs[k - 1] + 1
    # Minimum 2-sample gap between top↔impact and impact↔follow-through
    if idxs[2] - idxs[1] < 2:
        idxs[2] = idxs[1] + 2
    if idxs[3] - idxs[2] < 2:
        idxs[3] = idxs[2] + 2
    idxs = [min(x, n - 1) for x in idxs]

    chosen = [samples[x] for x in idxs]
    labels = ["setup", "top", "impact", "ft"]
    debug = "  ".join(f"{labels[k]}={chosen[k]['time_ms']}ms(#{idxs[k]})"
                      for k in range(4))
    print(f"[phases] {method} N={n} lm={lm_count}  {debug}")

    return [{"frame": s["frame_b64"], "overlay_frame": None,
              "landmarks": s["landmarks"], "time_ms": s["time_ms"]}
            for s in chosen]


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
    """Try pose detection at multiple scales — returns (landmarks_json, overlay_b64) or (None, None)."""
    h, w = frame.shape[:2]

    # Attempt 1: original frame
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    det = pose.process(rgb)
    if det.pose_landmarks:
        overlay = frame.copy()
        mp_drawing.draw_landmarks(overlay, det.pose_landmarks, mp_pose.POSE_CONNECTIONS,
                                  landmark_drawing_spec=LANDMARK_STYLE,
                                  connection_drawing_spec=CONNECTION_STYLE)
        return landmarks_to_json(det.pose_landmarks), encode_jpg(overlay)

    # Attempt 2: upscale small frames — MediaPipe needs at least 256px on short side
    if min(h, w) < 480:
        scale = 480 / min(h, w)
        resized = cv2.resize(frame, (int(w * scale), int(h * scale)))
        rgb2 = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        det2 = pose.process(rgb2)
        if det2.pose_landmarks:
            overlay = resized.copy()
            mp_drawing.draw_landmarks(overlay, det2.pose_landmarks, mp_pose.POSE_CONNECTIONS,
                                      landmark_drawing_spec=LANDMARK_STYLE,
                                      connection_drawing_spec=CONNECTION_STYLE)
            # Scale back landmark coords (they're already normalized 0-1, no change needed)
            return landmarks_to_json(det2.pose_landmarks), encode_jpg(overlay)

    # Attempt 3: slightly expand contrast to help detection in outdoor light
    enhanced = cv2.convertScaleAbs(frame, alpha=1.2, beta=10)
    rgb3 = cv2.cvtColor(enhanced, cv2.COLOR_BGR2RGB)
    det3 = pose.process(rgb3)
    if det3.pose_landmarks:
        overlay = frame.copy()
        mp_drawing.draw_landmarks(overlay, det3.pose_landmarks, mp_pose.POSE_CONNECTIONS,
                                  landmark_drawing_spec=LANDMARK_STYLE,
                                  connection_drawing_spec=CONNECTION_STYLE)
        return landmarks_to_json(det3.pose_landmarks), encode_jpg(overlay)

    print(f"[pose] detection failed on all 3 attempts (frame size: {w}x{h})")
    return None, None


def extract_frames_with_pose(cap, ts_list: List[int], fps: float):
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

            frame_b64 = encode_jpg(frame)
            landmarks, overlay_b64 = try_detect_pose(pose, frame)
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
        results = detect_and_extract(cap, fps)

        cap.release()
        if cleanup and os.path.exists(cleanup):
            os.remove(cleanup)
        return {"frames": results}

    except Exception as e:
        print(f"[extract-key-frames] error: {e}")
        return {"frames": []}
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


@app.post("/extract-key-frames-upload")
async def extract_key_frames_upload(video: UploadFile = File(...)):
    tmp_path = None
    cleanup = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            tmp.write(await video.read())
            tmp_path = tmp.name

        cap, _, cleanup = open_video(tmp_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        results = detect_and_extract(cap, fps)

        cap.release()
        return {"frames": results}

    except Exception as e:
        print(f"[extract-key-frames-upload] error: {e}")
        return {"frames": []}
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
        indices = [int(i * total_frames / count) for i in range(count)]
        frames_b64 = []

        for idx in indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ret, frame = cap.read()
            if not ret:
                continue
            small = resize_for_ai(frame, max_side=640)
            _, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 70])
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
                    mp_drawing.draw_landmarks(
                        frame,
                        results.pose_landmarks,
                        mp_pose.POSE_CONNECTIONS,
                        landmark_drawing_spec=LANDMARK_STYLE,
                        connection_drawing_spec=CONNECTION_STYLE,
                    )

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
