import type { Strategy } from '../strategy.ts';

/**
 * 自定义描述策略：由用户选择技术指标 + 编写交易逻辑描述。
 * 不做自动信号生成（onBar 返回 null），供人工/LLM 依据指标与描述决策；
 * 参数保存所选指标与描述，作为策略配置存入库中。
 */
export function createCustomStrategy(): Strategy {
  return {
    id: 'custom',
    name: '自定义描述策略',
    description: '选择技术指标并编写交易规则描述，用于人工/LLM 决策与策略沉淀。',
    paramSpecs: [
      { name: 'indicators', type: 'string', default: '', description: '所选技术指标（逗号分隔）' },
      { name: 'description', type: 'string', default: '', description: '交易规则文本描述' },
    ],
    onBar(): null {
      return null; // 不自动交易，仅记录指标与描述
    },
    describe(): string {
      return '自定义策略：依据所选指标与文本描述人工/LLM 决策，不自动开平仓。';
    },
  };
}
