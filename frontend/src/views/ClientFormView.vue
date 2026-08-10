<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import TokenModal from '../components/TokenModal.vue';
import { adminApi } from '../services/api';
import { toClientInput } from '../services/client-input';
import type { ClientInput, CloudflareRecordOption } from '../types';

const props = defineProps<{ id?: string }>();
const router = useRouter();
const form = reactive({ displayName:'', slug:'', bindingMode:'existing' as 'existing'|'new', recordId:'', hostname:'', recordType:'A' as 'A'|'AAAA' });
const records = ref<CloudflareRecordOption[]>([]);
const error = ref('');
const token = ref('');
const ddnsOrigin = ref('');
const dnsZoneId = ref('');
const dnsZoneName = ref('');
const unifiCompatibilityEnabled = ref(false);
const initializing = ref(true);
const saving = ref(false);

const filteredRecords = computed(() => records.value.filter((record) => record.type === form.recordType));
const selectedRecord = computed(() => records.value.find((record) => record.id === form.recordId));
const endpointPreview = computed(() => form.slug ? `${ddnsOrigin.value || 'https://ddns.example.com'}/api/ddns/${form.slug}` : '儲存後產生專屬更新 URL');
const pendingRecordName = computed(() => form.hostname && dnsZoneName.value ? `${form.hostname}.${dnsZoneName.value}` : `hostname.${dnsZoneName.value || 'example.com'}`);
const modalHostname = computed(() => form.bindingMode === 'existing' ? selectedRecord.value?.name ?? '' : pendingRecordName.value);
const canSubmit = computed(() => form.displayName && form.slug && (form.bindingMode === 'existing' ? form.recordId : /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(form.hostname)));

function selectBindingMode(mode: 'existing'|'new') {
  if (props.id || form.bindingMode === mode) return;
  form.bindingMode = mode;
  form.recordId = '';
  form.hostname = '';
}

function selectRecordType(type: 'A'|'AAAA') {
  if (form.recordType === type) return;
  form.recordType = type;
  if (form.bindingMode === 'existing') form.recordId = '';
}

function payload(): ClientInput {
  const base = { displayName:form.displayName, slug:form.slug };
  return form.bindingMode === 'existing'
    ? { ...base, bindingMode:'existing', recordId:form.recordId }
    : { ...base, bindingMode:'new', hostname:form.hostname, recordType:form.recordType };
}

