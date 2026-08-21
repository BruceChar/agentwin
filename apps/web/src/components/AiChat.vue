<!-- AI 策略顾问聊天（悬浮窗/抽屉/页面通用） -->
<template>
  <div class="chat">
    <div class="chat-head">
      <span>AI 策略顾问（pi-ai · DeepSeek）</span>
      <el-button size="small" text @click="reset">新会话</el-button>
    </div>
    <div class="messages" ref="msgEl">
      <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.role"><div class="bubble">{{ m.content }}</div></div>
      <div v-if="loading" class="msg user"><div class="bubble typing">思考中…</div></div>
    </div>
    <div class="input-row">
      <el-input v-model="input" placeholder="例如：帮我对 BTCUSDT 1小时 RSI 策略回测近 90 天" @keyup.enter="send" />
      <el-button type="primary" :loading="loading" @click="send">发送</el-button>
    </div>
  </div>
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
  const base = import.meta.env.VITE_API_BASE ?? '/api';
  try {
    const res = await fetch(base + '/llm/chat-stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: text, sessionId: sessionId.value }),
    });
    if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let current: ChatMsg | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        if (!frame.startsWith('data: ')) continue;
        const data = JSON.parse(frame.slice(6)) as Record<string, string>;
        if (data.type === 'session') {
          sessionId.value = data.sessionId;
          localStorage.setItem('llm-session', data.sessionId);
        } else if (data.type === 'delta' && data.delta) {
          if (!current) { current = { role: 'assistant', content: '' }; messages.value.push(current); }
          current.content += data.delta;
          scroll();
        } else if (data.type === 'done') {
          if (!current) messages.value.push({ role: 'assistant', content: '' });
          current = null;
        } else if (data.type === 'error') {
          messages.value.push({ role: 'assistant', content: '调用失败：' + (data.message ?? '未知错误') + '（请确认 DEEPSEEK_API_KEY 已配置且后端已启动）' });
        }
      }
    }
  } catch (e) {
    messages.value.push({ role: 'assistant', content: '调用失败：' + (e as Error).message });
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
.chat { display: flex; flex-direction: column; height: 100%; }
.chat-head { display: flex; justify-content: space-between; align-items: center; padding-bottom: 8px; border-bottom: 1px solid var(--border); font-size: 13px; }
.messages { flex: 1; overflow-y: auto; padding: 10px 2px; }
.msg { display: flex; margin-bottom: 12px; }
.msg.user { justify-content: flex-end; }
.bubble { max-width: 84%; padding: 10px 12px; border-radius: 8px; background: var(--bg-elev); white-space: pre-wrap; font-size: 13px; line-height: 1.6; color: var(--text); }
.msg.user .bubble { background: rgba(77,163,255,0.25); }
.typing { color: var(--text-dim); }
.input-row { display: flex; gap: 8px; margin-top: 10px; }
</style>
