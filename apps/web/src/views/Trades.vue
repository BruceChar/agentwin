<template>
  <div>
    <el-row :gutter="16">
      <el-col :span="4" v-for="c in cards" :key="c.label">
        <el-card shadow="never" class="metric"><div class="mlabel">{{ c.label }}</div><div class="mvalue" :class="c.cls">{{ c.text }}</div></el-card>
      </el-col>
    </el-row>
    <el-card shadow="never" class="mt">
      <template #header>全部成交记录</template>
      <el-table :data="trades" size="small" max-height="480">
        <el-table-column prop="symbol" label="币种" width="110" />
        <el-table-column label="方向" width="80"><template #default="{ row }"><el-tag :type="row.side === 'BUY' ? 'danger' : 'success'" size="small">{{ row.side }}</el-tag></template></el-table-column>
        <el-table-column prop="qty" label="数量" width="100" />
        <el-table-column prop="price" label="价格" width="110" />
        <el-table-column prop="fee" label="手续费" width="100" />
        <el-table-column label="已实现盈亏" width="120"><template #default="{ row }"><span :class="(row.realizedPnl ?? 0) >= 0 ? 'up' : 'down'">{{ row.realizedPnl?.toFixed(2) ?? '-' }}</span></template></el-table-column>
        <el-table-column label="时间"><template #default="{ row }">{{ new Date(row.tradedAt).toLocaleString('zh-CN') }}</template></el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, type Trade, type TradeAgg } from '../api.ts';

const agg = ref<TradeAgg | null>(null);
const trades = ref<Trade[]>([]);

const cards = computed(() => {
  const a = agg.value;
  if (!a) return [];
  const pf = a.profitFactor === Infinity ? '∞' : a.profitFactor.toFixed(2);
  return [
    { label: '净盈亏', text: a.netPnl.toFixed(2), cls: a.netPnl >= 0 ? 'up' : 'down' },
    { label: '胜率', text: (a.winRate * 100).toFixed(1) + '%', cls: '' },
    { label: '毛盈利', text: a.grossProfit.toFixed(2), cls: 'up' },
    { label: '毛亏损', text: a.grossLoss.toFixed(2), cls: 'down' },
    { label: '盈亏比', text: pf, cls: '' },
    { label: '手续费', text: a.feesPaid.toFixed(2), cls: '' },
    { label: '交易数', text: String(a.totalTrades), cls: '' },
  ];
});

onMounted(async () => {
  agg.value = await api.get<TradeAgg>('/pnl');
  trades.value = (await api.get<{ trades: Trade[] }>('/trades?limit=200')).trades;
});
</script>

<style scoped>
.mt { margin-top: 16px; }
.metric { text-align: center; }
.mlabel { color: #999; font-size: 12px; }
.mvalue { font-size: 18px; font-weight: 700; margin-top: 4px; }
.up { color: #f56c6c; }
.down { color: #67c23a; }
</style>
