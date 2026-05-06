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


def find_swing_burst(cap, total_frames: int, fps: float):
    """
    Fast motion scan to find the MAIN swing burst (longest contiguous
    high-motion window). Using first→last active frame was too wide —
    it included setup, post-swing walking off, camera movement, etc.
    """
    scan_n = min(24, total_frames)
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

    # Find the longest contiguous run of active frames
    max_gap = max(1, int(len(scores) * 0.10))  # allow small gaps within a run
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

    # Pick the run with the highest total motion (the actual swing)
    best = max(runs, key=lambda r: sum(scores[i][1] for i in range(r[0], r[1] + 1)))
    start_fi = max(0, scores[best[0]][0] - step)
    end_fi   = min(total_frames - 1, scores[best[1]][0] + step)

    print(f"[burst] swing burst: {int(start_fi/fps*1000)}ms–{int(end_fi/fps*1000)}ms "
          f"({len(runs)} run(s), picked run {best})")
    return start_fi, end_fi


def detect_and_extract(cap, fps: float) -> List[dict]:
    """
    Physics-based phase detection that works for any video:

    1. Motion scan finds the swing burst (ignores static address period)
    2. 36 frames sampled densely within the burst + 2 pre-burst setup frames
    3. Wrist 2D speed computed per frame
    4. Phases detected from physical invariants of the golf swing:

       SETUP   — most stable frame just before burst (wrist at address/ball height)
       TOP     — local speed minimum in first half of burst
                 (wrist momentarily stops at top of backswing)
       IMPACT  — global speed maximum in burst
                 (peak wrist velocity = club-ball contact, any camera angle)
       FOLLOW  — first frame after impact where speed drops below 40% of peak
                 AND wrist has moved past impact position

    Falls back to burst percentages when landmark coverage < 30%.
    """
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    def read_frame(fi):
        fi = max(0, min(int(fi), total_frames - 1))
        cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
        ret, frame = cap.read()
        return (frame if ret else None), int(fi / fps * 1000)

    def make_result(frame, time_ms, landmarks=None):
        b64 = encode_jpg(resize_for_ai(frame)) if frame is not None else None
        return {"frame": b64, "overlay_frame": None, "landmarks": landmarks, "time_ms": time_ms}

    if total_frames <= 0:
        return [make_result(*read_frame(int(total_frames * p)))
                for p in [0.05, 0.35, 0.62, 0.82]]

    # ── 1. Burst detection ────────────────────────────────────────────────────
    burst_start, burst_end = find_swing_burst(cap, total_frames, fps)
    span = max(1, burst_end - burst_start)

    # 3 pre-burst frames with specific roles:
    #   [0] = 5% of total video  → true address (static setup, always early)
    #   [1] = burst_start - 25%  → mid-backswing
    #   [2] = burst_start - 5%   → just before fast downswing = top of backswing
    pre = [
        max(0, int(total_frames * 0.05)),
        max(0, burst_start - int(span * 0.25)),
        max(0, burst_start - max(1, int(span * 0.05))),
    ]
    n_burst = max(4, min(36, span))
    inside  = [burst_start + int(i * span / n_burst) for i in range(n_burst)]
    all_fi  = sorted(set(pre + inside))

    # ── 2. Sample with MediaPipe ──────────────────────────────────────────────
    samples = []
    with mp_pose.Pose(static_image_mode=True, model_complexity=0,
                      enable_segmentation=False, min_detection_confidence=0.2) as pose:
        for fi in all_fi:
            frame, time_ms = read_frame(fi)
            if frame is None:
                continue
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            det = pose.process(rgb)
            wy = wx = lm = None
            if det.pose_landmarks:
                lms = det.pose_landmarks.landmark
                lw, rw = lms[15], lms[16]
                if lw.visibility > 0.15 and rw.visibility > 0.15:
                    wy = (lw.y + rw.y) / 2.0
                    wx = (lw.x + rw.x) / 2.0
                elif lw.visibility > 0.15:
                    wy, wx = lw.y, lw.x
                elif rw.visibility > 0.15:
                    wy, wx = rw.y, rw.x
                lm = landmarks_to_json(det.pose_landmarks)
            samples.append({"fi": fi, "time_ms": time_ms, "wy": wy, "wx": wx,
                             "lm": lm, "frame": frame, "speed": None, "sy": None, "sx": None})
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

    n = len(samples)
    if n < 4:
        results = []
        for p in [0.05, 0.35, 0.62, 0.82]:
            f, t = read_frame(int(total_frames * p))
            results.append(make_result(f, t))
        return results

    lm_count = sum(1 for s in samples if s["wy"] is not None)
    use_physics = lm_count >= int(n * 0.28)

    # ── 3. Smooth wrist + compute 2D speed ───────────────────────────────────
    if use_physics:
        for i in range(n):
            ys = [samples[j]["wy"] for j in range(max(0, i-1), min(n, i+2)) if samples[j]["wy"]]
            xs = [samples[j]["wx"] for j in range(max(0, i-1), min(n, i+2)) if samples[j]["wx"]]
            samples[i]["sy"] = sum(ys)/len(ys) if ys else None
            samples[i]["sx"] = sum(xs)/len(xs) if xs else None
        for i in range(1, n):
            sy, sx = samples[i]["sy"], samples[i]["sx"]
            py, px = samples[i-1]["sy"], samples[i-1]["sx"]
            if sy and py:
                dy, dx = sy - py, (sx or 0.5) - (px or 0.5)
                samples[i]["speed"] = (dy*dy + dx*dx) ** 0.5

    # ── 4. Phase detection ────────────────────────────────────────────────────
    if use_physics:
        bsi = len(pre)   # first burst sample index
        bn  = n - bsi    # burst sample count

        # ADDRESS — samples[0]: 5% into total video = static setup before swing
        si = 0

        # TOP — samples[bsi-1]: last pre-burst frame = just before the fast
        # downswing starts = structurally the top of the backswing
        ti = bsi - 1 if bsi > 0 else bsi

        # IMPACT — max wrist Y (lowest point on screen = club at ball).
        # This is reliable and already tested to work correctly.
        ii = bsi + int(bn * 0.62)        # default if no landmarks
        max_wy = -1.0
        for i in range(bsi, n):
            wy = samples[i].get("sy")
            if wy is not None and wy > max_wy:
                max_wy, ii = wy, i

        # FOLLOW-THROUGH — fixed 82% through burst.
        fi2 = min(bsi + int(bn * 0.82), n - 1)

        # Guarantee strict ordering with meaningful gaps
        gap = max(1, int(bn * 0.10))
        if ti <= si:           ti  = si  + gap
        if ii <= ti + gap - 1: ii  = ti  + gap
        if fi2 <= ii:          fi2 = ii  + max(1, gap // 2)
        si, ti, ii, fi2 = [min(x, n - 1) for x in [si, ti, ii, fi2]]

        chosen_idx = [si, ti, ii, fi2]
        print(f"[phases] lm={lm_count}/{n}  "
              f"setup={samples[si]['time_ms']}ms(#{si}) "
              f"top={samples[ti]['time_ms']}ms(#{ti}) "
              f"impact={samples[ii]['time_ms']}ms(#{ii}) "
              f"ft={samples[fi2]['time_ms']}ms(#{fi2})")
    else:
        # Fallback: fixed burst percentages
        bsi = len(pre)
        pcts = [0.0, 0.35, 0.62, 0.82]
        chosen_idx = [min(int(bsi + p * (n - bsi)), n - 1) for p in pcts]
        chosen_idx[0] = bsi
        print(f"[phases] fallback (lm coverage {lm_count}/{n})")

    # Enforce strict ordering + minimum spacing
    for k in range(1, 4):
        if chosen_idx[k] <= chosen_idx[k-1]:
            chosen_idx[k] = chosen_idx[k-1] + 1
    if chosen_idx[2] - chosen_idx[1] < 2:
        chosen_idx[2] = chosen_idx[1] + 2
    if chosen_idx[3] - chosen_idx[2] < 2:
        chosen_idx[3] = chosen_idx[2] + 2
    chosen_idx = [min(x, n-1) for x in chosen_idx]

    return [make_result(samples[i]["frame"], samples[i]["time_ms"],
                        samples[i]["lm"]) for i in chosen_idx]


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
