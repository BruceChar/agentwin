import type { SentimentLabel } from '@agentwin/shared';
import { LLMService } from '../client.ts';
import { extractJson } from './json.ts';

export interface SentimentScoringInput {
  symbol: string;
  headline: string;
  body?: string;
  source?: string;
}

export interface SentimentScore {
  /** -1 ~ 1 */
  score: number;
  label: SentimentLabel;
  keywords: string[];
  reasoning: string;
}

const SYSTEM_PROMPT = `你是加密货币舆情分析师。对给定的新闻/社媒标题与正文，判断其对 {symbol} 的多空影响，输出 JSON（只输出 JSON）：
{
  "score": -1 到 1（正=利多，负=利空，0=中性；重大利多接近 1，重大利空接近 -1）,
  "label": "bullish" | "bearish" | "neutral",
  "keywords": ["影响情绪的关键词"],
  "reasoning": "1-2 句判断依据"
}
注意：区分事件本身与市场情绪，避免夸大；监管/安全事件通常利空，采用/合作事件通常利多。`;

/** 舆情打分器：单条文本 → 情绪分（供 sentiment 包聚合） */
export class SentimentAnalyzer {
  private readonly llm: LLMService;

  constructor(llm: LLMService) {
    this.llm = llm;
  }

  async score(input: SentimentScoringInput): Promise<SentimentScore> {
    const resp = await this.llm.complete({
      systemPrompt: SYSTEM_PROMPT.replace('{symbol}', input.symbol),
      messages: [{
        role: 'user',
        content: JSON.stringify({
          source: input.source ?? 'unknown',
          headline: input.headline,
          body: input.body ?? '',
        }, null, 2),
      }],
    });
    const text = LLMService.textOf(resp);
    const parsed = extractJson<SentimentScore>(text);
    if (!parsed || typeof parsed.score !== 'number') {
      return { score: 0, label: 'neutral', keywords: [], reasoning: text.slice(0, 200) };
    }
    return {
      score: clamp(parsed.score, -1, 1),
      label: parsed.label === 'bullish' || parsed.label === 'bearish' ? parsed.label : 'neutral',
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 10) : [],
      reasoning: parsed.reasoning ?? '',
    };
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
