<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import StatusBadge from '../components/StatusBadge.vue';
import { formatLocalDateTime } from '../services/date-time';
import { useClientsStore } from '../stores/clients';
const store = useClientsStore();
const route = useRoute();
const successMessage = computed(() => route.query.success === 'deleted' ? 'Client 已刪除' : '');
onMounted(store.load);
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div><p class="eyebrow">Devices</p><h1 class="page-title">Clients</h1><p class="page-description">每個 Client 只持有自己的 Token，並固定綁定一筆 DNS Record。</p></div>
      <RouterLink v-if="!store.loading && store.clients.length > 0" class="btn-primary" to="/clients/new">新增 Client</RouterLink>
    </header>
    <p v-if="successMessage" class="notice notice--success" role="status">{{ successMessage }}</p>
    <p v-if="store.error" class="notice" role="alert">{{ store.error }}</p>
    <section class="surface overflow-hidden">
      <div v-if="store.loading" class="empty-state text-slate-400">正在載入 Clients…</div>
      <div v-else-if="store.clients.length === 0" class="empty-state">
        <h2 class="text-lg font-semibold">尚未建立 Client</h2><p class="mx-auto mt-2 max-w-md text-sm text-slate-400">建立第一個 Client，選擇 Cloudflare DNS Record 並產生專屬更新 Token。</p><RouterLink class="btn-primary mt-5" to="/clients/new">建立第一個 Client</RouterLink>
      </div>
      <div v-else class="overflow-x-auto">
        <table class="data-table">
          <thead><tr><th>Client</th><th>DNS Record</th><th>目前 IP</th><th>狀態</th><th>最後更新</th><th>來源 IP</th><th>結果</th></tr></thead>
          <tbody><tr v-for="client in store.clients" :key="client.id"><td><RouterLink class="font-semibold text-emerald-300 no-underline" :to="`/clients/${client.id}`">{{ client.displayName }}</RouterLink><div class="mt-1 text-xs text-slate-500">{{ client.slug }}</div></td><td>{{ client.recordName }}<div class="mt-1 text-xs text-slate-500">{{ client.recordType }}{{ client.recordPending ? ' · PENDING' : '' }}</div></td><td class="font-mono">{{ client.recordPending ? '待首次更新' : client.currentDnsIp ?? '—' }}</td><td><StatusBadge :value="client.enabled" /></td><td><time v-if="client.lastUpdatedAt" :datetime="client.lastUpdatedAt">{{ formatLocalDateTime(client.lastUpdatedAt) }}</time><span v-else>—</span></td><td class="font-mono">{{ client.lastSourceIp ?? '—' }}</td><td><StatusBadge :value="client.lastStatus" /></td></tr></tbody>
        </table>
      </div>
    </section>
  </div>
</template>
