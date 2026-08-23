import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import * as Icons from '@element-plus/icons-vue';
import App from './App.vue';
import { router } from './router.ts';
import './styles/theme.css';

// 设计规范 v3.2：固定深色科技风
document.documentElement.classList.add('dark');

const app = createApp(App);
for (const [name, comp] of Object.entries(Icons)) {
  app.component(name, comp as never);
}
app.use(ElementPlus);
app.use(router);
app.mount('#app');
