<template>
  <div class="data-center aw-page">
    <!-- 页面内 Tab：行情 / 舆情 -->
    <div class="dc-tabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="dc-tab"
        :class="{ active: active === t.key }"
        @click="switchTab(t.key)"
      >
        <span class="dc-dot" :style="{ background: t.color }"></span>
        <span>{{ t.label }}</span>
      </button>
    </div>

    <Transition name="tab-switch" mode="out-in">
      <div :key="active" class="dc-body">
        <Market v-if="active === 'market'" />
        <Sentiment v-else />
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Market from './Market.vue';
import Sentiment from './Sentiment.vue';

const route = useRoute();
const router = useRouter();

type TabKey = 'market' | 'sentiment';
const tabs: { key: TabKey; label: string; color: string }[] = [
  { key: 'market', label: '行情', color: '#06B6D4' },
  { key: 'sentiment', label: '舆情', color: '#10B981' },
];

const active = ref<TabKey>(route.query.tab === 'sentiment' ? 'sentiment' : 'market');

function switchTab(key: TabKey) {
  active.value = key;
  router.replace({ query: { ...route.query, tab: key } });
}

watch(
  () => route.query.tab,
  (v) => {
    if (v === 'sentiment' || v === 'market') active.value = v;
  },
);

</script>

<style scoped>
.data-center { display: flex; flex-direction: column; gap: 12px; }
.dc-tabs { display: flex; gap: 6px; }
.dc-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: 8px; border: 1px solid var(--aw-border);
  background: var(--aw-bg-card); color: var(--aw-text-dim); font-size: 13px; cursor: pointer;
  transition: all var(--aw-dur-fast) var(--aw-ease);
}
.dc-tab:hover { border-color: var(--aw-border-hover); color: var(--aw-text-body); }
.dc-tab.active { color: var(--aw-accent); border-color: rgba(6,182,212,0.4); background: var(--aw-accent-dim); }
.dc-dot { width: 6px; height: 6px; border-radius: 50%; }
.dc-body { min-height: 0; }
.tab-switch-enter-active, .tab-switch-leave-active { transition: opacity var(--aw-dur-fast) var(--aw-ease), transform 150ms var(--aw-ease); }
.tab-switch-enter-from { opacity: 0; transform: translateY(4px); }
.tab-switch-leave-to { opacity: 0; }
</style>
