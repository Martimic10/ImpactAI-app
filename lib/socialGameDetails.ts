import type { SocialGameCategoryId } from '@/lib/socialGames';
import { SOCIAL_GAME_CATEGORY_LABELS, getSocialGameById } from '@/lib/socialGames';

export type SocialGameDetailStep = {
  title: string;
  description: string;
};

export type SocialGameDetailScoringRow = {
  label: string;
  value: string;
  accent?: boolean;
};

export type SocialGameDetailTip = {
  text: string;
  icon: string;
};

export type SocialGameDetailSetting = {
  label: string;
  value: string;
};

export type SocialGameFullDetail = {
  gameId: string;
  title: string;
  icon: string;
  category: SocialGameCategoryId;
  /** Catalog one-liner under tagline */
  subtitle: string;
  /** One-line hook under title */
  tagline: string;
  overview: string;
  objective: string;
  whoWins: string;
  steps: SocialGameDetailStep[];
  scoringHeadline: string;
  scoringRows: SocialGameDetailScoringRow[];
  scoringNote?: string;
  tips: SocialGameDetailTip[];
  settings: SocialGameDetailSetting[];
};

type SocialGameDetailBody = Omit<SocialGameFullDetail, 'gameId' | 'title' | 'icon' | 'category' | 'subtitle'>;

