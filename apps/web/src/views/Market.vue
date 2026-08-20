<template>
  <el-card shadow="never">
    <template #header>
      <div class="row">
        <span>K 线行情</span>
        <el-select v-model="symbol" style="width: 140px" @change="load">
          <el-option v-for="s in ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']" :key="s" :value="s" :label="s" />
        </el-select>
        <el-select v-model="market" style="width: 140px" @change="load">
          <el-option value="SPOT" label="现货" />
          <el-option value="USDT_M" label="U本位合约" />
        </el-select>
        <el-select v-model="interval" style="width: 120px" @change="load">
          <el-option v-for="i in ['1h', '4h', '1d']" :key="i" :value="i" :label="i" />
        </el-select>
        <el-input-number v-model="limit" :min="50" :max="500" :step="50" @change="load" />
      </div>
    </template>
    <div ref="chartEl" class="chart"></div>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import * as echarts from 'echarts';
import { api } from '../api.ts';

interface CandleView { openTime: number; open: number; high: number; low: number; close: number; volume: number }

const symbol = ref('BTCUSDT');
const market = ref('SPOT');
const interval = ref('1h');
const limit = ref(200);
const chartEl = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;

async function load() {
  const res = await api.get<{ candles: CandleView[] }>(
    '/market/klines?symbol=' + symbol.value + '&market=' + market.value + '&interval=' + interval.value + '&limit=' + limit.value,
  );
  const cs = res.candles;
  if (!chartEl.value) return;
  if (!chart) chart = echarts.init(chartEl.value);
  chart.setOption({
    tooltip: { trigger: 'axis' },
    axisPointer: { type: 'cross' },
    grid: [{ left: 60, right: 20, top: 20, height: '62%' }, { left: 60, right: 20, top: '75%', height: '15%' }],
    xAxis: [
      { type: 'category', data: cs.map((c) => new Date(c.openTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit' })), boundaryGap: true },
      { type: 'category', gridIndex: 1, data: cs.map((c) => new Date(c.openTime).toLocaleString('zh-CN', { hour: '2-digit' })), boundaryGap: true, axisLabel: { show: false } },
    ],
    yAxis: [{ scale: true }, { gridIndex: 1, scale: true }],
    dataZoom: [{ type: 'inside', xAxisIndex: [0, 1] }],
    series: [
      {
        type: 'candlestick', data: cs.map((c) => [c.open, c.close, c.low, c.high]),
        itemStyle: { color: '#f56c6c', color0: '#67c23a', borderColor: '#f56c6c', borderColor0: '#67c23a' },
      },
      { type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: cs.map((c) => c.volume), itemStyle: { color: 'rgba(22,119,255,0.3)' } },
    ],
  });
}

onMounted(load);
</script>

<style scoped>
.chart { height: 520px; }
.row { display: flex; gap: 12px; align-items: center; }
</style>
