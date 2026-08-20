<template>
  <el-row :gutter="16">
    <el-col :span="8">
      <el-card shadow="never">
        <template #header>Paper Trading 控制台</template>
        <el-form label-width="90px" size="small">
          <el-form-item label="策略配置">
            <el-select v-model="configId" placeholder="选择已保存策略">
              <el-option v-for="c in configs" :key="c.id" :value="c.id" :label="c.name + ' · ' + c.symbol + ' · ' + c.interval" />
            </el-select>
          </el-form-item>
          <el-form-item label="币种"><el-input v-model="symbol" /></el-form-item>
          <el-form-item label="市场">
            <el-select v-model="market" style="width: 100%"><el-option value="SPOT" label="现货" /><el-option value="USDT_M" label="U本位合约" /></el-select>
          </el-form-item>
          <el-form-item label="周期">
            <el-select v-model="interval" style="width: 100%"><el-option v-for="i in ['1m','5m','15m','1h','4h','1d']" :key="i" :value="i" :label="i" /></el-select>
          </el-form-item>
          <el-form-item>
            <el-button v-if="!status?.running" type="primary" @click="start">启动</el-button>
            <el-button v-else type="danger" @click="stop">停止</el-button>
          </el-form-item>
        </el-form>
        <el-alert type="info" :closable="false" title="使用 Binance 真实行情，本地模拟账户成交，不触碰真实资金" />
      </el-card>
      <el-card shadow="never" class="mt">
        <template #header>运行状态</template>
        <el-descriptions :column="1" size="small">
          <el-descriptions-item label="运行中">{{ status?.running ? '是' : '否' }}</el-descriptions-item>
          <el-descriptions-item label="最新价">{{ status?.lastPrice?.toFixed(2) }}</el-descriptions-item>
          <el-descriptions-item label="权益">{{ status?.equity?.toFixed(2) }}</el-descriptions-item>
          <el-descriptions-item label="现金">{{ status?.cash?.toFixed(2) }}</el-descriptions-item>
          <el-descriptions-item label="最后一根 K 线">{{ status?.lastBarOpenTime ? new Date(status.lastBarOpenTime).toLocaleString('zh-CN') : '-' }}</el-descriptions-item>
        </el-descriptions>
      </el-card>
    </el-col>
    <el-col :span="16">
      <el-card shadow="never">
        <template #header>最近成交</template>
        <el-table :data="trades" size="small" max-height="400">
          <el-table-column prop="symbol" label="币种" width="100" />
          <el-table-column label="方向" width="70"><template #default="{ row }"><el-tag :type="row.side === 'BUY' ? 'danger' : 'success'" size="small">{{ row.side }}</el-tag></template></el-table-column>
          <el-table-column prop="qty" label="数量" width="90" />
          <el-table-column prop="price" label="价格" width="100" />
          <el-table-column label="盈亏" width="100"><template #default="{ row }"><span :class="(row.realizedPnl ?? 0) >= 0 ? 'up' : 'down'">{{ row.realizedPnl?.toFixed(2) ?? '-' }}</span></template></el-table-column>
          <el-table-column label="时间"><template #default="{ row }">{{ new Date(row.tradedAt).toLocaleString('zh-CN') }}</template></el-table-column>
        </el-table>
      </el-card>
    </el-col>
  </el-row>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api, type StrategyConfig, type Trade } from '../api.ts';

interface PaperStatus { running: boolean; lastPrice: number; equity: number; cash: number; lastBarOpenTime: number }

const configs = ref<StrategyConfig[]>([]);
const configId = ref('');
const symbol = ref('BTCUSDT');
const market = ref('SPOT');
const interval = ref('1h');
const status = ref<PaperStatus | null>(null);
const trades = ref<Trade[]>([]);

async function refresh() {
  status.value = await api.get<PaperStatus>('/paper/status');
  trades.value = (await api.get<{ trades: Trade[] }>('/trades?limit=30')).trades;
}

async function start() {
  const cfg = configs.value.find((c) => c.id === configId.value);
  if (!cfg) { ElMessage.warning('请先选择策略配置（可在策略页创建）'); return; }
  await api.post('/paper/start', { strategyId: cfg.name, configId: cfg.id, symbol: symbol.value, market: market.value, interval: interval.value });
  ElMessage.success('已启动');
  await refresh();
}

async function stop() {
  await api.post('/paper/stop');
  ElMessage.info('已停止');
  await refresh();
}

onMounted(async () => {
  configs.value = (await api.get<{ strategies: StrategyConfig[] }>('/strategies')).strategies;
  await refresh();
  setInterval(refresh, 5000);
});
</script>

<style scoped>
.mt { margin-top: 16px; }
.up { color: #f56c6c; }
.down { color: #67c23a; }
</style>
