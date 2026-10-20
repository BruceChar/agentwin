<template>
  <div class="data-center aw-page">
    <!-- 无主 Tab 栏：默认行情主视图；舆情由行情页右上角 icon 进入（KeepAlive 保留行情页状态） -->
    <Transition name="tab-switch" mode="out-in">
      <KeepAlive>
        <component
          :is="active === 'market' ? Market : Sentiment"
          class="dc-body"
          @open-sentiment="openSentiment"
        />
      </KeepAlive>
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

const active = ref<'market' | 'sentiment'>(route.query.tab === 'sentiment' ? 'sentiment' : 'market');

/** 行情页右上角舆情 icon：切入舆情视图（同步 query，刷新/分享保持） */
function openSentiment() {
  active.value = 'sentiment';
  router.replace({ query: { ...route.query, tab: 'sentiment' } });
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
.dc-body { min-height: 0; }
.tab-switch-enter-active, .tab-switch-leave-active { transition: opacity var(--aw-dur-fast) var(--aw-ease), transform 150ms var(--aw-ease); }
.tab-switch-enter-from { opacity: 0; transform: translateY(4px); }
.tab-switch-leave-to { opacity: 0; }
</style>
