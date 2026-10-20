<template>
  <div class="data-center aw-page">
    <!-- 行情主视图（舆情已独立为 /sentiment 路由，行情↔舆情在 App 层 KeepAlive 互保状态） -->
    <Market class="dc-body" />
  </div>
</template>

<script setup lang="ts">
import Market from './Market.vue';
</script>

<style scoped>
.data-center { display: flex; flex-direction: column; gap: 12px; flex: 1; min-height: 0; }
.dc-body { min-height: 0; }
</style>
