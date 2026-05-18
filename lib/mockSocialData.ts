// Set to true to preview populated UI. Flip to false to use real Supabase data.
/** Set true only for offline UI previews without Supabase. */
export const MOCK_SOCIAL_DATA = false;

export interface MockFriend {
  id: string;
  username: string;
  displayName: string;
  avatarInitials: string;
  bestScore: number;
  currentStreak: number;
  lastClub: string;
  lastActive: string;
  status: string;
  totalSwings: number;
}

export interface MockLeaderboardEntry {
  id: string;
  username: string;
  displayName: string;
  avatarInitials: string;
  score: number;
  trend: string;
  streak: number;
  totalSwings: number;
}

export interface MockRequest {
  id: string;
  username: string;
  displayName: string;
  avatarInitials: string;
}

export const MOCK_FRIENDS_DATA: MockFriend[] = [
  {
    id: '1',
    username: 'mikegolf',
    displayName: 'Mike',
    avatarInitials: 'MG',
    bestScore: 87,
    currentStreak: 5,
    lastClub: '7 Iron',
    lastActive: '2h ago',
    status: 'New personal best',
    totalSwings: 18,
  },
  {
    id: '2',
    username: 'fairwaydan',
    displayName: 'Dan',
    avatarInitials: 'FD',
    bestScore: 82,
    currentStreak: 3,
    lastClub: 'Driver',
    lastActive: '5h ago',
    status: 'Practicing driver',
    totalSwings: 11,
  },
  {
    id: '3',
    username: 'swingcoach',
    displayName: 'Alex',
    avatarInitials: 'AC',
    bestScore: 91,
    currentStreak: 8,
    lastClub: 'P Wedge',
    lastActive: 'Yesterday',
    status: 'Swing path improving',
    totalSwings: 24,
  },
];

export const MOCK_LEADERBOARD_DATA: MockLeaderboardEntry[] = [
  { id: '3', username: 'swingcoach', displayName: 'Alex', avatarInitials: 'AC', score: 91, trend: '+4', streak: 8, totalSwings: 24 },
  { id: '1', username: 'mikegolf',   displayName: 'Mike', avatarInitials: 'MG', score: 87, trend: '+6', streak: 5, totalSwings: 18 },
  { id: '2', username: 'fairwaydan', displayName: 'Dan',  avatarInitials: 'FD', score: 82, trend: '+2', streak: 3, totalSwings: 11 },
];

export const MOCK_REQUESTS_DATA: MockRequest[] = [
  { id: '1', username: 'birdieben', displayName: 'Ben', avatarInitials: 'BB' },
];
