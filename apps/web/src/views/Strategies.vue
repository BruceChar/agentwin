<template>
  <el-row :gutter="16">
    <el-col :span="10">
      <el-card shadow="never">
        <template #header>内置策略</template>
        <el-collapse>
          <el-collapse-item v-for="m in metas" :key="m.id" :name="m.id">
            <template #title><b>{{ m.name }}</b>&nbsp;<span class="dim">{{ m.id }}</span></template>
            <p class="desc">{{ m.description }}</p>
            <el-form label-width="110px" size="small">
              <el-form-item v-for="p in m.paramSpecs" :key="p.name" :label="p.name">
                <el-input-number v-if="p.min !== undefined" v-model="paramDrafts[m.id][p.name]" :min="p.min" :max="p.max" :step="p.step ?? 1" size="small" />
                <el-switch v-else-if="typeof p.default === 'boolean'" v-model="paramDrafts[m.id][p.name]" />
                <el-input v-else v-model="paramDrafts[m.id][p.name]" size="small" />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" size="small" @click="runBacktest(m)">回测这个策略</el-button>
              </el-form-item>
            </el-form>
          </el-collapse-item>
        </el-collapse>
      </el-card>
      <el-card shadow="never" class="mt">
        <template #header>新增自定义策略（技术指标 + 文本描述）</template>
        <el-form label-width="90px" size="small">
          <el-form-item label="策略名称"><el-input v-model="custom.name" placeholder="如 顺势突破 v1" /></el-form-item>
          <el-form-item label="市场 / 币种">
            <el-select v-model="custom.market" style="width: 45%">
              <el-option v-for="(label, m) in MARKET_LABELS" :key="m" :value="m" :label="label" />
            </el-select>
            <el-select v-model="custom.symbol" style="width: 45%">
              <el-option v-for="s in ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','WIFUSDT','ALLOUSDT','AVAXUSDT']" :key="s" :value="s" :label="s" />
            </el-select>
          </el-form-item>
          <el-form-item label="周期"><el-select v-model="custom.interval" style="width: 45%">
            <el-option v-for="i in ['1m','5m','15m','1h','4h','1d']" :key="i" :value="i" :label="i" />
          </el-select></el-form-item>
          <el-form-item label="技术指标">
            <el-checkbox-group v-model="custom.indicators">
              <el-checkbox v-for="ind in INDICATOR_OPTIONS" :key="ind" :value="ind" size="small">{{ ind }}</el-checkbox>
            </el-checkbox-group>
          </el-form-item>
          <el-form-item label="文本描述">
            <el-input v-model="custom.description" type="textarea" :rows="4" placeholder="描述你的交易规则，例如：MA20 上穿 MA60 且 RSI 大于 50 时开多；跌破 MA20 平仓…" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" size="small" :loading="saving" @click="saveCustom">保存策略</el-button>
            <span class="dim">保存后出现在下方「已保存策略」，供后续回测/启用</span>
          </el-form-item>
        </el-form>
      </el-card>
      <el-card shadow="never" class="mt">
        <template #header>已保存策略</template>
        <el-table :data="configs" size="small">
          <el-table-column prop="name" label="策略" />
          <el-table-column prop="symbol" label="币种" width="90" />
          <el-table-column prop="interval" label="周期" width="70" />
          <el-table-column label="来源" width="80"><template #default="{ row }"><el-tag size="small" :type="row.source === 'llm' ? 'warning' : 'info'">{{ row.source }}</el-tag></template></el-table-column>
          <el-table-column label="启用" width="70"><template #default="{ row }"><el-switch :model-value="row.enabled" @change="(v: boolean) => toggle(row.id, v)" /></template></el-table-column>
          <el-table-column label="参数"><template #default="{ row }">{{ JSON.stringify(row.parameters) }}</template></el-table-column>
        </el-table>
      </el-card>
    </el-col>
    <el-col :span="14">
      <el-card shadow="never">
        <template #header>回测结果</template>
        <template v-if="result">
          <el-row :gutter="12">
            <el-col :span="4" v-for="c in metricCards" :key="c.label">
              <el-card shadow="never" class="metric"><div class="mlabel">{{ c.label }}</div><div class="mvalue" :class="c.value >= 0 ? 'up' : 'down'">{{ c.fmt(c.value) }}</div></el-card>
            </el-col>
          </el-row>
          <div ref="chartEl" class="chart"></div>
          <el-table :data="result.trades" size="small" max-height="260">
            <el-table-column prop="side" label="方向" width="80" />
            <el-table-column prop="entryPrice" label="开仓价" width="100" />
            <el-table-column prop="exitPrice" label="平仓价" width="100" />
            <el-table-column label="盈亏" width="100"><template #default="{ row }"><span :class="row.pnl >= 0 ? 'up' : 'down'">{{ row.pnl.toFixed(2) }}</span></template></el-table-column>
            <el-table-column prop="reason" label="原因" />
          </el-table>
        </template>
        <el-empty v-else description="选择左侧策略点击「回测这个策略」" />
      </el-card>
    </el-col>
  </el-row>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import * as echarts from 'echarts';
