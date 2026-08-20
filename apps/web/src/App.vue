<template>
  <el-container class="app">
    <el-aside width="200px" class="aside">
      <div class="logo">AgentWin</div>
      <el-menu :default-active="$route.path" router>
        <el-menu-item index="/"><el-icon><Odometer /></el-icon>总览</el-menu-item>
        <el-menu-item index="/market"><el-icon><TrendCharts /></el-icon>行情</el-menu-item>
        <el-menu-item index="/strategies"><el-icon><SetUp /></el-icon>策略与回测</el-menu-item>
        <el-menu-item index="/paper"><el-icon><Money /></el-icon>模拟交易</el-menu-item>
        <el-menu-item index="/trades"><el-icon><DataAnalysis /></el-icon>交易与盈亏</el-menu-item>
        <el-menu-item index="/llm"><el-icon><ChatDotRound /></el-icon>AI 策略顾问</el-menu-item>
        <el-menu-item index="/sentiment"><el-icon><DataLine /></el-icon>舆情</el-menu-item>
        <el-menu-item index="/journal"><el-icon><Notebook /></el-icon>交易日志</el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <span class="title">{{ $route.meta.title }}</span>
        <el-tag size="small" type="success" v-if="health?.ok">API 正常 · {{ health.storage }}</el-tag>
      </el-header>
      <el-main><router-view /></el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from './api.ts';

const health = ref<{ ok: boolean; storage: string } | null>(null);
onMounted(async () => {
  try { health.value = await api.get('/health'); } catch { health.value = null; }
});
</script>

<style>
html, body, #app { height: 100%; margin: 0; }
.app { height: 100%; }
.aside { background: #001529; }
.aside .logo { color: #fff; font-weight: 700; font-size: 18px; padding: 16px 20px; letter-spacing: 1px; }
.aside .el-menu { border-right: none; background: transparent; }
.aside .el-menu-item { color: #a6adb4; }
.aside .el-menu-item.is-active { background: #1677ff; color: #fff; }
.header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #eee; background: #fff; }
.header .title { font-size: 16px; font-weight: 600; }
</style>
