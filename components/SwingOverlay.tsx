import React from 'react';
import { View, StyleSheet } from 'react-native';
import { PoseLandmark } from '@/types';

// MediaPipe Pose landmark indices (33 total)
const LM_NOSE           = 0;
const LM_LEFT_SHOULDER  = 11;
const LM_RIGHT_SHOULDER = 12;
const LM_LEFT_HIP       = 23;
const LM_RIGHT_HIP      = 24;

const POSE_CONNECTIONS: [number, number][] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [27, 31],
  [28, 32],
];

interface Props {
  landmarks: PoseLandmark[];
  width: number;
  height: number;
}

function toXY(lm: PoseLandmark, w: number, h: number) {
  return {
    x: Math.max(0, Math.min(1, lm.x)) * w,
    y: Math.max(0, Math.min(1, lm.y)) * h,
  };
}

function mid(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function Segment({
  from,
  to,
  color,
  thickness,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  color: string;
  thickness: number;
}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = `${Math.atan2(dy, dx)}rad`;
  const centerX = (from.x + to.x) / 2;
  const centerY = (from.y + to.y) / 2;

  return (
    <View
      style={[
        styles.segment,
        {
          left: centerX - length / 2,
          top: centerY - thickness / 2,
          width: length,
          height: thickness,
          backgroundColor: color,
          transform: [{ rotate: angle }],
        },
      ]}
    />
  );
}

function Dot({ point, size, color }: { point: { x: number; y: number }; size: number; color: string }) {
  return (
    <View
      style={[
        styles.dot,
        {
          left: point.x - size / 2,
          top: point.y - size / 2,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
      ]}
    />
  );
}

// Returns true if landmark has enough visibility to trust
function usable(lm: PoseLandmark | undefined) {
  if (!lm) return false;
  return Number.isFinite(lm.x) && Number.isFinite(lm.y);
}

export function SwingOverlay({ landmarks, width, height }: Props) {
  if (!landmarks || landmarks.length < 25) return null;

  const ls   = landmarks[LM_LEFT_SHOULDER];
  const rs   = landmarks[LM_RIGHT_SHOULDER];
  const lh   = landmarks[LM_LEFT_HIP];
  const rh   = landmarks[LM_RIGHT_HIP];
  const nose = landmarks[LM_NOSE];

  const hasShoulders = usable(ls) && usable(rs);
  const hasHips      = usable(lh) && usable(rh);
  const hasNose      = usable(nose);
  const hasSpine     = hasShoulders && hasHips;

  const usableCount = landmarks.filter(usable).length;
  if (usableCount < 2) return null;

  const lsXY = hasShoulders ? toXY(ls, width, height) : null;
  const rsXY = hasShoulders ? toXY(rs, width, height) : null;
  const lhXY = hasHips      ? toXY(lh, width, height) : null;
  const rhXY = hasHips      ? toXY(rh, width, height) : null;
  const noseXY = hasNose    ? toXY(nose, width, height) : null;

  const shoulderMid = hasShoulders ? mid(lsXY!, rsXY!) : null;
  const hipMid      = hasHips      ? mid(lhXY!, rhXY!) : null;

  const headSize = Math.max(14, width * 0.04);

  return (
    <View style={[StyleSheet.absoluteFillObject, { width, height }]} pointerEvents="none">
        {POSE_CONNECTIONS.map(([start, end]) => {
          const startLm = landmarks[start];
          const endLm = landmarks[end];
          if (!usable(startLm) || !usable(endLm)) return null;
          const startXY = toXY(startLm, width, height);
          const endXY = toXY(endLm, width, height);
          return <Segment key={`${start}-${end}`} from={startXY} to={endXY} color="#FFFFFF" thickness={4} />;
        })}

        {landmarks.map((lm, index) => {
          if (!usable(lm)) return null;
          const xy = toXY(lm, width, height);
          return <Dot key={`lm-${index}`} point={xy} size={7} color="#4CAF50" />;
        })}

        {/* ── Shoulder line ── */}
        {hasShoulders && (
          <Segment from={lsXY!} to={rsXY!} color="#4CAF50" thickness={3} />
        )}

        {/* ── Hip line ── */}
        {hasHips && (
          <Segment from={lhXY!} to={rhXY!} color="#4CAF50" thickness={3} />
        )}

        {/* ── Spine line (shoulder mid → hip mid, dashed) ── */}
        {hasSpine && (
          <Segment from={shoulderMid!} to={hipMid!} color="#FFFFFF" thickness={3} />
        )}

        {/* ── Left shoulder circle ── */}
        {hasShoulders && (
          <Dot point={lsXY!} size={13} color="#4CAF50" />
        )}

        {/* ── Right shoulder circle ── */}
        {hasShoulders && (
          <Dot point={rsXY!} size={13} color="#4CAF50" />
        )}

        {/* ── Hip circles ── */}
        {hasHips && (
          <>
            <Dot point={lhXY!} size={12} color="#4CAF50" />
            <Dot point={rhXY!} size={12} color="#4CAF50" />
          </>
        )}

        {/* ── Head box (around nose landmark) ── */}
        {hasNose && (
          <View
            style={[
              styles.headBox,
              {
                left: noseXY!.x - headSize,
                top: noseXY!.y - headSize * 1.6,
                width: headSize * 2,
                height: headSize * 2.2,
              },
            ]}
          />
        )}
    </View>
  );
}

const styles = StyleSheet.create({
  segment: {
    position: 'absolute',
    borderRadius: 999,
    opacity: 0.95,
  },
  dot: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  headBox: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    borderRadius: 4,
  },
});