onMounted(async () => {
  try {
    const [config, availableRecords, existing] = await Promise.all([
      adminApi.config(), adminApi.records(), props.id ? adminApi.client(props.id) : Promise.resolve(undefined),
    ]);
    ddnsOrigin.value = config.ddnsOrigin;
    dnsZoneId.value = config.dnsZoneId;
    dnsZoneName.value = config.dnsZoneName;
    unifiCompatibilityEnabled.value = config.unifiCompatibilityEnabled;
    records.value = availableRecords;
    if (existing) {
      const input = toClientInput(existing);
      form.displayName = input.displayName;
      form.slug = input.slug;
      form.bindingMode = input.bindingMode;
      if (input.bindingMode === 'existing') {
        form.recordId = input.recordId;
        const record = records.value.find((value) => value.id === input.recordId);
        if (record) form.recordType = record.type;
      } else {
        form.hostname = input.hostname;
        form.recordType = input.recordType;
      }
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '';
    error.value = message && !['Internal server error', 'DNS update failed'].includes(message)
      ? message
      : '無法載入固定 DNS Zone，請確認 DNS_ZONE_ID 與 DNS API Token。';
  } finally {
    initializing.value = false;
  }
});

async function submit() {
  error.value = '';
  saving.value = true;
  try {
    if (props.id) {
      await adminApi.update(props.id, payload());
      await router.push({path:`/clients/${props.id}`,query:{success:'updated'}});
    } else {
      const result = await adminApi.create(payload());
      token.value = result.token;
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '儲存失敗';
  } finally {
    saving.value = false;
  }
}

function close() {
  token.value = '';
  void router.push('/clients');
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <p class="eyebrow">Client management</p>
        <h1 class="page-title">{{ props.id ? '編輯 Client' : '建立 DDNS Client' }}</h1>
        <p class="page-description">設備只持有自己的 Token；主機名與固定 Zone 由 Worker 控制，更新請求無法改變目標。</p>
      </div>
      <RouterLink class="btn-secondary" to="/clients">返回 Clients</RouterLink>
    </header>

    <form class="grid gap-5" @submit.prevent="submit">
      <section class="surface"><div class="surface-body">
        <div class="section-heading"><span class="step-number">1</span><div><h2 class="section-title">基本資訊</h2><p class="section-description">用容易辨識的名稱管理設備，裝置代號會成為專屬更新 URL。</p></div></div>
        <div class="form-grid">
          <label class="field"><span class="label">顯示名稱</span><input v-model.trim="form.displayName" class="input" required maxlength="100" autocomplete="off" placeholder="例如：家用 UniFi Gateway"><span class="field-help">只顯示在管理頁。</span></label>
          <label class="field"><span class="label">裝置代號</span><input v-model.trim="form.slug" class="input" required maxlength="63" pattern="[a-z0-9][a-z0-9-]{1,62}" autocomplete="off" placeholder="例如：home-unifi"><span class="field-help">僅限小寫英數與連字號。</span></label>
          <div class="field field--full"><span class="label">更新端點預覽</span><div class="selection-summary"><div><strong class="break-all">{{ endpointPreview }}</strong><span>Token 只在建立成功後顯示一次</span></div><span class="type-chip">POST</span></div></div>
        </div>
      </div></section>

      <section class="surface"><div class="surface-body">
        <div class="section-heading"><span class="step-number">2</span><div><h2 class="section-title">Cloudflare DNS</h2><p class="section-description">選擇現有 Record，或讓第一次合法 DDNS 更新建立新主機名。</p></div></div>
        <div class="form-grid">
          <div class="field field--full"><span class="label">固定 Zone</span><div class="selection-summary"><div><strong>{{ dnsZoneName || '正在讀取設定…' }}</strong><span class="break-all">{{ dnsZoneId }} · 由 Worker 固定，Client 無法變更</span></div><span class="type-chip">LOCKED</span></div></div>

          <div v-if="!props.id" class="field field--full">
            <span class="label">建立方式</span>
            <div class="segmented" role="group" aria-label="DNS Record 建立方式">
              <button type="button" class="segment" :class="{'segment--active':form.bindingMode==='existing'}" :aria-pressed="form.bindingMode==='existing'" @click="selectBindingMode('existing')">選擇既有 Record</button>
              <button type="button" class="segment" :class="{'segment--active':form.bindingMode==='new'}" :aria-pressed="form.bindingMode==='new'" @click="selectBindingMode('new')">建立新主機名</button>
            </div>
          </div>

          <div class="field"><span class="label">Record Type</span><div class="segmented" role="group" aria-label="Record Type"><button v-for="type in (['A','AAAA'] as const)" :key="type" type="button" class="segment" :class="{'segment--active':form.recordType===type}" :aria-pressed="form.recordType===type" @click="selectRecordType(type)">{{ type }}</button></div><span class="field-help">A 使用 IPv4；AAAA 使用 IPv6。</span></div>

          <label v-if="form.bindingMode==='existing'" class="field"><span class="label">DNS Record</span><select v-model="form.recordId" class="input" required :disabled="initializing"><option value="" disabled>{{ initializing ? '正在讀取 Records…' : `選擇 ${form.recordType} Record` }}</option><option v-for="record in filteredRecords" :key="record.id" :value="record.id">{{ record.name }} · {{ record.content }}</option></select><span class="field-help">瀏覽器只送 Record ID，名稱與類型由 Worker 向 Cloudflare 核對。</span></label>

          <label v-else class="field"><span class="label">新主機名</span><div class="hostname-input"><input v-model.trim="form.hostname" class="input" required maxlength="63" pattern="[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?" autocomplete="off" placeholder="例如：home"><span>.{{ dnsZoneName }}</span></div><span class="field-help">第一次通過 Token 驗證的更新會以來源 IP 建立此 Record。</span></label>

          <div v-if="selectedRecord && form.bindingMode==='existing'" class="field field--full"><span class="label">即將綁定</span><div class="selection-summary"><div><strong>{{ selectedRecord.name }}</strong><span>目前內容：{{ selectedRecord.content }}</span></div><span class="type-chip">{{ selectedRecord.type }}</span></div></div>
          <div v-if="form.bindingMode==='new'" class="field field--full"><span class="label">待建立 Record</span><div class="selection-summary"><div><strong>{{ pendingRecordName }}</strong><span>尚未建立；第一次設備更新完成後自動轉為固定 Record ID 綁定</span></div><span class="type-chip">PENDING</span></div></div>
        </div>
      </div></section>

      <p v-if="error" class="notice" role="alert">{{ error }}</p>
      <div class="form-actions"><RouterLink class="btn-secondary" to="/clients">取消</RouterLink><button class="btn-primary" :disabled="initializing || saving || !canSubmit">{{ saving ? '正在儲存…' : props.id ? '儲存變更' : '建立並產生 Token' }}</button></div>
    </form>

    <TokenModal v-if="token" :token="token" :slug="form.slug" :ddns-origin="ddnsOrigin" :hostname="modalHostname" :unifi-compatibility-enabled="unifiCompatibilityEnabled" @close="close" />
  </div>
</template>
