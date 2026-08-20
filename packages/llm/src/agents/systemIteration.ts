import type { StrategyParamValue } from '@agentwin/shared';
import { LLMService } from '../client.ts';
import { extractJson } from './json.ts';

export interface IterationInput {
  strategy: { id: string; name: string; params: Record<string, StrategyParamValue> };
  backtest: {
    totalReturn: number; maxDrawdown: number; sharpe: number; winRate: number;
    profitFactor: number; totalTrades: number; netPnlEstimate?: number;
    recentTrades?: { side: string; pnl: number; reason: string }[];
  };
  journal?: { title: string; body: string; tags: string[] }[];
  marketHint?: string;
}

export interface IterationProposal {
  analysis: string;
  problems: string[];
  /** 可为 null：认为当前策略无需调整 */
  proposal: { strategy: string; params: Record<string, StrategyParamValue>; description: string } | null;
  riskNotes: string[];
}

const SYSTEM_PROMPT = `你是量化交易系统迭代器。输入当前策略、回测绩效、交易日志摘要，输出 JSON（不要输出 JSON 以外的内容）：
{
  "analysis": "对当前表现的诊断（2-4 句，引用回测指标）",
  "problems": ["具体问题，如：回撤过大、胜率低、盈亏比差、参数过拟合"],
  "proposal": {
    "strategy": "内置策略 id（ma_cross/rsi/bollinger/grid/dca/macd_trend），或保持原策略",
    "params": { "参数名": 值 },
    "description": "调整理由与预期效果"
  } | null,
  "riskNotes": ["风险提示"]
}
要求：小步调整、单次只改 1-2 个参数、避免过拟合（不追求历史最优，追求稳健）。`;

/** 系统迭代器：根据回测结果 + 日志，提出下一版策略（不直接改线上配置） */
export class SystemIterationAgent {
  private readonly llm: LLMService;

  constructor(llm: LLMService) {
    this.llm = llm;
  }

  async propose(input: IterationInput): Promise<IterationProposal> {
    const resp = await this.llm.complete({
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(input, null, 2) }],
    });
    const text = LLMService.textOf(resp);
    const parsed = extractJson<IterationProposal>(text);
    if (!parsed) {
      return {
        analysis: text.slice(0, 500),
        problems: ['模型输出未解析为结构化 JSON，请重试'],
        proposal: null,
        riskNotes: [],
      };
    }
    return parsed;
  }
}
