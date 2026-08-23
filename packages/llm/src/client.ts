import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import type { AssistantMessage, Context, Message, Tool } from '@earendil-works/pi-ai';

export interface LLMStreamEvent {
  type: 'text_delta' | 'toolcall_end' | 'done' | 'error';
  delta?: string;
  toolName?: string;
  message?: string;
}

export interface ChatInput {
  systemPrompt?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  tools?: Tool[];
  onEvent?: (e: LLMStreamEvent) => void;
}

export interface LLMServiceOptions {
  /** pi-ai provider id，默认读 LLM_PROVIDER，缺省 deepseek */
  provider?: string;
  /** 模型 id，默认读 LLM_MODEL，缺省 deepseek-v4-flash */
  model?: string;
}

/**
 * pi-ai SDK 封装：统一 LLM 调用入口。
 * 鉴权自动解析（DEEPSEEK_API_KEY / OPENAI_API_KEY 等环境变量）。
 */
export class LLMService {
  private models = builtinModels();
  private provider: string;
  private modelId: string;

  constructor(opts: LLMServiceOptions = {}) {
    this.provider = opts.provider ?? process.env.LLM_PROVIDER ?? 'deepseek';
    this.modelId = opts.model ?? process.env.LLM_MODEL ?? 'deepseek-v4-flash';
  }

  /** 运行时切换 provider / model（设置页 LLM 配置即时生效） */
  configure(opts: { provider?: string; model?: string }): void {
    if (opts.provider) this.provider = opts.provider;
    if (opts.model) this.modelId = opts.model;
  }

  get model(): string {
    return this.provider + '/' + this.modelId;
  }

  private resolveModel() {
    const m = this.models.getModel(this.provider, this.modelId);
    if (!m) throw new Error('pi-ai: unknown model ' + this.provider + '/' + this.modelId + ' — check LLM_PROVIDER/LLM_MODEL');
    return m;
  }

  buildContext(input: ChatInput): Context {
    const messages: Message[] = input.messages.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: Date.now(),
    }) as Message);
    return {
      systemPrompt: input.systemPrompt,
      messages,
      tools: input.tools,
    };
  }

  /** 非流式完整调用（返回最终 AssistantMessage） */
  async complete(input: ChatInput): Promise<AssistantMessage> {
    return this.completeContext(this.buildContext(input));
  }

  /** 非流式完整调用（完整 Context，支持工具结果消息） */
  async completeContext(context: Context): Promise<AssistantMessage> {
    return this.models.complete(this.resolveModel(), context);
  }

  /** 流式调用：逐事件回调 + 返回最终消息 */
  async stream(input: ChatInput): Promise<AssistantMessage> {
    return this.streamContext(this.buildContext(input), input.onEvent);
  }

  /** 流式调用（完整 Context） */
  async streamContext(context: Context, onEvent?: (e: LLMStreamEvent) => void): Promise<AssistantMessage> {
    const s = this.models.stream(this.resolveModel(), context);
    for await (const e of s) {
      switch (e.type) {
        case 'text_delta':
          onEvent?.({ type: 'text_delta', delta: e.delta });
          break;
        case 'toolcall_end':
          onEvent?.({ type: 'toolcall_end', toolName: e.toolCall.name });
          break;
        case 'error':
          onEvent?.({ type: 'error', message: e.error.errorMessage });
          break;
        case 'done':
          onEvent?.({ type: 'done' });
          break;
      }
    }
    return s.result();
  }

  /** 汇总助手消息文本 */
  static textOf(msg: AssistantMessage): string {
    return msg.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { text: string }).text)
      .join('');
  }
}