import { ElMessage } from 'element-plus';
import { api, MARKET_LABELS, type BacktestResult, type StrategyConfig, type StrategyMeta } from '../api.ts';

const INDICATOR_OPTIONS = ['MA', 'EMA', 'MACD', 'RSI', 'BOLL(布林)', 'ATR', 'KDJ', '成交量', 'OBV', 'VWAP', '斐波那契', '趋势线/结构'];
const metas = ref<StrategyMeta[]>([]);
const configs = ref<StrategyConfig[]>([]);
const result = ref<BacktestResult | null>(null);
const chartEl = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;
const paramDrafts = reactive<Record<string, Record<string, number | string | boolean>>>({});
const saving = ref(false);
const custom = reactive<{ name: string; market: string; symbol: string; interval: string; indicators: string[]; description: string }>({
  name: '', market: 'SPOT', symbol: 'BTCUSDT', interval: '1h', indicators: [], description: '',
});

const metricCards = computed(() => {
  const m = result.value?.metrics;
  if (!m) return [];
  return [
    { label: '总收益', value: m.totalReturn, fmt: (v: number) => (v * 100).toFixed(2) + '%' },
    { label: '年化', value: m.annualizedReturn, fmt: (v: number) => (v * 100).toFixed(2) + '%' },
    { label: '最大回撤', value: -m.maxDrawdown, fmt: (v: number) => (v * 100).toFixed(2) + '%' },
    { label: 'Sharpe', value: m.sharpe, fmt: (v: number) => v.toFixed(2) },
    { label: '胜率', value: m.winRate, fmt: (v: number) => (v * 100).toFixed(1) + '%' },
    { label: '盈亏比', value: m.profitFactor, fmt: (v: number) => v.toFixed(2) },
    { label: '交易数', value: m.totalTrades, fmt: (v: number) => String(v) },
  ];
});

async function load() {
  const b = await api.get<{ strategies: StrategyMeta[] }>('/strategies/builtin');
  metas.value = b.strategies;
  for (const m of metas.value) {
    if (!paramDrafts[m.id]) {
      paramDrafts[m.id] = {};
      for (const p of m.paramSpecs) paramDrafts[m.id][p.name] = p.default;
    }
  }
  configs.value = (await api.get<{ strategies: StrategyConfig[] }>('/strategies')).strategies;
}

async function runBacktest(meta: StrategyMeta) {
  const res = await api.post<BacktestResult>('/backtest', {
    strategy: meta.id, params: paramDrafts[meta.id],
    symbol: 'BTCUSDT', market: 'SPOT', interval: '1h', fromDays: 90, initialCapital: 10000,
  });
  result.value = res;
  renderChart();
}

function renderChart() {
  if (!result.value || !chartEl.value) return;
  if (!chart) chart = echarts.init(chartEl.value);
  const points = result.value.equityCurve;
  chart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 60, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: points.map((p) => new Date(p.timestamp).toLocaleDateString('zh-CN')) },
    yAxis: { type: 'value', scale: true },
    series: [{ type: 'line', showSymbol: false, data: points.map((p) => p.equity), lineStyle: { color: '#1677ff' }, areaStyle: { color: 'rgba(22,119,255,0.08)' } }],
  });
}

/** 保存自定义策略：指标选择 + 文本描述，写入策略库 */
async function saveCustom() {
  if (!custom.name.trim()) { ElMessage.warning('请填写策略名称'); return; }
  if (!custom.indicators.length) { ElMessage.warning('请至少选择一个技术指标'); return; }
  if (!custom.description.trim()) { ElMessage.warning('请填写文本描述'); return; }
  saving.value = true;
  try {
    await api.post('/strategies', {
      name: 'custom',
      id: 'custom-' + Date.now().toString(36),
      description: custom.description.trim(),
      market: custom.market,
      symbol: custom.symbol,
      interval: custom.interval,
      params: {
        indicators: custom.indicators.join(','),
        description: custom.description.trim(),
      },
      source: 'user',
      enabled: false,
    });
    ElMessage.success('自定义策略已保存');
    Object.assign(custom, { name: '', indicators: [], description: '' });
    configs.value = (await api.get<{ strategies: StrategyConfig[] }>('/strategies')).strategies;
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    saving.value = false;
  }
}

async function toggle(id: string, v: boolean) {
  await api.patch('/strategies/' + id, { enabled: v });
  ElMessage.success(v ? '已启用' : '已停用');
  configs.value = (await api.get<{ strategies: StrategyConfig[] }>('/strategies')).strategies;
}

onMounted(load);
</script>

<style scoped>
.mt { margin-top: 16px; }
.desc { color: #666; font-size: 13px; }
.dim { color: #aaa; font-size: 12px; font-weight: 400; }
.chart { height: 240px; margin: 12px 0; }
.metric { text-align: center; }
.mlabel { color: #999; font-size: 12px; }
.mvalue { font-size: 18px; font-weight: 700; }
.up { color: #67c23a; }
.down { color: #f56c6c; }
</style>
