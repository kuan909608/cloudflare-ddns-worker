<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import StatusBadge from '../components/StatusBadge.vue';
import TokenModal from '../components/TokenModal.vue';
import { adminApi } from '../services/api';
import { curlCommand, ddnsUpdateUrl, unifiSettings } from '../services/connection-details';
import { formatLocalDateTime } from '../services/date-time';
import type { Client, UpdateLog } from '../types';

const props = defineProps<{ id: string }>();
const router = useRouter();
const route = useRoute();
const client = ref<Client>();
const logs = ref<UpdateLog[]>([]);
const token = ref('');
const ddnsOrigin = ref('');
const unifiCompatibilityEnabled = ref(false);
const loading = ref(true);
const error = ref('');
const successMessage = ref(route.query.success === 'updated' ? 'Client 設定已更新' : '');
const operation = ref('');
const url = computed(() => client.value ? ddnsUpdateUrl(ddnsOrigin.value, client.value.slug) : '');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [loadedClient, loadedLogs, config] = await Promise.all([
      adminApi.client(props.id), adminApi.logs(props.id), adminApi.config(),
    ]);
    client.value = loadedClient;
    logs.value = loadedLogs;
    ddnsOrigin.value = config.ddnsOrigin;
    unifiCompatibilityEnabled.value = config.unifiCompatibilityEnabled;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '載入 Client 失敗';
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function toggle() {
  if (!client.value) return;
  if (client.value.enabled && !confirm('停用後此 Client 將無法更新 DNS。確定停用？')) return;
  const action = client.value.enabled ? '停用' : '啟用';
  operation.value = 'toggle'; error.value = ''; successMessage.value = '';
  try { client.value = await adminApi.action(props.id, client.value.enabled ? 'disable' : 'enable'); successMessage.value = `Client 已${action}`; }
  catch (cause) { error.value = cause instanceof Error ? cause.message : `${action}失敗`; }
  finally { operation.value = ''; }
}

async function rotate() {
  if (!confirm('舊 Token 將立即失效。確定輪替？')) return;
  operation.value = 'rotate'; error.value = ''; successMessage.value = '';
  try {
    const result = await adminApi.rotate(props.id);
    client.value = result.client;
    token.value = result.token;
    successMessage.value = 'Token 已輪替；請立即保存新 Token';
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Token 輪替失敗'; }
  finally { operation.value = ''; }
}

async function remove() {
  if (!confirm('將刪除此 Client 與更新紀錄，無法復原。確定？')) return;
  operation.value = 'remove'; error.value = ''; successMessage.value = '';
  try { await adminApi.remove(props.id); await router.push({path:'/clients',query:{success:'deleted'}}); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '刪除失敗'; operation.value = ''; }
}

async function copy(value: string) {
  error.value = ''; successMessage.value = '';
  try { await navigator.clipboard.writeText(value); successMessage.value = '設定已複製'; }
  catch { error.value = '無法複製，請手動選取內容'; }
}
</script>

<template>
  <div class="page">
    <div v-if="loading" class="surface empty-state text-slate-400">正在載入 Client…</div>
    <template v-else-if="client">
    <header class="page-header">
      <div>
        <p class="eyebrow">Client detail</p>
        <h1 class="page-title">{{ client.displayName }}</h1>
        <p class="page-description">{{ client.recordName }} · {{ client.recordType }} Record{{ client.recordPending ? '（等待第一次更新建立）' : '' }}</p>
      </div>
      <div class="action-group">
        <RouterLink class="btn-secondary" :to="`/clients/${id}/edit`">編輯</RouterLink>
        <button class="btn-secondary" :disabled="Boolean(operation)" @click="toggle">{{ operation === 'toggle' ? '處理中…' : client.enabled ? '停用' : '啟用' }}</button>
        <button class="btn-secondary" :disabled="Boolean(operation)" @click="rotate">{{ operation === 'rotate' ? '輪替中…' : '輪替 Token' }}</button>
        <button class="btn-danger" :disabled="Boolean(operation)" @click="remove">{{ operation === 'remove' ? '刪除中…' : '刪除' }}</button>
      </div>
    </header>
    <p v-if="error" class="notice" role="alert">{{ error }}</p>
    <p v-if="successMessage" class="notice notice--success" role="status">{{ successMessage }}</p>
    <div class="grid gap-4 lg:grid-cols-2">
      <section class="surface">
        <div class="surface-body space-y-4">
          <div><p class="eyebrow">Connection</p><h2 class="section-title mt-1">連線資訊</h2></div>
          <div class="field"><span class="label">DDNS URL</span><code class="code-block">{{ url }}</code></div>
          <div class="action-group">
            <button class="btn-secondary" @click="copy(url)">複製 URL</button>
            <button class="btn-secondary" @click="copy(curlCommand(ddnsOrigin, client.slug, '&lt;CLIENT_TOKEN&gt;'))">複製 curl</button>
            <button v-if="unifiCompatibilityEnabled" class="btn-secondary" @click="copy(unifiSettings(ddnsOrigin, client.slug, client.recordName, '&lt;CLIENT_TOKEN&gt;'))">複製 UniFi</button>
          </div>
          <p class="detail-note">Token 已設定 · 建立於 <time :datetime="client.tokenCreatedAt">{{ formatLocalDateTime(client.tokenCreatedAt) }}</time></p>
        </div>
      </section>
      <section class="surface">
        <div class="surface-body space-y-4">
          <div><p class="eyebrow">Cloudflare DNS</p><h2 class="section-title mt-1">綁定狀態</h2></div>
          <dl class="detail-list">
            <div><dt>Record</dt><dd>{{ client.recordName }} <span class="type-chip">{{ client.recordType }}</span></dd></div>
            <div><dt>目前 IP</dt><dd>{{ client.recordPending ? '等待第一次設備更新' : client.currentDnsIp ?? '—' }}</dd></div>
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
          <tbody><tr v-for="log in logs" :key="log.id"><td><time :datetime="log.createdAt">{{ formatLocalDateTime(log.createdAt) }}</time></td><td>{{ log.sourceIp }}</td><td>{{ log.oldIp ?? '—' }}</td><td>{{ log.newIp }}</td><td>{{ log.status }}</td></tr></tbody>
        </table>
      </div>
    </section>
    <TokenModal v-if="token" :token="token" :slug="client.slug" :ddns-origin="ddnsOrigin" :hostname="client.recordName" :unifi-compatibility-enabled="unifiCompatibilityEnabled" @close="token = ''" />
    </template>
    <p v-else class="notice" role="alert">{{ error || '找不到 Client' }} <button class="btn-secondary ml-3" @click="load">重新載入</button></p>
  </div>
</template>
