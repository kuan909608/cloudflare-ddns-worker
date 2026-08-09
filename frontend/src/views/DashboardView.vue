<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { adminApi } from '../services/api';
const stats = ref<Record<string,number>>({});
const loading = ref(true);
const cards:[string,string,string][] = [
  ['total','Client 總數','所有已建立的設備'], ['enabled','啟用中','可更新 DNS'], ['disabled','已停用','目前拒絕更新'],
  ['recentSuccess','24 小時成功','updated 與 unchanged'], ['recentFailure','24 小時失敗','需要檢查的事件'],
];
onMounted(async () => { try { stats.value = await adminApi.dashboard(); } finally { loading.value = false; } });
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div><p class="eyebrow">Operations</p><h1 class="page-title">DDNS 總覽</h1><p class="page-description">集中查看 Client 狀態與最近 24 小時的更新健康度。</p></div>
      <RouterLink class="btn-primary" to="/clients/new">新增 Client</RouterLink>
    </header>
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <article v-for="[key,label,detail] in cards" :key="key" class="surface stat-card">
        <p class="stat-label">{{ label }}</p><p class="stat-value">{{ loading ? '—' : stats[key] ?? 0 }}</p><p class="mt-1 text-xs text-slate-500">{{ detail }}</p>
      </article>
    </div>
  </div>
</template>
