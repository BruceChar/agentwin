import type { SentimentLabel } from '@agentwin/shared';

const BULLISH_WORDS = [
  'surge', 'rally', 'soar', 'gain', 'upgrade', 'adopt', 'launch', 'partnership',
  'etf', 'approval', 'record high', 'bullish', 'breakout', 'halving', 'institutional',
  'all-time high', 'integration', 'milestone', 'positive', 'growth', 'support',
];
const BEARISH_WORDS = [
  'crash', 'plunge', 'drop', 'fall', 'dump', 'hack', 'exploit', 'ban', 'lawsuit',
  'securities', 'fine', 'arrest', 'rug pull', 'fraud', 'bearish', 'sell-off', 'decline',
  'fear', 'outflow', 'delist', 'collapse', 'warning', 'scam', 'pump and dump', 'regulation',
];

/** 启发式打分（无 LLM 时的降级方案） */
export function heuristicScore(title: string, body?: string): { score: number; label: SentimentLabel; keywords: string[] } {
  const text = (title + ' ' + (body ?? '')).toLowerCase();
  const bullish = BULLISH_WORDS.filter((w) => text.includes(w));
  const bearish = BEARISH_WORDS.filter((w) => text.includes(w));
  const total = bullish.length + bearish.length;
  const score = total > 0 ? (bullish.length - bearish.length) / total : 0;
  const clamped = Math.max(-1, Math.min(1, score));
  const label: SentimentLabel = clamped > 0.15 ? 'bullish' : (clamped < -0.15 ? 'bearish' : 'neutral');
  return { score: Math.round(clamped * 100) / 100, label, keywords: [...bullish, ...bearish].slice(0, 10) };
}
