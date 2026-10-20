<template>
  <div class="data-center aw-page">
    <!-- 行情主视图（舆情已独立为 /sentiment 路由，行情↔舆情在 App 层 KeepAlive 互保状态） -->
    <Market class="dc-body" />
  </div>
</template>

<script setup lang="ts">
import Market from './Market.vue';

// 显式声明组件名：App 层 KeepAlive `:include="['DataCenter','Sentiment']"` 依赖该名字做缓存匹配，
// 仅靠 SFC 文件名推导在某些构建缓存场景下可能失效，导致切回时整页重建、行情状态（tab/缩放/数据）被重置
defineOptions({ name: 'DataCenter' });
</script>

<style scoped>
.data-center { display: flex; flex-direction: column; gap: 12px; flex: 1; min-height: 0; }
.dc-body { min-height: 0; }
</style>
