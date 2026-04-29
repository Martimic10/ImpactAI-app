// Frame extraction utilities — V1 sends video URI to backend for FFmpeg processing.
// Backend extracts 5-8 frames and returns them as base64 strings.

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';

export async function extractFramesFromVideo(videoUri: string): Promise<string[]> {
  if (!BACKEND_URL) {
    // Return mock frames for development when no backend is configured
    return getMockFrames();
  }

  const formData = new FormData();
  formData.append('video', {
    uri: videoUri,
    name: 'swing.mp4',
    type: 'video/mp4',
  } as unknown as Blob);
  formData.append('frameCount', '6');

  const response = await fetch(`${BACKEND_URL}/extract-frames`, {
    method: 'POST',
    body: formData,
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  if (!response.ok) {
    throw new Error(`Frame extraction failed: ${response.status}`);
  }

  const data = await response.json();
  return data.frames as string[];
}

// Mock frames for development / demo mode
function getMockFrames(): string[] {
  // Return empty strings as placeholders — AI will generate a mock response
  return Array(6).fill('');
}

export const MOCK_SWING_RESULT = {
  selectedClub: 'Driver',
  detectedClubType: 'Driver',
  clubMatch: 'match' as const,
  clubMatchReason: 'Club appears long with a large head consistent with a driver.',
  cameraAngle: 'down-the-line' as const,
  scores: {
    overallScore: 58,
    setupScore: 72,
    postureScore: 65,
    swingPathScore: 42,
    tempoScore: 70,
    balanceScore: 63,
    contactScore: 51,
    confidence: 8,
  },
  evidence: [
    'From the down-the-line view, the club appears to approach steeply from outside the ball line.',
    'The transition appears to start with the shoulders before the lower body has cleared.',
    'Finish position shows the weight is not fully on the lead side.',
  ],
  scoreReasoning: {
    setup: 'Stance width looks appropriate for driver. Ball position appears slightly too far back which can promote a steeper attack angle.',
    posture: 'Good spine angle at address but some early extension visible approaching impact, reducing the ability to deliver the club on plane.',
    swingPath: 'Clear outside-in path visible from the downswing frames. Club approaches significantly from above and outside the target line.',
    tempo: 'Backswing pace is reasonable but the transition is abrupt — the downswing starts before the backswing is complete.',
    balance: 'Some lateral sway in the backswing. Finish position shows weight forward but not fully on the lead side.',
    contact: 'Steep angle of attack with an outside-in path strongly suggests heel-biased contact and a pull-fade or slice ball flight.',
  },
  primaryIssue: 'Over the top swing path',
  issueCategory: 'path',
  whyItHappens: 'Your downswing starts with the shoulders before the hips clear, causing the club to attack from outside the target line. This creates a steep, left-to-right swing path that imparts clockwise spin on the ball.',
  ballFlightPrediction: 'Pull-fade with significant distance loss. Ball starts left and curves further left.',
  contactPrediction: 'Likely heel-biased or thin strike due to steep angle of attack.',
  clubSpecificNotes: 'With a driver you need a shallow, sweeping attack angle. An over-the-top path is especially punishing off the tee because there is no turf to compress — all energy goes into spin rather than distance.',
  fixes: [
    'Start the downswing by bumping your lead hip toward the target before your shoulders turn',
    'Feel your trail elbow drop close to your hip pocket during the transition',
    'Keep your head behind the ball through impact to encourage an inside-out delivery',
  ],
  drill: {
    name: 'Headcover Under Trail Arm',
    whyThisDrill: 'Forces your trail elbow to stay connected, preventing the over-the-top move that starts at the shoulders.',
    steps: [
      'Place a headcover or towel under your trail armpit at address',
      'Make full practice swings keeping light pressure on the headcover through the transition',
      'If the headcover drops early, your shoulder is initiating the downswing — reset and repeat',
    ],
  },
  keyCheckpoints: [
    'Lead hip moves toward target before shoulders begin to unwind',
    'Trail elbow is in front of the hip at the halfway-down position',
    'Head stays behind the ball at the moment of impact',
  ],
  summary: 'Your main issue is an over-the-top swing path driven by early shoulder rotation. This is robbing you of distance and producing left-to-right spin. Fix the sequencing — hips first, shoulders follow — and you will immediately see a more penetrating ball flight with the driver.',
};
