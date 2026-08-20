<template>
  <el-row :gutter="16">
    <el-col :span="8">
      <el-card shadow="never">
        <template #header>写日志</template>
        <el-form label-width="60px">
          <el-form-item label="类型">
            <el-select v-model="form.kind" style="width: 100%">
              <el-option value="trade" label="交易" /><el-option value="insight" label="心得" /><el-option value="review" label="复盘" /><el-option value="note" label="备忘" />
            </el-select>
          </el-form-item>
          <el-form-item label="标题"><el-input v-model="form.title" /></el-form-item>
          <el-form-item label="内容"><el-input type="textarea" :rows="5" v-model="form.body" /></el-form-item>
          <el-form-item label="标签"><el-input v-model="tagsText" placeholder="逗号分隔" /></el-form-item>
          <el-form-item><el-button type="primary" @click="save">保存</el-button></el-form-item>
        </el-form>
      </el-card>
    </el-col>
    <el-col :span="16">
      <el-card shadow="never">
        <template #header>日志列表</template>
        <el-timeline v-if="entries.length">
          <el-timeline-item v-for="e in entries" :key="e.id" :timestamp="new Date(e.createdAt).toLocaleString('zh-CN')">
            <el-card shadow="never" size="small">
              <div class="jtitle"><el-tag size="small" :type="kindType(e.kind)">{{ e.kind }}</el-tag>&nbsp;<b>{{ e.title }}</b></div>
              <div class="jbody">{{ e.body }}</div>
              <div class="jtags"><el-tag v-for="t in e.tags" :key="t" size="small" type="info" effect="plain">{{ t }}</el-tag></div>
            </el-card>
          </el-timeline-item>
        </el-timeline>
        <el-empty v-else description="暂无日志" />
      </el-card>
    </el-col>
  </el-row>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api, type JournalEntry } from '../api.ts';

const form = ref({ kind: 'note', title: '', body: '' });
const tagsText = ref('');
const entries = ref<JournalEntry[]>([]);

function kindType(k: string): 'success' | 'warning' | 'danger' | 'info' {
  return k === 'trade' ? 'success' : (k === 'review' ? 'danger' : (k === 'insight' ? 'warning' : 'info'));
}

async function save() {
  await api.post('/journal', {
    kind: form.value.kind, title: form.value.title, body: form.value.body,
    tags: tagsText.value.split(',').map((s) => s.trim()).filter(Boolean),
  });
  ElMessage.success('已保存');
  form.value = { kind: 'note', title: '', body: '' };
  tagsText.value = '';
  await load();
}

async function load() {
  entries.value = (await api.get<{ entries: JournalEntry[] }>('/journal?limit=50')).entries;
}
onMounted(load);
</script>

<style scoped>
.jtitle { font-size: 14px; }
.jbody { color: #666; font-size: 13px; margin: 6px 0; white-space: pre-wrap; }
.jtags { display: flex; gap: 6px; }
</style>
