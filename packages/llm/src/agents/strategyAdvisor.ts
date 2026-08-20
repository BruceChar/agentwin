import type { Context, Message, ToolCall } from '@earendil-works/pi-ai';
import type { StorageAdapter } from '@agentwin/db';
import { LLMService } from '../client.ts';
import { TradingToolkit } from '../toolkit.ts';

const SYSTEM_PROMPT = `你是专业加密货币量化交易策略顾问（AgentWin 系统）。你的原则：
1. 一切建议基于真实数据：先调用 get_klines / run_backtest / get_account / get_trades / get_pnl / get_sentiment 获取数据，再下结论。
2. 回测优先：推荐任何策略或参数前，先回测并引用指标（总收益、最大回撤、胜率、盈亏比）。
3. 参数要具体可执行；说明风险与适用行情（趋势/震荡）。
4. 需要落地时用 create_strategy 保存为草稿（不会自动启用），并说明调整理由。
5. 用中文回答，简洁专业，避免空话。`;

const TOOL_MAP: Record<string, keyof TradingToolkit> = {
  get_klines: 'getKlines',
  run_backtest: 'runBacktest',
  get_account: 'getAccount',
  get_trades: 'getTrades',
  get_pnl: 'getPnl',
  list_strategies: 'listStrategies',
  get_sentiment: 'getSentiment',
  create_strategy: 'createStrategy',
  set_strategy_enabled: 'setStrategyEnabled',
  add_journal: 'addJournal',
};

/**
 * 策略顾问：带工具调用循环的对话式 agent。
 * 会话持久化到存储（llm_sessions / llm_messages），支持跨轮次上下文。
 */
export class StrategyAdvisor {
  private readonly llm: LLMService;
  private readonly toolkit: TradingToolkit;
  private readonly storage: StorageAdapter;
  private readonly sessionId: string;

  constructor(llm: LLMService, toolkit: TradingToolkit, storage: StorageAdapter, sessionId: string) {
    this.llm = llm;
    this.toolkit = toolkit;
    this.storage = storage;
    this.sessionId = sessionId;
  }

  async ask(userText: string, onEvent?: Parameters<LLMService['stream']>[0]['onEvent']): Promise<string> {
    await this.storage.appendMessage({ sessionId: this.sessionId, role: 'user', content: userText });
    const persisted = await this.storage.listMessages(this.sessionId);
    const messages = toPiMessages(persisted);

    let rounds = 0;
    const context: Context = { systemPrompt: SYSTEM_PROMPT, messages, tools: this.toolkit.tools() };
    while (rounds < 8) {
      const resp = await this.llm.streamContext(context, onEvent);
      const text = LLMService.textOf(resp);
      const calls = resp.content.filter((c): c is ToolCall => c.type === 'toolCall');
      await this.storage.appendMessage({
        sessionId: this.sessionId, role: 'assistant', content: text,
        toolCalls: calls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments })),
      });
      if (calls.length === 0) return text;
      context.messages.push(resp);

      for (const call of calls) {
        let resultText: string;
        let isError = false;
        try {
          const fn = TOOL_MAP[call.name];
          const method = fn ? (this.toolkit[fn] as (a: Record<string, unknown>) => Promise<object>) : null;
          if (!method) {
            resultText = 'unknown tool: ' + call.name;
            isError = true;
          } else {
            const r = await method.call(this.toolkit, call.arguments);
            resultText = JSON.stringify(r);
          }
        } catch (e) {
          resultText = 'tool error: ' + (e instanceof Error ? e.message : String(e));
          isError = true;
        }
        messages.push({
          role: 'toolResult', toolCallId: call.id, toolName: call.name,
          content: [{ type: 'text', text: resultText }], isError, timestamp: Date.now(),
        } as Message);
        await this.storage.appendMessage({
          sessionId: this.sessionId, role: 'tool', content: resultText,
          toolCalls: [{ toolCallId: call.id, toolName: call.name, isError }],
        });
      }
      rounds++;
    }
    return '已达最大工具轮数（8），请把问题拆小后继续。';
  }
}

interface PersistedToolMeta {
  toolCallId: string;
  toolName: string;
  isError?: boolean;
}

function toPiMessages(persisted: { role: string; content: string; toolCalls?: unknown[] }[]): Message[] {
  const out: Message[] = [];
  for (const m of persisted) {
    if (m.role === 'user' || m.role === 'assistant') {
      out.push({ role: m.role, content: m.content, timestamp: Date.now() } as Message);
    } else if (m.role === 'tool') {
      const meta = (Array.isArray(m.toolCalls) ? m.toolCalls[0] : null) as PersistedToolMeta | null;
      if (meta) {
        out.push({
          role: 'toolResult', toolCallId: meta.toolCallId, toolName: meta.toolName,
          content: [{ type: 'text', text: m.content }], isError: meta.isError ?? false, timestamp: Date.now(),
        } as Message);
      }
    }
  }
  return out;
}
