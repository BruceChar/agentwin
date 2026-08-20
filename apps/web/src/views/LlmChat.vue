<template>
  <el-card shadow="never" class="chat-card">
    <template #header>
      <div class="row">
        <span>AI 策略顾问（pi-ai · DeepSeek）</span>
        <el-button size="small" @click="reset">新会话</el-button>
      </div>
    </template>
    <div class="messages" ref="msgEl">
      <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.role">
        <div class="bubble">{{ m.content }}</div>
      </div>
      <div v-if="loading" class="msg user"><div class="bubble typing">思考中…</div></div>
    </div>
    <div class="input-row">
      <el-input v-model="input" placeholder="例如：帮我对 BTCUSDT 1小时级别用 RSI 策略做一次回测，看最近 90 天表现如何？" @keyup.enter="send" />
      <el-button type="primary" :loading="loading" @click="send">发送</el-button>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { api } from '../api.ts';

interface ChatMsg { role: 'user' | 'assistant'; content: string }
const messages = ref<ChatMsg[]>([]);
const input = ref('');
const loading = ref(false);
const msgEl = ref<HTMLDivElement | null>(null);
const sessionId = ref(localStorage.getItem('llm-session') ?? '');

async function send() {
  const text = input.value.trim();
  if (!text || loading.value) return;
  messages.value.push({ role: 'user', content: text });
  input.value = '';
  loading.value = true;
  scroll();
  try {
    const res = await api.post<{ reply: string; sessionId: string }>('/llm/chat', { message: text, sessionId: sessionId.value });
    sessionId.value = res.sessionId;
    localStorage.setItem('llm-session', res.sessionId);
    messages.value.push({ role: 'assistant', content: res.reply });
  } catch (e) {
    messages.value.push({ role: 'assistant', content: '调用失败：' + (e as Error).message + '（请确认 DEEPSEEK_API_KEY 已配置且后端已启动）' });
  } finally {
    loading.value = false;
    scroll();
  }
}

function reset() {
  sessionId.value = '';
  localStorage.removeItem('llm-session');
  messages.value = [];
}

function scroll() {
  nextTick(() => { if (msgEl.value) msgEl.value.scrollTop = msgEl.value.scrollHeight; });
}
onMounted(scroll);
</script>

<style scoped>
.chat-card { height: calc(100vh - 140px); display: flex; flex-direction: column; }
.messages { flex: 1; overflow-y: auto; padding: 8px; }
.msg { display: flex; margin-bottom: 12px; }
.msg.user { justify-content: flex-end; }
.bubble { max-width: 72%; padding: 10px 14px; border-radius: 8px; background: #f4f4f5; white-space: pre-wrap; font-size: 14px; line-height: 1.6; }
.msg.user .bubble { background: #1677ff; color: #fff; }
.typing { color: #999; }
.input-row { display: flex; gap: 8px; margin-top: 12px; }
.row { display: flex; justify-content: space-between; align-items: center; }
</style>
