import type { BacktestTrade, JournalEntry } from '@agentwin/shared';
import { LLMService } from '../client.ts';
import { extractJson } from './json.ts';

export interface JournalAnalysisInput {
  strategy?: { id: string; name: string; params: Record<string, unknown> };
  trades: BacktestTrade[] | { symbol: string; side: string; pnl?: number; reason?: string }[];
  journalEntries: JournalEntry[];
}

export interface JournalAnalysis {
  patterns: string[];
  mistakes: string[];
  strengths: string[];
  recommendations: string[];
  /** 情绪/纪律评分 0-100 */
  disciplineScore: number;
}

const SYSTEM_PROMPT = `你是交易日志分析师。输入交易记录与复盘日志，输出 JSON（只输出 JSON）：
{
  "patterns": ["重复出现的行为/市场形态"],
  "mistakes": ["可改进的错误：追高、扛单、提前止盈、仓位过重、逆势加仓等"],
  "strengths": ["做对的地方"],
  "recommendations": ["具体改进建议"],
  "disciplineScore": 0-100
}
要求：基于事实、给出可执行建议、中文。`;

/** 交易日志分析器：把交易流水 + 复盘日志变成纪律洞察 */
export class JournalAnalyzer {
  private readonly llm: LLMService;

  constructor(llm: LLMService) {
    this.llm = llm;
  }

  async analyze(input: JournalAnalysisInput): Promise<JournalAnalysis> {
    const resp = await this.llm.complete({
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(input, null, 2) }],
    });
    const text = LLMService.textOf(resp);
    const parsed = extractJson<JournalAnalysis>(text);
    if (!parsed) {
      return {
        patterns: [], mistakes: [text.slice(0, 300)], strengths: [],
        recommendations: ['模型输出未解析为结构化 JSON，请重试'], disciplineScore: 50,
      };
    }
    return parsed;
  }
}
