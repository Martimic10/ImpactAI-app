export interface ProSwing {
  id: string;
  label: string;
  club: string;
  cameraAngle: string;
  type: 'pro';
  videoUrl: string;
  thumbnailUrl: string;
  description: string;
}

export const PRO_SWINGS: ProSwing[] = [
  {
    id: 'pro_driver_dtl',
    label: 'Pro Driver Swing',
    club: 'Driver',
    cameraAngle: 'down-the-line',
    type: 'pro',
    videoUrl: '',
    thumbnailUrl: '',
    description: 'Tour-level driver — efficient rotation, shallow attack angle.',
  },
  {
    id: 'pro_iron_dtl',
    label: 'Pro Iron Swing',
    club: 'Iron',
    cameraAngle: 'down-the-line',
    type: 'pro',
    videoUrl: '',
    thumbnailUrl: '',
    description: 'Tour-level iron — compressed strike, forward shaft lean at impact.',
  },
  {
    id: 'pro_iron_face_on',
    label: 'Pro Face-On Swing',
    club: 'Iron',
    cameraAngle: 'face-on',
    type: 'pro',
    videoUrl: '',
    thumbnailUrl: '',
    description: 'Tour-level face-on — hip clearing, balanced finish, consistent posture.',
  },
];

// Rule-based "What's Different" bullets for pro comparisons
export function getProDifferences(primaryIssue: string, issueCategory: string): string[] {
  const defaults = [
    'The reference swing maintains spine angle consistently through impact.',
    'Hip rotation is more complete in the reference swing.',
    'The reference swing finishes in a fully balanced follow-through position.',
  ];

  const map: Record<string, string[]> = {
    path: [
      'The reference swing delivers the club on a more inside-out path.',
      'Shoulder rotation initiates after the lower body in the reference swing.',
      'The reference swing produces a penetrating ball flight without the pull-fade shape.',
    ],
    posture: [
      'The reference swing maintains spine angle from address through impact.',
      'There is no early extension in the reference swing — hips rotate rather than thrust.',
      'The reference swing finishes taller with full weight on the lead side.',
    ],
    contact: [
      'The reference swing delivers forward shaft lean at the point of contact.',
      'The divot pattern in the reference swing starts in front of the ball.',
      'Wrist angles are maintained longer in the reference swing before release.',
    ],
    tempo: [
      'The reference swing has a smoother transition from backswing to downswing.',
      'Lower body leads the downswing in the reference, allowing the club to shallow.',
      'The reference swing has consistent rhythm across all phases of the motion.',
    ],
    setup: [
      'The reference swing starts from a more athletic, balanced address position.',
      'Ball position and stance width are optimized in the reference swing.',
      'Grip and alignment are more neutral in the reference swing.',
    ],
    balance: [
      'The reference swing finishes with full weight transfer to the lead foot.',
      'There is no lateral sway in the reference swing — rotation is around a stable axis.',
      'The reference swing holds a balanced finish position.',
    ],
    rotation: [
      'Hip clearance is earlier and more complete in the reference swing.',
      'The reference swing creates more separation between upper and lower body.',
      'Shoulder turn is fuller in the reference swing at the top of the backswing.',
    ],
  };

  return map[issueCategory] ?? defaults;
}
