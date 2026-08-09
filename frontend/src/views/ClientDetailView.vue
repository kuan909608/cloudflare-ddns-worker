<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import StatusBadge from '../components/StatusBadge.vue';
import TokenModal from '../components/TokenModal.vue';
import { adminApi } from '../services/api';
import { curlCommand, ddnsUpdateUrl, unifiSettings } from '../services/connection-details';
import type { Client, UpdateLog } from '../types';

const props = defineProps<{ id: string }>();
const router = useRouter();
const client = ref<Client>();
const logs = ref<UpdateLog[]>([]);
const token = ref('');
const ddnsOrigin = ref('');
const url = computed(() => client.value ? ddnsUpdateUrl(ddnsOrigin.value, client.value.slug) : '');

async function load() {
  const [loadedClient, loadedLogs, config] = await Promise.all([
    adminApi.client(props.id), adminApi.logs(props.id), adminApi.config(),
  ]);
  client.value = loadedClient;
  logs.value = loadedLogs;
  ddnsOrigin.value = config.ddnsOrigin;
}

onMounted(load);

async function toggle() {
  if (!client.value) return;
  if (client.value.enabled && !confirm('停用後此 Client 將無法更新 DNS。確定停用？')) return;
  client.value = await adminApi.action(props.id, client.value.enabled ? 'disable' : 'enable');
}

async function rotate() {
  if (!confirm('舊 Token 將立即失效。確定輪替？')) return;
  const result = await adminApi.rotate(props.id);
  client.value = result.client;
  token.value = result.token;
}

async function remove() {
  if (!confirm('將刪除此 Client 與更新紀錄，無法復原。確定？')) return;
  await adminApi.remove(props.id);
  await router.push('/clients');
}

async function copy(value: string) {
  await navigator.clipboard.writeText(value);
}
</script>

<template>
  <div v-if="client" class="page">
    <header class="page-header">
      <div>
        <p class="eyebrow">Client detail</p>
        <h1 class="page-title">{{ client.displayName }}</h1>
        <p class="page-description">{{ client.recordName }} · {{ client.recordType }} Record</p>
      </div>
      <div class="action-group">
        <RouterLink class="btn-secondary" :to="`/clients/${id}/edit`">編輯</RouterLink>
        <button class="btn-secondary" @click="toggle">{{ client.enabled ? '停用' : '啟用' }}</button>
        <button class="btn-secondary" @click="rotate">輪替 Token</button>
        <button class="btn-danger" @click="remove">刪除</button>
      </div>
    </header>
    <div class="grid gap-4 lg:grid-cols-2">
      <section class="surface">
        <div class="surface-body space-y-4">
          <div><p class="eyebrow">Connection</p><h2 class="section-title mt-1">連線資訊</h2></div>
          <div class="field"><span class="label">DDNS URL</span><code class="code-block">{{ url }}</code></div>
          <div class="action-group">
            <button class="btn-secondary" @click="copy(url)">複製 URL</button>
            <button class="btn-secondary" @click="copy(curlCommand(ddnsOrigin, client.slug, '&lt;CLIENT_TOKEN&gt;'))">複製 curl</button>
            <button class="btn-secondary" @click="copy(unifiSettings(ddnsOrigin, client.slug, client.recordName, '&lt;CLIENT_TOKEN&gt;'))">複製 UniFi</button>
          </div>
          <p class="detail-note">Token 已設定 · 建立於 {{ client.tokenCreatedAt }}</p>
        </div>
      </section>
      <section class="surface">
        <div class="surface-body space-y-4">
          <div><p class="eyebrow">Cloudflare DNS</p><h2 class="section-title mt-1">綁定狀態</h2></div>
          <dl class="detail-list">
            <div><dt>Record</dt><dd>{{ client.recordName }} <span class="type-chip">{{ client.recordType }}</span></dd></div>
            <div><dt>目前 IP</dt><dd>{{ client.currentDnsIp ?? '—' }}</dd></div>
            <div><dt>最後來源 IP</dt><dd>{{ client.lastSourceIp ?? '—' }}</dd></div>
            <div><dt>狀態</dt><dd class="flex flex-wrap gap-2"><StatusBadge :value="client.enabled" /><StatusBadge :value="client.lastStatus" /></dd></div>
          </dl>
        </div>
      </section>
    </div>
    <section class="surface overflow-hidden">
      <div class="surface-body pb-3"><p class="eyebrow">Activity</p><h2 class="section-title mt-1">最近更新紀錄</h2></div>
      <div class="overflow-x-auto">
        <table class="data-table">
          <thead><tr><th>時間</th><th>來源</th><th>舊 IP</th><th>新 IP</th><th>結果</th></tr></thead>
          <tbody><tr v-for="log in logs" :key="log.id"><td>{{ log.createdAt }}</td><td>{{ log.sourceIp }}</td><td>{{ log.oldIp ?? '—' }}</td><td>{{ log.newIp }}</td><td>{{ log.status }}</td></tr></tbody>
        </table>
      </div>
    </section>
    <TokenModal v-if="token" :token="token" :slug="client.slug" :ddns-origin="ddnsOrigin" :hostname="client.recordName" @close="token = ''" />
  </div>
</template>
