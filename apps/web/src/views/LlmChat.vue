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
          if (!current) {
            current = { role: 'assistant', content: '' };
            messages.value.push(current);
          }
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
