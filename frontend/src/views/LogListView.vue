<script setup lang="ts">
import { onMounted, ref } from 'vue';
import StatusBadge from '../components/StatusBadge.vue';
import { adminApi } from '../services/api';
import { formatLocalDateTime } from '../services/date-time';
import type { AdminUpdateLog } from '../types';

const logs = ref<AdminUpdateLog[]>([]);
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    logs.value = await adminApi.allLogs();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '載入 Logs 失敗';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div><p class="eyebrow">Operations</p><h1 class="page-title">更新 Logs</h1><p class="page-description">最近 100 筆 DDNS 更新事件；時間依目前瀏覽器所在時區顯示。</p></div>
    </header>
    <p v-if="error" class="notice" role="alert">{{ error }}</p>
    <section class="surface overflow-hidden">
      <div v-if="loading" class="empty-state text-slate-400">正在載入 Logs…</div>
      <div v-else-if="logs.length === 0" class="empty-state"><h2 class="text-lg font-semibold">尚無更新紀錄</h2><p class="mt-2 text-sm text-slate-400">Client 完成第一次更新後，事件會顯示在這裡。</p></div>
      <div v-else class="overflow-x-auto">
        <table class="data-table">
          <thead><tr><th>時間</th><th>Client</th><th>來源 IP</th><th>IP 變更</th><th>結果</th><th>錯誤碼</th></tr></thead>
          <tbody>
            <tr v-for="log in logs" :key="log.id">
              <td><time :datetime="log.createdAt">{{ formatLocalDateTime(log.createdAt) }}</time></td>
              <td><RouterLink class="font-semibold text-emerald-300 no-underline" :to="`/clients/${log.clientId}`">{{ log.clientDisplayName }}</RouterLink><div class="mt-1 text-xs text-slate-500">{{ log.clientSlug }}</div></td>
              <td class="font-mono">{{ log.sourceIp }}</td>
              <td class="font-mono">{{ log.oldIp ?? '—' }} → {{ log.newIp }}</td>
              <td><StatusBadge :value="log.status" /></td>
              <td class="font-mono text-xs">{{ log.errorCode ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