const DETAILS: Record<string, SocialGameDetailBody> = {
  closest_pin: {
    tagline: 'Precision wins the day.',
    overview:
      'Closest to the pin is a classic side game that rewards approach shots. Everyone plays their own ball; after each hole you compare who ended nearest the cup.',
    objective: 'Finish closest to the hole on as many holes as possible — by distance or by points, depending on your group’s format.',
    whoWins: 'The player with the lowest total distance to the pin across holes, or the most points if you use a point table.',
    steps: [
      { title: 'Tee off as usual', description: 'Play the hole under your normal game format (stroke, match, etc.).' },
      { title: 'Hit your approach', description: 'Everyone takes their normal shots into the green.' },
      { title: 'Mark distances', description: 'On the green, measure or agree each ball’s distance to the hole edge.' },
      { title: 'Award points', description: 'Give points for closest, second closest, or only count the single closest — your call before the round.' },
      { title: 'Repeat every hole', description: 'Reset on the next tee. Par 3s are especially fun for this game.' },
      { title: 'Settle up', description: 'Add distances or points after 9 or 18. Lowest total distance or highest points wins.' },
    ],
    scoringHeadline: 'Example point table',
    scoringRows: [
      { label: '1st closest', value: '2 pts', accent: true },
      { label: '2nd closest', value: '1 pt', accent: true },
      { label: 'Everyone else', value: '0 pts' },
    ],
    scoringNote: 'Groups often use straight cumulative yards instead — pick one system before teeing off.',
    tips: [
      { text: 'Play smart, not always aggressive — middle of the green beats short-sided pins.', icon: 'bulb-outline' },
      { text: 'Agree how you measure (laser, steps, eyeball) before the first hole.', icon: 'hand-left-outline' },
      { text: 'On risky pins, take the fat side of the green and let others go for hero shots.', icon: 'shield-checkmark-outline' },
      { text: 'Par 3s are high drama — manage nerves like a putt to win.', icon: 'pulse-outline' },
    ],
    settings: [
      { label: 'Holes', value: 'All par 3s · 9 · or 18' },
      { label: 'Format', value: 'Side game alongside your main format' },
      { label: 'Scoring', value: 'Points or total distance' },
      { label: 'Tees', value: 'Same tees for fairness' },
      { label: 'Ties', value: 'Split points or carry to next hole' },
    ],
  },
  longest_drive: {
    tagline: 'Let it fly on selected holes.',
    overview:
      'Longest drive highlights power and accuracy off the tee. You only measure on holes your group marks as “contest” holes — usually wide, open par 4s or 5s.',
    objective: 'Win individual holes by hitting the longest tee shot that stays in play (fairway or rough per your rules).',
    whoWins: 'The player with the most longest-drive holes, or the most cumulative points if you weight holes differently.',
    steps: [
      { title: 'Pick contest holes', description: 'Mark 3–6 holes before the round where longest drive counts.' },
      { title: 'Tee it high', description: 'Everyone hits driver (or agreed club) from the same tees.' },
      { title: 'Find all balls', description: 'Drives must be in bounds — define OB and lost ball before starting.' },
      { title: 'Measure fairly', description: 'Use GPS, on-course markers, or a laser from tee center to ball.' },
      { title: 'Award the hole', description: 'One winner per contest hole; ties can split or playoff from the fairway.' },
      { title: 'Track totals', description: 'Keep a simple tally — most wins after the round takes the prize.' },
    ],
    scoringHeadline: 'Simple points',
    scoringRows: [
      { label: 'Longest on a contest hole', value: '1 win', accent: true },
      { label: 'Tie for longest', value: 'Split or replay' },
      { label: 'Non-contest holes', value: 'No count' },
    ],
    tips: [
      { text: 'Tempo beats overswinging — smooth speed usually carries farther.', icon: 'flash-outline' },
      { text: 'Choose lines that use the full width of the fairway.', icon: 'navigate-outline' },
      { text: 'Skip longest-drive on tight holes to keep pace of play.', icon: 'time-outline' },
      { text: 'Celebrate big swings — this game is supposed to be fun.', icon: 'happy-outline' },
    ],
    settings: [
      { label: 'Holes', value: 'Designated par 4/5s' },
      { label: 'Format', value: 'Stroke or match + side pot' },
      { label: 'Scoring', value: 'Wins per hole or points' },
      { label: 'Tees', value: 'Same tee markers' },
      { label: 'Ties', value: 'Split pot or closest second shot' },
    ],
  },
  match_play: {
    tagline: 'You vs. them, hole by hole.',
    overview:
      'Match play compares scores per hole instead of total strokes. Win more holes than your opponent and you win the match — comebacks stay possible until the very end.',
    objective: 'Win individual holes with the better score (gross or net if handicaps are used).',
    whoWins: 'First player “up” by more holes than remain wins (e.g. 3 up with 2 to play). If tied after 18, halve the match or go extra holes.',
    steps: [
      { title: 'Set stakes', description: 'Decide gross vs. net, concessions, and max score if you use caps.' },
      { title: 'Play the hole', description: 'Both players complete the hole under the rules of golf.' },
      { title: 'Compare scores', description: 'Lower score wins the hole; same score halves the hole.' },
      { title: 'Update the match', description: 'Track status: all square, 1 up, 2 down, etc.' },
      { title: 'Close it out', description: 'When lead exceeds holes left, the match ends early (dormie then win).' },
      { title: 'Optional extras', description: 'Presses and auto-press can add side games — agree first.' },
    ],
    scoringHeadline: 'Hole outcomes',
    scoringRows: [
      { label: 'Lower score on hole', value: 'Win hole', accent: true },
      { label: 'Same score', value: 'Halve' },
      { label: 'Match result', value: 'Holes won vs. holes left' },
    ],
    tips: [
      { text: 'Play the player, not just the course — strategy shifts when you’re ahead or behind.', icon: 'people-outline' },
      { text: 'Short game matters more when every hole is a new battle.', icon: 'golf-outline' },
      { text: 'Don’t give putts too freely on tight matches.', icon: 'eye-outline' },
      { text: 'Stay positive — one big hole can flip momentum.', icon: 'trending-up-outline' },
    ],
    settings: [
      { label: 'Holes', value: '18 or agreed subset' },
      { label: 'Format', value: 'Head-to-head match play' },
      { label: 'Scoring', value: 'Gross or net per hole' },
      { label: 'Tees', value: 'Same or blended per handicap policy' },
      { label: 'Ties', value: 'Halved match or playoff holes' },
    ],
  },
  skins: {
    tagline: 'Win the hole, win the skin.',
    overview:
      'Skins assign a prize to each hole. Carry overs make birdie holes explosive — if no one wins outright, the skin rolls to the next tee.',
    objective: 'Win holes outright (lowest net/gross among the group) to collect skins — including carried pots.',
    whoWins: 'Players with the most skins (and money/points per skin if you’re playing for stakes).',
    steps: [
      { title: 'Set skin value', description: 'Agree points or dollars per skin and whether handicaps apply.' },
      { title: 'Play the hole', description: 'Everyone completes the hole.' },
      { title: 'Check for outright low', description: 'One winner only — ties mean a carry to the next hole.' },
      { title: 'Carry builds drama', description: 'Multiple carries stack until someone scoops the lot.' },
      { title: 'Birdie bonus (optional)', description: 'Some groups double the carry if the winner birdies.' },
      { title: 'Settle', description: 'Count skins at the turn and after 18.' },
    ],
    scoringHeadline: 'Skin outcomes',
    scoringRows: [
      { label: 'Solo low score', value: 'Win skin (+ carries)', accent: true },
      { label: 'Two or more tied low', value: 'Carry forward' },
      { label: 'Optional birdie bump', value: '2× value next hole' },
    ],
    tips: [
      { text: 'Late carries are worth big swings — stay patient.', icon: 'hourglass-outline' },
      { text: 'Communicate concessions on short putts to keep pace.', icon: 'chatbubble-outline' },
      { text: 'Protect pars when others are in trouble — pars win carries often.', icon: 'shield-outline' },
      { text: 'Keep the pot visible so everyone feels the stakes.', icon: 'cash-outline' },
    ],
    settings: [
      { label: 'Holes', value: 'Full 18 recommended' },
      { label: 'Format', value: 'Individual net or gross' },
      { label: 'Scoring', value: 'Skins + carries' },
      { label: 'Tees', value: 'Group agreement' },
      { label: 'Ties', value: 'Always carry unless modified' },
    ],
  },
  scramble: {
    tagline: 'One team, one best ball.',
    overview:
      'In a scramble everyone tees off, picks the best shot, and all play from that spot. Repeat until the ball is holed — fast, social, and great for mixed skill levels.',
    objective: 'Complete each hole in the fewest team strokes by always choosing the best position.',
    whoWins: 'Lowest team score for the round (stroke) or match scramble formats if you split into teams.',
    steps: [
      { title: 'Form teams', description: 'Usually 2–4 players per team; mix handicaps for balance.' },
      { title: 'Everyone drives', description: 'All tee shots, then pick the best drive to continue.' },
      { title: 'Place within a club', description: 'Drop within one club length of the chosen spot, no closer to hole.' },
      { title: 'Repeat', description: 'Everyone hits from the chosen spot until on the green.' },
      { title: 'Putt it out', description: 'On the green, same rule — pick the best putt line until holed.' },
      { title: 'Record one score', description: 'Team posts a single score per hole.' },
    ],
    scoringHeadline: 'Team score',
    scoringRows: [
      { label: 'Team A — hole 1', value: '4', accent: true },
      { label: 'Team B — hole 1', value: '5' },
      { label: 'Round total', value: 'Lowest wins' },
    ],
    tips: [
      { text: 'Pick the shot that gives the whole team a comfortable angle, not always the longest.', icon: 'git-merge-outline' },
      { text: 'Talk through wind and tiers before anyone hits.', icon: 'cloud-outline' },
      { text: 'Let newer players contribute early — confidence matters.', icon: 'heart-outline' },
      { text: 'Keep pace: limit searches and ready golf from the chosen lie.', icon: 'walk-outline' },
    ],
    settings: [
      { label: 'Holes', value: '9 or 18' },
      { label: 'Format', value: '2 Teams (4 Players Each)' },
      { label: 'Scoring', value: 'One team score per hole' },
      { label: 'Tees', value: 'Often mixed tees allowed' },
      { label: 'Ties', value: 'Playoff hole or countback' },
    ],
  },
  bullseye: {
    tagline: 'Hit the zone, bank the points.',
    overview:
      'Bullseye overlays scoring zones on a fairway or green. Closer to the target center earns more points — like darts, but with golf shots.',
    objective: 'Accumulate the most points across agreed shots or holes by landing in higher-value rings.',
    whoWins: 'Highest point total after the round or segment.',
    steps: [
      { title: 'Define the target', description: 'Pick a fairway/green area and mark rings (cones, strings, or GPS).' },
      { title: 'Assign values', description: 'Bullseye = max points; outer rings taper down.' },
      { title: 'Take your shots', description: 'Usually one shot per player per station or per hole.' },
      { title: 'Score honestly', description: 'Where the ball rests determines the ring — roll-outs count final position.' },
      { title: 'Rotate stations', description: 'Move targets to keep practice fresh on the range or course.' },
      { title: 'Add bonuses', description: 'Optional: clean strikes or trajectory bonuses for advanced groups.' },
    ],
    scoringHeadline: 'Example ring values',
    scoringRows: [
      { label: 'Bullseye (inner)', value: '5 pts', accent: true },
      { label: 'Middle ring', value: '3 pts' },
      { label: 'Outer ring', value: '1 pt' },
      { label: 'Outside / miss', value: '0 pts' },
    ],
    tips: [
      { text: 'Pick targets that match your group’s dispersion — keep it fair.', icon: 'locate-outline' },
      { text: 'Short irons first to groove distance control.', icon: 'flag-outline' },
      { text: 'Celebrate great strikes even when points are low.', icon: 'star-outline' },
      { text: 'Use this game on the range between rounds to stay sharp.', icon: 'fitness-outline' },
    ],
    settings: [
      { label: 'Holes', value: 'Range stations or on-course holes' },
      { label: 'Format', value: 'Individual points' },
      { label: 'Scoring', value: 'Ring-based points' },
      { label: 'Tees', value: 'Same yardage per station' },
      { label: 'Ties', value: 'Sudden-death station' },
    ],
  },
  par3: {
    tagline: 'Short holes, full intensity.',
    overview:
      'Par 3 Challenge ignores the rest of the course for side competition. Only par-3 scoring decides the winner — perfect for groups with mixed long games.',
    objective: 'Post the best aggregate score (or points) on all par 3s during the round.',
    whoWins: 'Lowest total strokes on par 3s, or most skins/points on those holes only.',
    steps: [
      { title: 'Identify par 3s', description: 'Mark them on the scorecard before teeing off.' },
      { title: 'Play normally', description: 'You still play the full course — only par 3s count for this game.' },
      { title: 'Track a separate line', description: 'Keep a mini column for par-3 strokes or outcomes.' },
      { title: 'Add side twists', description: 'Optional: closest to pin on each par 3 for bonus points.' },
      { title: 'Finish strong', description: 'Late par 3s can swing the game — manage nerves.' },
      { title: 'Settle', description: 'Compare par-3 totals at the end of the round.' },
    ],
    scoringHeadline: 'Example par-3 card',
    scoringRows: [
      { label: 'Par 3 holes', value: '#3 · #7 · #12 · #16' },
      { label: 'Your strokes', value: '3 · 4 · 2 · 3' },
      { label: 'Total', value: '12 (lower wins)', accent: true },
    ],
    tips: [
      { text: 'Tee strategy matters — choose the club that finds the middle of the green.', icon: 'analytics-outline' },
      { text: 'Wind on elevated par 3s plays tricks — take more club when in doubt.', icon: 'airplane-outline' },
      { text: 'Mark birdie chances — two putts from 15 feet wins many bets.', icon: 'golf-outline' },
      { text: 'Stay patient on blow-up holes; other par 3s remain.', icon: 'flame-outline' },
    ],
    settings: [
      { label: 'Holes', value: 'Course par 3s only' },
      { label: 'Format', value: 'Side game + main format' },
      { label: 'Scoring', value: 'Strokes or points' },
      { label: 'Tees', value: 'Group tees' },
      { label: 'Ties', value: 'Countback on hardest par 3' },
    ],
  },
  beat_clock: {
    tagline: 'Beat the buzzer, bank the win.',
    overview:
      'Beat the Clock adds time pressure to challenges — finish a station, hole, or sequence before the timer ends to earn points or avoid penalties.',
    objective: 'Complete defined tasks within the time limit more often than your friends.',
    whoWins: 'Most successful timed completions, or fewest time penalties, after the agreed session.',
    steps: [
      { title: 'Set challenges', description: 'Examples: 10 putts from 6 feet, 5 chips to a zone, or a sprint hole.' },
      { title: 'Start the clock', description: 'Use a phone timer visible to everyone.' },
      { title: 'Execute under pressure', description: 'Missed tasks cost points or add seconds.' },
      { title: 'Rotate starters', description: 'Fairness if wind or order matters.' },
      { title: 'Log results', description: 'Simple tally sheet keeps arguments away.' },
      { title: 'Cool down', description: 'Stretch — timed games spike heart rate.' },
    ],
    scoringHeadline: 'Example scoring',
    scoringRows: [
      { label: 'Finish before buzzer', value: '+2 pts', accent: true },
      { label: 'Finish 1–5 sec late', value: '+1 pt' },
      { label: 'Timeout', value: '0 pts' },
    ],
    tips: [
      { text: 'Routine beats rushing — same pre-shot process every rep.', icon: 'repeat-outline' },
      { text: 'Hydrate, especially on hot days when timers feel faster.', icon: 'water-outline' },
      { text: 'Start easy, raise difficulty only after everyone’s warm.', icon: 'trending-up-outline' },
      { text: 'Keep it light — this is training with a game face.', icon: 'happy-outline' },
    ],
    settings: [
      { label: 'Holes', value: 'Practice or on-course stations' },
      { label: 'Format', value: 'Timed skills challenge' },
      { label: 'Scoring', value: 'Points per success' },
      { label: 'Tees', value: 'N/A or per drill' },
      { label: 'Ties', value: 'Sudden-death 30s sprint' },
    ],
  },
  best_ball: {
    tagline: 'Best score on the card, every hole.',
    overview:
      'Best ball (fourball stroke play) lets each player play their own ball. The team records only the lowest score on each hole — great blend of teamwork and individual pride.',
    objective: 'Post the lowest team score per hole using the better ball of partners.',
    whoWins: 'Lowest total team score for the round, or match best-ball if playing head-to-head teams.',
    steps: [
      { title: 'Pair up', description: 'Teams of two (or variants with three players rotating).' },
      { title: 'Everyone plays through', description: 'Each golfer plays their own ball into the hole.' },
      { title: 'Take the low score', description: 'Record the better gross/net score for the team on that hole.' },
      { title: 'Strategy', description: 'Partners can play aggressive/conservative based on situation.' },
      { title: 'Putt it out', description: 'Both may putt; once hole is conceded or finished, move on.' },
      { title: 'Tally', description: 'Team has one line on the card per hole.' },
    ],
    scoringHeadline: 'Hole example (team of two)',
    scoringRows: [
      { label: 'Player A', value: '5' },
      { label: 'Player B', value: '4', accent: true },
      { label: 'Team score', value: '4 (best of A/B)' },
    ],
    tips: [
      { text: 'Communicate who is “safe” and who is “go” off the tee.', icon: 'chatbubbles-outline' },
      { text: 'On the green, read putts together — two reads beat one.', icon: 'eye-outline' },
      { text: 'Don’t let ego force risky shots when partner is in great shape.', icon: 'shield-checkmark-outline' },
      { text: 'Celebrate partner birdies like your own — they are.', icon: 'people-outline' },
    ],
    settings: [
      { label: 'Holes', value: '9 or 18' },
      { label: 'Format', value: '4 Teams (4 Players Each)' },
      { label: 'Scoring', value: 'Gross or net team per hole' },
      { label: 'Tees', value: 'Own tees or blended' },
      { label: 'Ties', value: 'USGA tie procedure or playoff' },
    ],
  },
  wolf: {
    tagline: 'Captain’s choice, every hole.',
    overview:
      'Wolf rotates a “captain” each hole. The wolf picks a partner after seeing tee shots — or goes lone wolf for bigger rewards and bigger risk.',
    objective: 'Earn points by winning holes as wolf/partner or as lone wolf against the pack.',
    whoWins: 'Highest point total after the agreed holes — point tables vary, so set them early.',
    steps: [
      { title: 'Set the order', description: 'Rotate who is wolf hole-by-hole (usually 4 players).' },
      { title: 'Tee shots', description: 'Everyone hits. Wolf watches order defined pre-round.' },
      { title: 'Pick or pass', description: 'Wolf may choose a partner after each tee shot, or wait until last player.' },
      { title: 'Lone wolf declaration', description: 'Before anyone tees, wolf can declare solo for max points/risk.' },
      { title: 'Play the hole', description: 'Wolf + partner vs. others (or wolf alone vs. all).' },
      { title: 'Award points', description: 'Win/loss per your table; carry unsettled bets if you like drama.' },
    ],
    scoringHeadline: 'Example points (customize)',
    scoringRows: [
      { label: 'Wolf + partner win', value: '+1 each', accent: true },
      { label: 'Opponents win', value: '+1 each' },
      { label: 'Lone wolf wins', value: '+3 wolf / 0 others' },
      { label: 'Lone wolf loses', value: '+1 each opponent' },
    ],
    tips: [
      { text: 'Write the point table on a card — Wolf has many house rules.', icon: 'document-text-outline' },
      { text: 'Pick partners who fit the hole shape, not just friendship.', icon: 'git-network-outline' },
      { text: 'Lone wolf is theater — use sparingly for big moments.', icon: 'sparkles-outline' },
      { text: 'Keep pace: decide picks quickly after tee shots.', icon: 'timer-outline' },
    ],
    settings: [
      { label: 'Holes', value: 'Rotates every hole · 4 players ideal' },
      { label: 'Format', value: 'Points game' },
      { label: 'Scoring', value: 'Custom wolf table' },
      { label: 'Tees', value: 'Same tees recommended' },
      { label: 'Ties', value: 'Halve points or no blood' },
    ],
  },
};

export function getSocialGameFullDetail(gameId: string): SocialGameFullDetail | null {
  const base = getSocialGameById(gameId);
  const body = DETAILS[gameId];
  if (!base || !body) return null;
  return {
    gameId,
    title: base.title,
    icon: base.icon,
    category: base.category,
    subtitle: base.description,
    ...body,
  };
}

export function categoryLabel(cat: SocialGameCategoryId): string {
  return SOCIAL_GAME_CATEGORY_LABELS[cat];
}
