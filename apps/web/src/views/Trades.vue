<template>
  <div>
    <el-card shadow="never" class="mb">
      <div class="row">
        <span class="label">账户：</span>
        <el-select :model-value="accountStore.selectedId" style="width: 220px" @change="onAccountChange">
          <el-option v-for="a in accountStore.accounts" :key="a.id" :value="a.id" :label="(a.type === 'real' ? '真实 ' : '模拟 ') + a.name" />
        </el-select>
        <span class="label">市场：</span>
        <el-select v-model="market" style="width: 140px" @change="load">
          <el-option value="" label="全部" />
          <el-option v-for="(label, m) in MARKET_LABELS" :key="m" :value="m" :label="label" />
        </el-select>
        <el-button size="small" @click="load">刷新</el-button>
      </div>
    </el-card>
    <el-row :gutter="16">
      <el-col :span="4" v-for="c in cards" :key="c.label">
        <el-card shadow="never" class="metric"><div class="mlabel">{{ c.label }}</div><div class="mvalue" :class="c.cls">{{ c.text }}</div></el-card>
      </el-col>
    </el-row>
    <el-card shadow="never" class="mt">
      <template #header>全部成交记录</template>
      <el-table :data="trades" size="small" max-height="480">
        <el-table-column label="市场" width="100"><template #default="{ row }">{{ MARKET_LABELS[row.market] ?? row.market }}</template></el-table-column>
        <el-table-column prop="symbol" label="币种" width="120" />
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
import { computed, onMounted, ref, watch } from 'vue';
import { api, MARKET_LABELS, type Trade, type TradeAgg } from '../api.ts';
import { accountStore, loadAccounts, selectAccount } from '../store.ts';

const market = ref('');
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

function onAccountChange(id: string) {
  selectAccount(id);
  load();
}

async function load() {
  await loadAccounts();
  const params = new URLSearchParams();
  if (accountStore.selectedId) params.set('accountId', accountStore.selectedId);
  if (market.value) params.set('market', market.value);
  const qs = params.toString();
  agg.value = await api.get<TradeAgg>('/pnl' + (qs ? '?' + qs : ''));
  trades.value = (await api.get<{ trades: Trade[] }>('/trades?' + (qs ? qs + '&' : '') + 'limit=200')).trades;
}

watch(() => accountStore.selectedId, () => load());

onMounted(load);
</script>

<style scoped>
.mb { margin-bottom: 16px; }
.mt { margin-top: 16px; }
.row { display: flex; align-items: center; gap: 8px; }
.label { font-weight: 600; }
.metric { text-align: center; }
.mlabel { color: #999; font-size: 12px; }
.mvalue { font-size: 18px; font-weight: 700; margin-top: 4px; }
.up { color: #f56c6c; }
.down { color: #67c23a; }
</style>
