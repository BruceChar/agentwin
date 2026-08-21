import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import * as Icons from '@element-plus/icons-vue';
import App from './App.vue';
import { router } from './router.ts';

// 主题：默认深色，可切换浅色（设置里）
const savedTheme = localStorage.getItem('aw-theme');
if (savedTheme === 'light') document.documentElement.classList.remove('dark');
else document.documentElement.classList.add('dark');

const app = createApp(App);
for (const [name, comp] of Object.entries(Icons)) {
  app.component(name, comp as never);
}
app.use(ElementPlus);
app.use(router);
app.mount('#app');
