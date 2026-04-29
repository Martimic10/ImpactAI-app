import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle, Line, Rect } from 'react-native-svg';
import { PoseLandmark } from '@/types';

// MediaPipe Pose landmark indices (33 total)
const LM_NOSE           = 0;
const LM_LEFT_SHOULDER  = 11;
const LM_RIGHT_SHOULDER = 12;
const LM_LEFT_HIP       = 23;
const LM_RIGHT_HIP      = 24;

interface Props {
  landmarks: PoseLandmark[];
  width: number;
  height: number;
}

function toXY(lm: PoseLandmark, w: number, h: number) {
  return { x: lm.x * w, y: lm.y * h };
}

function mid(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Returns true if landmark has enough visibility to trust
function visible(lm: PoseLandmark | undefined) {
  if (!lm) return false;
  return (lm.visibility ?? 1) > 0.3;
}

export function SwingOverlay({ landmarks, width, height }: Props) {
  if (!landmarks || landmarks.length < 25) return null;

  const ls   = landmarks[LM_LEFT_SHOULDER];
  const rs   = landmarks[LM_RIGHT_SHOULDER];
  const lh   = landmarks[LM_LEFT_HIP];
  const rh   = landmarks[LM_RIGHT_HIP];
  const nose = landmarks[LM_NOSE];

  const hasShoulders = visible(ls) && visible(rs);
  const hasHips      = visible(lh) && visible(rh);
  const hasNose      = visible(nose);
  const hasSpine     = hasShoulders && hasHips;

  if (!hasShoulders && !hasHips) return null;

  const lsXY = hasShoulders ? toXY(ls, width, height) : null;
  const rsXY = hasShoulders ? toXY(rs, width, height) : null;
  const lhXY = hasHips      ? toXY(lh, width, height) : null;
  const rhXY = hasHips      ? toXY(rh, width, height) : null;
  const noseXY = hasNose    ? toXY(nose, width, height) : null;

  const shoulderMid = hasShoulders ? mid(lsXY!, rsXY!) : null;
  const hipMid      = hasHips      ? mid(lhXY!, rhXY!) : null;

  const headSize = Math.max(14, width * 0.04);

  return (
    <View style={[StyleSheet.absoluteFill, { width, height }]} pointerEvents="none">
      <Svg width={width} height={height}>

        {/* ── Shoulder line ── */}
        {hasShoulders && (
          <Line
            x1={lsXY!.x} y1={lsXY!.y}
            x2={rsXY!.x} y2={rsXY!.y}
            stroke="#4CAF50"
            strokeWidth={2.5}
            strokeOpacity={0.9}
          />
        )}

        {/* ── Hip line ── */}
        {hasHips && (
          <Line
            x1={lhXY!.x} y1={lhXY!.y}
            x2={rhXY!.x} y2={rhXY!.y}
            stroke="#2196F3"
            strokeWidth={2.5}
            strokeOpacity={0.9}
          />
        )}

        {/* ── Spine line (shoulder mid → hip mid, dashed) ── */}
        {hasSpine && (
          <Line
            x1={shoulderMid!.x} y1={shoulderMid!.y}
            x2={hipMid!.x}      y2={hipMid!.y}
            stroke="#FF9F0A"
            strokeWidth={2}
            strokeOpacity={0.85}
            strokeDasharray="6,4"
          />
        )}

        {/* ── Left shoulder circle ── */}
        {hasShoulders && (
          <Circle
            cx={lsXY!.x} cy={lsXY!.y} r={7}
            fill="rgba(76,175,80,0.25)"
            stroke="#4CAF50"
            strokeWidth={2}
          />
        )}

        {/* ── Right shoulder circle ── */}
        {hasShoulders && (
          <Circle
            cx={rsXY!.x} cy={rsXY!.y} r={7}
            fill="rgba(76,175,80,0.25)"
            stroke="#4CAF50"
            strokeWidth={2}
          />
        )}

        {/* ── Hip circles ── */}
        {hasHips && (
          <>
            <Circle
              cx={lhXY!.x} cy={lhXY!.y} r={6}
              fill="rgba(33,150,243,0.25)"
              stroke="#2196F3"
              strokeWidth={2}
            />
            <Circle
              cx={rhXY!.x} cy={rhXY!.y} r={6}
              fill="rgba(33,150,243,0.25)"
              stroke="#2196F3"
              strokeWidth={2}
            />
          </>
        )}

        {/* ── Head box (around nose landmark) ── */}
        {hasNose && (
          <Rect
            x={noseXY!.x - headSize}
            y={noseXY!.y - headSize * 1.6}
            width={headSize * 2}
            height={headSize * 2.2}
            fill="transparent"
            stroke="#B6FF2F"
            strokeWidth={1.5}
            strokeOpacity={0.75}
            rx={4}
          />
        )}

      </Svg>
    </View>
  );
}
