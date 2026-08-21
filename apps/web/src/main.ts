import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import * as Icons from '@element-plus/icons-vue';
import App from './App.vue';
import { router } from './router.ts';

// 深色简约技术风格
document.documentElement.classList.add('dark');

const app = createApp(App);
for (const [name, comp] of Object.entries(Icons)) {
  app.component(name, comp as never);
}
app.use(ElementPlus);
app.use(router);
app.mount('#app');
