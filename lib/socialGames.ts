export type SocialGameCategoryId = 'on_course' | 'team' | 'competitive' | 'skills';

export const SOCIAL_GAME_CATEGORY_LABELS: Record<SocialGameCategoryId, string> = {
  on_course: 'On course',
  team: 'Team play',
  competitive: 'Competitive',
  skills: 'Skills',
};

export type SocialGameDef = {
  id: string;
  title: string;
  description: string;
  /** Ionicons glyph name */
  icon: string;
  category: SocialGameCategoryId;
};

export function getSocialGameById(id: string): SocialGameDef | undefined {
  return SOCIAL_GAMES.find((g) => g.id === id);
}

export const SOCIAL_GAMES: SocialGameDef[] = [
  {
    id: 'closest_pin',
    title: 'Closest to Pin',
    description: 'Get closest to the pin on each hole. Lowest total distance wins.',
    icon: 'navigate-circle-outline',
    category: 'on_course',
  },
  {
    id: 'longest_drive',
    title: 'Longest Drive',
    description: 'Hit the longest drive on designated holes to earn points.',
    icon: 'flash-outline',
    category: 'skills',
  },
  {
    id: 'match_play',
    title: 'Match Play',
    description: 'Go head-to-head hole-by-hole against friends.',
    icon: 'trophy-outline',
    category: 'competitive',
  },
  {
    id: 'skins',
    title: 'Skins',
    description: 'Win a hole outright to earn the skin.',
    icon: 'layers-outline',
    category: 'competitive',
  },
  {
    id: 'scramble',
    title: 'Scramble',
    description: 'Team up and play the best ball on every shot.',
    icon: 'people-circle-outline',
    category: 'team',
  },
  {
    id: 'bullseye',
    title: 'Bullseye',
    description: 'Hit target zones to earn points.',
    icon: 'disc-outline',
    category: 'skills',
  },
  {
    id: 'par3',
    title: 'Par 3 Challenge',
    description: 'Compete only on par 3s.',
    icon: 'flag-outline',
    category: 'on_course',
  },
  {
    id: 'beat_clock',
    title: 'Beat the Clock',
    description: 'Complete challenges before time runs out.',
    icon: 'alarm-outline',
    category: 'skills',
  },
  {
    id: 'best_ball',
    title: 'Best Ball',
    description: 'Each player plays their own ball while the best score counts.',
    icon: 'analytics-outline',
    category: 'team',
  },
  {
    id: 'wolf',
    title: 'Wolf',
    description: 'Rotate team captains every hole and strategize.',
    icon: 'shuffle-outline',
    category: 'team',
  },
];

export type SocialGameFilterKey = 'all' | SocialGameCategoryId;

export const SOCIAL_GAME_FILTER_OPTIONS: {
  key: SocialGameFilterKey;
  label: string;
  /** Ionicons glyph name */
  icon: string;
}[] = [
  { key: 'all', label: 'All games', icon: 'apps-outline' },
  { key: 'on_course', label: SOCIAL_GAME_CATEGORY_LABELS.on_course, icon: 'flag-outline' },
  { key: 'team', label: SOCIAL_GAME_CATEGORY_LABELS.team, icon: 'people-outline' },
  { key: 'competitive', label: SOCIAL_GAME_CATEGORY_LABELS.competitive, icon: 'medal-outline' },
  { key: 'skills', label: SOCIAL_GAME_CATEGORY_LABELS.skills, icon: 'pulse-outline' },
];
