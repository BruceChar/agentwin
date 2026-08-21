<template>
  <el-row :gutter="16">
    <el-col :span="8">
      <el-card shadow="never">
        <template #header>舆情扫描</template>
        <el-form label-width="70px">
          <el-form-item label="币种"><el-input v-model="symbol" /></el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="scanning" @click="scan">扫描 RSS 新闻</el-button>
          </el-form-item>
        </el-form>
        <el-alert type="info" :closable="false" title="抓取 CoinTelegraph / CoinDesk / Decrypt RSS，用 LLM 打分（无 Key 时降级为关键词启发式）" />
      </el-card>
      <el-card shadow="never" class="mt">
        <template #header>聚合情绪</template>
        <template v-if="agg">
          <el-descriptions :column="1" size="small">
            <el-descriptions-item label="平均分">{{ agg.averageScore }}</el-descriptions-item>
            <el-descriptions-item label="情绪"><el-tag :type="labelType(agg.label)" size="small">{{ agg.label }}</el-tag></el-descriptions-item>
            <el-descriptions-item label="样本数">{{ agg.count }}</el-descriptions-item>
          </el-descriptions>
        </template>
        <el-empty v-else description="暂无数据" :image-size="60" />
      </el-card>
    </el-col>
    <el-col :span="16">
      <el-card shadow="never">
        <template #header>舆情记录（近 24h）</template>
        <el-table :data="records" size="small" max-height="520">
          <el-table-column prop="headline" label="标题" min-width="240" />
          <el-table-column prop="source" label="来源" width="110" />
          <el-table-column label="分数" width="90"><template #default="{ row }"><span :class="row.score >= 0 ? 'up' : 'down'">{{ row.score.toFixed(2) }}</span></template></el-table-column>
          <el-table-column label="情绪" width="90"><template #default="{ row }"><el-tag :type="labelType(row.label)" size="small">{{ row.label }}</el-tag></template></el-table-column>
          <el-table-column label="时间" width="150"><template #default="{ row }">{{ new Date(row.createdAt).toLocaleString('zh-CN') }}</template></el-table-column>
        </el-table>
      </el-card>
    </el-col>
  </el-row>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api, type SentimentRecord } from '../api.ts';

const symbol = ref('BTCUSDT');
const scanning = ref(false);
const records = ref<SentimentRecord[]>([]);
const agg = ref<{ averageScore: number; label: string; count: number } | null>(null);

function labelType(label: string): 'success' | 'danger' | 'info' {
  return label === 'bullish' ? 'danger' : (label === 'bearish' ? 'success' : 'info');
}

async function scan() {
  scanning.value = true;
  try {
    const res = await api.post<{ scanned: number; stored: number; averageScore: number; label: string }>('/sentiment/scan', { symbol: symbol.value, useLLM: true });
    ElMessage.success('扫描 ' + res.scanned + ' 条，相关 ' + res.stored + ' 条，平均分 ' + res.averageScore);
    await load();
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    scanning.value = false;
  }
}

async function load() {
  records.value = (await api.get<{ latest: SentimentRecord[] }>('/sentiment/' + symbol.value)).latest ?? [];
  agg.value = await api.get<{ averageScore: number; label: string; count: number }>('/sentiment/' + symbol.value);
}
onMounted(load);
</script>

<style scoped>
.mt { margin-top: 16px; }
.up { color: #67c23a; }
.down { color: #f56c6c; }
</style>
