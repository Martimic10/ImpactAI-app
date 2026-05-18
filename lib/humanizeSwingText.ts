import { SwingResult } from '@/types';

const PHASE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bP6\s*\/\s*P7\b/gi, 'impact'],
  [/\bP6\s*-\s*P7\b/gi, 'impact'],
  [/\bat\s+P1\b/gi, 'at setup'],
  [/\bat\s+P2\b/gi, 'during the takeaway'],
  [/\bat\s+P3\b/gi, 'halfway through the backswing'],
  [/\bat\s+P4\b/gi, 'at the top of the backswing'],
  [/\bat\s+P5\b/gi, 'as the downswing starts'],
  [/\bat\s+P6\b/gi, 'approaching impact'],
  [/\bat\s+P7\b/gi, 'at impact'],
  [/\bat\s+P8\b/gi, 'early in the follow-through'],
  [/\bat\s+P9\b/gi, 'at the finish'],
  [/\bP1\b/gi, 'setup'],
  [/\bP2\b/gi, 'takeaway'],
  [/\bP3\b/gi, 'halfway back'],
  [/\bP4\b/gi, 'top of the backswing'],
  [/\bP5\b/gi, 'start of the downswing'],
  [/\bP6\b/gi, 'pre-impact'],
  [/\bP7\b/gi, 'impact'],
  [/\bP8\b/gi, 'early follow-through'],
  [/\bP9\b/gi, 'finish'],
  [/\bvs\.?\s+address\b/gi, 'compared with setup'],
];

export function humanizeSwingText(value: string | null | undefined): string {
  if (!value) return '';

  return PHASE_REPLACEMENTS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function humanizeSwingTextList(values: string[] | null | undefined): string[] {
  return (values ?? []).map(humanizeSwingText).filter(Boolean);
}

export function humanizeSwingResultText<T extends SwingResult>(result: T): T {
  result.primaryIssue = humanizeSwingText(result.primaryIssue);
  result.whyItHappens = humanizeSwingText(result.whyItHappens);
  result.ballFlightPrediction = humanizeSwingText(result.ballFlightPrediction);
  result.contactPrediction = humanizeSwingText(result.contactPrediction);
  result.clubSpecificNotes = humanizeSwingText(result.clubSpecificNotes);
  result.summary = humanizeSwingText(result.summary);
  result.evidence = humanizeSwingTextList(result.evidence);
  result.fixes = humanizeSwingTextList(result.fixes);
  result.keyCheckpoints = humanizeSwingTextList(result.keyCheckpoints);

  if (result.drill) {
    result.drill.name = humanizeSwingText(result.drill.name);
    result.drill.whyThisDrill = humanizeSwingText(result.drill.whyThisDrill);
    result.drill.steps = humanizeSwingTextList(result.drill.steps);
  }

  if (result.scoreReasoning) {
    const reasoning = result.scoreReasoning as unknown as Record<string, string | undefined>;
    for (const key of Object.keys(reasoning)) {
      reasoning[key] = humanizeSwingText(reasoning[key]);
    }
  }

  return result;
}
