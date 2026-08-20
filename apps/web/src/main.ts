import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import * as Icons from '@element-plus/icons-vue';
import App from './App.vue';
import { router } from './router.ts';

const app = createApp(App);
for (const [name, comp] of Object.entries(Icons)) {
  app.component(name, comp as never);
}
app.use(ElementPlus);
app.use(router);
app.mount('#app');
