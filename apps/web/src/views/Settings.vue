<template>
  <el-row :gutter="12">
    <el-col :span="8">
      <el-card shadow="never">
        <template #header>Binance 连接</template>
        <el-descriptions :column="1" size="small">
          <el-descriptions-item label="Key">{{ bs?.configured ? (bs.hasSecret ? '已配置' : '缺 Secret') : '未配置' }}</el-descriptions-item>
          <el-descriptions-item label="主域名可达">{{ bs?.reachable ? '是' : '否' }}</el-descriptions-item>
          <el-descriptions-item label="最近同步">{{ bs?.lastSync?.at ? new Date(bs.lastSync.at).toLocaleString('zh-CN') : '-' }}</el-descriptions-item>
          <el-descriptions-item label="同步结果">{{ bs?.lastSync?.ok ? '成功（余额 ' + (bs.lastSync.balancesUpserted ?? 0) + '）' : (bs?.lastSync?.message ?? '-') }}</el-descriptions-item>
        </el-descriptions>
        <el-alert v-if="bs && !bs.reachable" type="warning" :closable="false" class="mt" :title="bs.message ?? '不可达'" />
        <div class="row mt">
          <el-button size="small" type="primary" :loading="syncing" @click="sync">从币安同步</el-button>
          <el-button size="small" @click="diagnose">诊断</el-button>
        </div>
        <pre v-if="diag" class="diag">{{ diag }}</pre>
      </el-card>
    </el-col>
    <el-col :span="8">
      <el-card shadow="never">
        <template #header>代理设置</template>
        <div class="row">
          <el-switch v-model="proxyEnabled" active-text="走代理" inactive-text="直连" @change="applyProxy" />
        </div>
        <el-input v-model="proxyUrl" placeholder="http://127.0.0.1:7890" class="mt" @keyup.enter="applyProxy" />
        <el-button size="small" type="primary" class="mt" @click="applyProxy">应用</el-button>
        <div class="dim mt-sm">出口国家：<b>{{ proxyExit }}</b>（<span class="dim" :class="isRestricted ? 'down' : 'up'">{{ isRestricted ? '受限地区，需换节点' : '正常' }}</span>）</div>
      </el-card>
    </el-col>
    <el-col :span="8">
      <el-card shadow="never">
        <template #header>存储状态</template>
        <el-descriptions :column="1" size="small">
          <el-descriptions-item label="引擎">{{ health?.storage ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="交易日志">{{ jstat?.total ?? 0 }} 条（JSONL + SQLite 镜像）</el-descriptions-item>
          <el-descriptions-item label="账户">{{ accounts.length }} 个（{{ accounts.filter(a => a.type === 'real').length }} 真实）</el-descriptions-item>
        </el-descriptions>
        <div class="dim mt-sm">JSONL 为主存储（data/trade-journal.jsonl），SQLite 辅助查询/恢复。</div>
        <el-alert type="warning" :closable="false" class="mt" title="清空数据库会删除全部本地数据（账户/成交/日志/策略等），并立即从币安重新同步历史成交。模拟账户将被关闭。" />
        <el-button size="small" type="danger" class="mt" :loading="resetting" @click="resetAll">清空数据库并重新同步</el-button>
      </el-card>
    </el-col>
  </el-row>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api.ts';
import { loadAccounts } from '../store.ts';

const bs = ref<any>(null);
const health = ref<any>(null);
const accounts = ref<any[]>([]);
const jstat = ref<any>(null);
const syncing = ref(false);
const resetting = ref(false);
const proxyEnabled = ref(false);
const proxyUrl = ref('');
const proxyExit = ref('-');
const diag = ref('');
const isRestricted = ref(false);

async function load() {
  health.value = await api.get('/health').catch(() => null);
  bs.value = await api.get('/binance/status').catch(() => null);
  accounts.value = (await api.get<{ accounts: any[] }>('/accounts')).accounts;
  jstat.value = await api.get('/journal/trades/stats').catch(() => null);
  if (bs.value?.proxy) {
    proxyEnabled.value = bs.value.proxy.enabled;
    proxyUrl.value = bs.value.proxy.url ?? '';
  }
  const d = await api.get<{ proxyExit?: { country?: string; countryCode?: string } }>('/binance/diagnose').catch(() => null);
  if (d?.proxyExit?.country) {
    proxyExit.value = d.proxyExit.country;
    isRestricted.value = ['United States', 'US', '美国'].includes(d.proxyExit.country) || (d.proxyExit.countryCode === 'US');
  }
}

async function sync() {
  syncing.value = true;
  try {
    const res = await api.post<{ ok: boolean; message?: string }>('/binance/sync');
    ElMessage.success(res.ok ? '同步成功' : '同步失败：' + (res.message ?? ''));
    await load();
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    syncing.value = false;
  }
}

async function diagnose() {
  const d = await api.get('/binance/diagnose').catch(() => null);
  diag.value = d ? JSON.stringify(d, null, 2) : '';
}

/** 清空数据库并从币安重新同步历史成交（增量起点 = 最新本地记录） */
async function resetAll() {
  try {
    await ElMessageBox.confirm(
      '将删除全部本地数据（账户/成交/权益/交易日志/策略等），关闭模拟账户，并立即从币安全量拉取历史成交。\n此操作不可恢复，确定继续？',
      '清空数据库',
      { type: 'warning', confirmButtonText: '清空并同步', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  resetting.value = true;
  try {
    const res = await api.post<{ ok: boolean; accounts: { id: string; name: string; type: string }[]; sync: { tradesSynced: number; tradesSkipped: number; balancesUpserted: number; ok: boolean; message?: string } }>('/admin/reset');
    ElMessage.success('已清空并同步：成交 ' + (res.sync?.tradesSynced ?? 0) + ' 条（跳过 ' + (res.sync?.tradesSkipped ?? 0) + '）');
    await loadAccounts();
    await load();
  } catch (e) {
    ElMessage.error('清空失败：' + (e instanceof Error ? e.message : String(e)));
  } finally {
    resetting.value = false;
  }
}

async function applyProxy() {
  try {
    const cfg = await api.post<{ enabled: boolean; url?: string }>('/binance/proxy', { mode: proxyEnabled.value ? 'on' : 'off', url: proxyUrl.value });
    proxyEnabled.value = cfg.enabled;
    proxyUrl.value = cfg.url ?? '';
    ElMessage.success('代理已切换：' + (cfg.enabled ? '走 ' + cfg.url : '直连'));
    await load();
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}

onMounted(load);
</script>

<style scoped>
.mt { margin-top: 10px; }
.mt-sm { margin-top: 6px; }
.row { display: flex; align-items: center; gap: 10px; }
.dim { color: var(--text-dim); font-size: 12px; }
.diag { background: var(--bg-elev); border: 1px solid var(--border); border-radius: 6px; padding: 8px; font-size: 11px; max-height: 220px; overflow: auto; font-family: var(--mono); }
</style>
