import React from 'react';
import { View } from 'react-native';
import { PoseLandmark } from '@/types';
import { OverlayMode } from '@/lib/overlayTheme';
import {
  Handedness,
  POSE_LANDMARKS,
  getLeadSide,
  hasVisibility,
  midpoint,
  sideLandmark,
  toDisplayPoint,
} from '@/lib/overlayLandmarks';

interface Props {
  landmarks: PoseLandmark[];
  width: number;
  height: number;
  handedness?: Handedness;
  mode?: OverlayMode;
  showHeadRing?: boolean;
  showGlow?: boolean;
}

type Point = { x: number; y: number };

function pointFor(
  landmarks: PoseLandmark[],
  idx: number,
  w: number,
  h: number,
  minVis = 0.45,
): Point | null {
  const lm = landmarks[idx];
  if (!hasVisibility(lm, minVis)) return null;
  return toDisplayPoint(lm, w, h);
}

function hasPoints(pts: Array<Point | null>): pts is Point[] {
  return pts.every(Boolean);
}

// ── Primitives ────────────────────────────────────────────────────────────────

function Seg({ a, b, color, w }: { a: Point; b: Point; color: string; w: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return null;
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  return (
    <View style={{
      position: 'absolute',
      left: (a.x + b.x) / 2 - len / 2,
      top:  (a.y + b.y) / 2 - w / 2,
      width: len,
      height: w,
      backgroundColor: color,
      borderRadius: w / 2,
      transform: [{ rotate: `${angle}deg` }],
    }} />
  );
}

function Chain({ pts, color, w }: { pts: Point[]; color: string; w: number }) {
  return (
    <>
      {pts.slice(0, -1).map((a, i) => (
        <Seg key={i} a={a} b={pts[i + 1]} color={color} w={w} />
      ))}
    </>
  );
}

// Joint dot — key joints slightly larger and green-tinted, secondary pure white
function Dot({ p, r, fill, border }: { p: Point; r: number; fill: string; border: string }) {
  return (
    <View style={{
      position: 'absolute',
      left: p.x - r,
      top:  p.y - r,
      width:  r * 2,
      height: r * 2,
      borderRadius: r,
      backgroundColor: fill,
      borderWidth: 1.5,
      borderColor: border,
    }} />
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function SwingOverlay({
  landmarks,
  width,
  height,
  handedness = 'right',
  mode = 'minimal',
  showHeadRing = false,
}: Props) {
  if (!landmarks || landmarks.length < 29 || width <= 0 || height <= 0) return null;

  const leftShoulder  = pointFor(landmarks, POSE_LANDMARKS.leftShoulder,  width, height);
  const rightShoulder = pointFor(landmarks, POSE_LANDMARKS.rightShoulder, width, height);
  const leftHip       = pointFor(landmarks, POSE_LANDMARKS.leftHip,       width, height);
  const rightHip      = pointFor(landmarks, POSE_LANDMARKS.rightHip,      width, height);
  const nose          = pointFor(landmarks, POSE_LANDMARKS.nose,           width, height, 0.35);

  const lead  = getLeadSide(handedness);
  const trail = lead === 'left' ? 'right' : 'left';

  const leadShoulder  = pointFor(landmarks, sideLandmark(lead,  'shoulder'), width, height);
  const leadElbow     = pointFor(landmarks, sideLandmark(lead,  'elbow'),    width, height);
  const leadWrist     = pointFor(landmarks, sideLandmark(lead,  'wrist'),    width, height);
  const leadHip       = pointFor(landmarks, sideLandmark(lead,  'hip'),      width, height);
  const leadKnee      = pointFor(landmarks, sideLandmark(lead,  'knee'),     width, height);
  const leadAnkle     = pointFor(landmarks, sideLandmark(lead,  'ankle'),    width, height);
  const trailHip      = pointFor(landmarks, sideLandmark(trail, 'hip'),      width, height);
  const trailKnee     = pointFor(landmarks, sideLandmark(trail, 'knee'),     width, height);
  const trailAnkle    = pointFor(landmarks, sideLandmark(trail, 'ankle'),    width, height);

  const shoulderLine = hasPoints([leftShoulder, rightShoulder]) ? [leftShoulder, rightShoulder] as Point[] : null;
  const hipLine      = hasPoints([leftHip, rightHip])           ? [leftHip, rightHip]           as Point[] : null;
  const spineLine    = shoulderLine && hipLine
    ? [midpoint(shoulderLine[0], shoulderLine[1]), midpoint(hipLine[0], hipLine[1])] as Point[]
    : null;
  const leadArm  = hasPoints([leadShoulder, leadElbow, leadWrist]) ? [leadShoulder, leadElbow, leadWrist] as Point[] : null;
  const leadLeg  = hasPoints([leadHip, leadKnee, leadAnkle])       ? [leadHip, leadKnee, leadAnkle]       as Point[] : null;
  const trailLeg = hasPoints([trailHip, trailKnee, trailAnkle])    ? [trailHip, trailKnee, trailAnkle]    as Point[] : null;

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, width, height }} pointerEvents="none">

      {/* ── Lines first (underneath dots) ── */}

      {/* Spine — subtle, slightly thinner */}
      {spineLine && (
        <Seg a={spineLine[0]} b={spineLine[1]} color="rgba(255,255,255,0.6)" w={1.5} />
      )}

      {/* Shoulder & hip bars — green tint to indicate rotation axes */}
      {shoulderLine && (
        <Seg a={shoulderLine[0]} b={shoulderLine[1]} color="rgba(76,175,80,0.85)" w={2} />
      )}
      {hipLine && (
        <Seg a={hipLine[0]} b={hipLine[1]} color="rgba(76,175,80,0.85)" w={2} />
      )}

      {/* Lead arm & leg — clean white */}
      {leadArm  && <Chain pts={leadArm}  color="rgba(255,255,255,0.85)" w={2} />}
      {leadLeg  && <Chain pts={leadLeg}  color="rgba(255,255,255,0.85)" w={2} />}
      {trailLeg && <Chain pts={trailLeg} color="rgba(255,255,255,0.70)" w={1.5} />}

      {/* Technical alignment guide */}
      {mode === 'technical' && spineLine && (
        <Seg
          a={{ x: spineLine[1].x, y: Math.max(0, spineLine[1].y - height * 0.10) }}
          b={{ x: spineLine[1].x, y: Math.min(height, spineLine[1].y + height * 0.22) }}
          color="rgba(255,255,255,0.22)"
          w={1}
        />
      )}

      {/* ── Dots on top of lines ── */}

      {/* Key rotation joints — slightly larger, green fill */}
      {leftShoulder  && <Dot p={leftShoulder}  r={5} fill="#4CAF50" border="#fff" />}
      {rightShoulder && <Dot p={rightShoulder} r={5} fill="#4CAF50" border="#fff" />}
      {leftHip       && <Dot p={leftHip}       r={5} fill="#4CAF50" border="#fff" />}
      {rightHip      && <Dot p={rightHip}      r={5} fill="#4CAF50" border="#fff" />}

      {/* Secondary chain joints — small white */}
      {leadElbow  && <Dot p={leadElbow}  r={3.5} fill="#fff" border="rgba(76,175,80,0.7)" />}
      {leadWrist  && <Dot p={leadWrist}  r={3}   fill="#fff" border="rgba(255,255,255,0.5)" />}
      {leadKnee   && <Dot p={leadKnee}   r={3.5} fill="#fff" border="rgba(76,175,80,0.7)" />}
      {leadAnkle  && <Dot p={leadAnkle}  r={3}   fill="#fff" border="rgba(255,255,255,0.5)" />}
      {trailKnee  && <Dot p={trailKnee}  r={3}   fill="rgba(255,255,255,0.7)" border="rgba(255,255,255,0.4)" />}
      {trailAnkle && <Dot p={trailAnkle} r={2.5} fill="rgba(255,255,255,0.6)" border="rgba(255,255,255,0.3)" />}

      {/* Head ring */}
      {showHeadRing && nose && shoulderLine && (() => {
        const [sl0, sl1] = shoulderLine;
        const span = Math.max(24, Math.abs(sl1.x - sl0.x));
        const size = Math.max(20, Math.min(50, span * 0.38));
        return (
          <View style={{
            position: 'absolute',
            left: nose.x - size / 2,
            top:  nose.y - size * 0.75,
            width: size, height: size,
            borderRadius: size / 2,
            borderWidth: 1.5,
            borderColor: 'rgba(255,255,255,0.55)',
          }} />
        );
      })()}
    </View>
  );
}
