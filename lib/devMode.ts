import { User, Swing } from '@/types';
import { MOCK_SWING_RESULT } from '@/lib/frames';

export const DEV_MODE =
  !process.env.EXPO_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL === 'your_supabase_project_url';

export const MOCK_USER: User = {
  id: 'dev-user-001',
  email: 'tiger@impactai.app',
  username: 'TigerW',
  plan: 'pro',
  role: 'user',
};

const now = new Date();
function daysAgo(n: number) {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

export const MOCK_SWINGS: Swing[] = [
  {
    id: 'swing-001',
    user_id: MOCK_USER.id,
    video_url: '',
    status: 'completed',
    result_json: MOCK_SWING_RESULT,
    privacy: 'private',
    created_at: daysAgo(0),
  },
  {
    id: 'swing-002',
    user_id: MOCK_USER.id,
    video_url: '',
    status: 'completed',
    result_json: {
      selectedClub: '7 Iron',
      detectedClubType: 'Mid iron',
      clubMatch: 'match' as const,
      clubMatchReason: 'Club length and head size consistent with a mid iron.',
      cameraAngle: 'face-on' as const,
      scores: { overallScore: 63, positionScore: 74, tempoScore: 71, sequenceScore: 66, stabilityScore: 44, contactScore: 55, confidence: 6 },
      evidence: [
        'Hips appear to thrust toward the ball rather than rotate, causing the upper body to rise.',
        'From the face-on view, posture angle is lost before impact.',
        'Finish position shows weight remaining on the trail side rather than transferring forward.',
      ],
      scoreReasoning: { setup: 'Address position looks solid for a 7 iron — feet width and posture at address are good.', posture: 'Significant early extension visible. Hips thrust toward the ball causing the upper body to rise through impact.', swingPath: 'Path is relatively neutral — the main issue is the angle of attack caused by posture loss, not the horizontal path direction.', tempo: 'Backswing tempo is smooth. Transition is slightly rushed which contributes to the posture issue.', balance: 'Weight does not fully transfer to the lead side. Visible hanging back at finish.', contact: 'Early extension raises the arc which produces thin and topped contact. Ball likely launches low with insufficient spin.' },
      primaryIssue: 'Early extension at impact',
      issueCategory: 'posture',
      whyItHappens: 'Your hips thrust toward the ball during the downswing rather than rotating. This forces you to stand up through impact, disrupting your swing plane and making solid contact difficult.',
      ballFlightPrediction: 'Thin shots with inconsistent distance. Occasional fat contact on mishits.',
      contactPrediction: 'Likely thin or top of face contact.',
      clubSpecificNotes: 'With a 7 iron, early extension often causes you to bottom out behind the ball or blade it. You need your hips to rotate through, not slide, to achieve the ball-first contact this club demands.',
      fixes: [
        'Feel your hips rotate — not slide — toward the target on the downswing',
        'Keep your trail heel down longer to prevent the early thrust',
        'Hold your posture angle from address all the way through impact',
      ],
      drill: {
        name: 'Wall Drill',
        whyThisDrill: 'Teaches you to rotate your hips rather than thrust them, eliminating the early extension pattern.',
        steps: [
          'Stand with your back against a wall, about a fist-width gap between your glutes and the wall',
          'Take your address position and make slow-motion downswings',
          'Feel your glutes maintain contact with the wall through the impact zone — do not let your hips push forward',
        ],
      },
      keyCheckpoints: [
        'Maintain your spine angle from address through impact',
        'Hips rotate open — do not slide toward the target',
        'Weight transfers to the lead foot while posture stays intact',
      ],
      summary: 'Early extension is costing you consistent contact with the 7 iron. Your hips are pushing toward the ball instead of rotating, which forces your upper body to compensate and raises the bottom of your arc. Focus on rotation over thrust and your strike quality will improve immediately.',
    },
    privacy: 'friends',
    created_at: daysAgo(3),
  },
  {
    id: 'swing-003',
    user_id: MOCK_USER.id,
    video_url: '',
    status: 'completed',
    result_json: {
      selectedClub: '56°',
      detectedClubType: 'Wedge',
      clubMatch: 'match' as const,
      clubMatchReason: 'Short, lofted club visible — consistent with a wedge.',
      cameraAngle: 'down-the-line' as const,
      scores: { overallScore: 71, positionScore: 80, tempoScore: 82, sequenceScore: 73, stabilityScore: 76, contactScore: 48, confidence: 7 },
      evidence: [
        'Hands appear to release past the clubhead before impact, removing forward shaft lean.',
        'The trail wrist appears to flip through the impact zone rather than hold its angle.',
        'Divot pattern would likely appear behind the ball given the early release visible in these frames.',
      ],
      scoreReasoning: { setup: 'Good wedge setup — narrow stance, ball position center-to-back, handle slightly ahead of the ball.', posture: 'Posture is maintained well through the backswing and into the downswing.', swingPath: 'Swing plane is acceptable for a wedge. Path is slightly outside-in but within normal range for short irons.', tempo: 'Smooth and controlled backswing. Tempo is one of the stronger aspects of this swing.', balance: 'Good balance through the swing. Finish position is stable.', contact: 'Hands release early before impact, removing shaft lean. This scooping action bottoms out the arc before the ball, producing thin and inconsistent contact.' },
      primaryIssue: 'Early release / casting',
      issueCategory: 'contact',
      whyItHappens: "Your wrists are releasing the club before impact, causing the clubhead to overtake your hands. This removes shaft lean at impact and turns a descending strike into a scooping motion.",
      ballFlightPrediction: 'High, soft shots with reduced spin. Inconsistent distance control.',
      contactPrediction: 'Likely thin or bladed contact. Occasional chunk when the arc bottoms out too early.',
      clubSpecificNotes: 'Wedge shots require forward shaft lean and a descending strike to generate proper spin and control. Casting eliminates both. The 56° in particular is sensitive to this — you need hands-ahead contact to compress the ball correctly.',
      fixes: [
        'Feel like your hands lead the clubhead through impact — grip end points at the lead hip at impact',
        'Maintain the angle between your lead arm and the club shaft until the last moment before contact',
        'Practice hitting shots where your trail wrist stays bent through impact rather than flipping',
      ],
      drill: {
        name: 'Lead Hand Only Drill',
        whyThisDrill: 'Hitting balls with only the lead hand forces forward shaft lean because the trail hand cannot flip or cast.',
        steps: [
          'Grip the club with your lead hand only and choke down for control',
          'Make half-swing wedge shots focusing on a firm, flat lead wrist at impact',
          'Add the trail hand back gradually, keeping the same forward lean sensation',
        ],
      },
      keyCheckpoints: [
        'Hands are ahead of the clubhead at the moment of contact',
        'Lead wrist is flat or slightly bowed — not cupped — at impact',
        'Divot appears in front of the ball, not behind it',
      ],
      summary: 'You are casting the club with your 56° wedge, which costs you spin, control, and consistency. The fix is learning to maintain shaft lean through impact so the club strikes down and through the ball. The lead hand drill will build the correct sensation quickly.',
    },
    privacy: 'private',
    created_at: daysAgo(7),
  },
];

export const MOCK_FRIENDS = [
  {
    id: 'friend-001',
    username: 'PhilM',
    email: 'phil@impactai.app',
    plan: 'pro' as const,
    streak: 5,
    last_active: daysAgo(1),
    total_swings: 12,
    improvement_score: 42,
  },
  {
    id: 'friend-002',
    username: 'RoryM',
    email: 'rory@impactai.app',
    plan: 'free' as const,
    streak: 12,
    last_active: daysAgo(0),
    total_swings: 28,
    improvement_score: 67,
  },
  {
    id: 'friend-003',
    username: 'JordanS',
    email: 'jordan@impactai.app',
    plan: 'pro' as const,
    streak: 3,
    last_active: daysAgo(2),
    total_swings: 8,
    improvement_score: 31,
  },
];
