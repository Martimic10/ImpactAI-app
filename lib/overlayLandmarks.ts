import { PoseLandmark } from '@/types';

export type Handedness = 'right' | 'left';
export type Side = 'left' | 'right';

export const POSE_LANDMARKS = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

export const DEBUG_CONNECTIONS: [number, number][] = [
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
];

export function getLeadSide(handedness: Handedness = 'right'): Side {
  return handedness === 'left' ? 'right' : 'left';
}

export function sideLandmark(side: Side, part: 'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle') {
  const key = `${side}${part.charAt(0).toUpperCase()}${part.slice(1)}` as keyof typeof POSE_LANDMARKS;
  return POSE_LANDMARKS[key];
}

export function hasVisibility(lm: PoseLandmark | undefined, minVisibility = 0.45) {
  if (!lm) return false;
  if (!Number.isFinite(lm.x) || !Number.isFinite(lm.y)) return false;
  return lm.visibility == null || lm.visibility >= minVisibility;
}

export function toDisplayPoint(lm: PoseLandmark, width: number, height: number) {
  return {
    x: Math.max(0, Math.min(1, lm.x)) * width,
    y: Math.max(0, Math.min(1, lm.y)) * height,
  };
}

export function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

