<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import TokenModal from '../components/TokenModal.vue';
import { adminApi } from '../services/api';
import { toClientInput } from '../services/client-input';
import type { ClientInput, CloudflareRecordOption, CloudflareZoneOption } from '../types';

const props = defineProps<{ id?: string }>();
const router = useRouter();
const form = reactive<ClientInput>({ displayName:'', slug:'', zoneId:'', zoneName:'', recordId:'', recordName:'', recordType:'A' });
const zones = ref<CloudflareZoneOption[]>([]);
const records = ref<CloudflareRecordOption[]>([]);
const error = ref('');
const token = ref('');
const ddnsOrigin = ref('');
const initializing = ref(true);
const loadingRecords = ref(false);
const saving = ref(false);

const filteredRecords = computed(() => records.value.filter((record) => record.type === form.recordType));
const selectedRecord = computed(() => records.value.find((record) => record.id === form.recordId));
const endpointPreview = computed(() => form.slug ? `${ddnsOrigin.value || 'https://ddns.example.com'}/api/ddns/${form.slug}` : '儲存後產生專屬更新 URL');

async function loadRecords(zoneId: string, reset = true) {
  if (reset) {
    form.recordId = '';
    form.recordName = '';
  }
  records.value = [];
  if (!zoneId) return;
  loadingRecords.value = true;
  try {
    records.value = await adminApi.records(zoneId);
  } finally {
    loadingRecords.value = false;
  }
}

async function onZoneChange() {
  const zone = zones.value.find((item) => item.id === form.zoneId);
  form.zoneName = zone?.name ?? '';
  await loadRecords(form.zoneId);
}

function selectRecordType(type: 'A' | 'AAAA') {
  if (form.recordType === type) return;
  form.recordType = type;
  form.recordId = '';
  form.recordName = '';
}

function onRecordChange() {
  const record = selectedRecord.value;
  form.recordName = record?.name ?? '';
  if (record) form.recordType = record.type;
}

onMounted(async () => {
  try {
    const [config, availableZones, existing] = await Promise.all([
      adminApi.config(),
      adminApi.zones(),
      props.id ? adminApi.client(props.id) : Promise.resolve(undefined),
    ]);
    ddnsOrigin.value = config.ddnsOrigin;
    zones.value = availableZones;
    if (existing) {
      Object.assign(form, toClientInput(existing));
      await loadRecords(form.zoneId, false);
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '';
    error.value = message && !['Internal server error', 'DNS update failed'].includes(message)
      ? message
      : '無法載入 Cloudflare Zones，請確認 API Token 具備 Zone / Zone / Read 權限。';
  } finally {
    initializing.value = false;
  }
});

async function submit() {
  error.value = '';
  saving.value = true;
  try {
    if (props.id) {
      await adminApi.update(props.id, form);
      await router.push(`/clients/${props.id}`);
    } else {
      const result = await adminApi.create(form);
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
        <p class="page-description">設定易讀名稱與固定 DNS 綁定。設備只能更新這筆 Record，無法在請求中指定其他目標。</p>
      </div>
      <RouterLink class="btn-secondary" to="/clients">返回 Clients</RouterLink>
    </header>

    <form class="grid gap-5" @submit.prevent="submit">
      <section class="surface">
        <div class="surface-body">
          <div class="section-heading">
            <span class="step-number">1</span>
            <div><h2 class="section-title">基本資訊</h2><p class="section-description">用容易辨識的名稱管理設備，Slug 會成為專屬更新 URL。</p></div>
          </div>
          <div class="form-grid">
            <label class="field">
              <span class="label">顯示名稱</span>
              <input v-model.trim="form.displayName" class="input" required maxlength="100" autocomplete="off" placeholder="例如：家用 UniFi Gateway">
              <span class="field-help">只顯示在管理頁，不會送到遠端設備。</span>
            </label>
            <label class="field">
              <span class="label">Client Slug</span>
              <input v-model.trim="form.slug" class="input" required maxlength="63" pattern="[a-z0-9][a-z0-9-]{1,62}" autocomplete="off" placeholder="例如：home-unifi">
              <span class="field-help">僅限小寫英數與連字號，建立後仍可編輯。</span>
            </label>
            <div class="field field--full">
              <span class="label">更新端點預覽</span>
              <div class="selection-summary"><div><strong class="break-all">{{ endpointPreview }}</strong><span>Token 會在建立成功後顯示一次</span></div><span class="type-chip">POST</span></div>
            </div>
          </div>
        </div>
      </section>

      <section class="surface">
        <div class="surface-body">
          <div class="section-heading">
            <span class="step-number">2</span>
            <div><h2 class="section-title">Cloudflare DNS 綁定</h2><p class="section-description">從 API Token 可存取的 Zone 與 Record 中選擇，不需要手動複製任何 ID。</p></div>
          </div>
          <div class="form-grid">
            <label class="field field--full">
              <span class="label">Zone</span>
              <select v-model="form.zoneId" class="input" required :disabled="initializing" @change="onZoneChange">
                <option value="" disabled>{{ initializing ? '正在讀取 Cloudflare Zones…' : '選擇 Zone' }}</option>
                <option v-for="zone in zones" :key="zone.id" :value="zone.id">{{ zone.name }}</option>
              </select>
              <span class="field-help">只會列出 API Token 有權讀取的 active zones。</span>
            </label>

            <div class="field">
              <span class="label">Record Type</span>
              <div class="segmented" role="group" aria-label="Record Type">
                <button v-for="type in (['A','AAAA'] as const)" :key="type" type="button" class="segment" :class="{'segment--active':form.recordType===type}" :aria-pressed="form.recordType===type" @click="selectRecordType(type)">{{ type }}</button>
              </div>
              <span class="field-help">A 使用 IPv4；AAAA 使用 IPv6。</span>
            </div>

            <label class="field">
              <span class="label">DNS Record</span>
              <select v-model="form.recordId" class="input" required :disabled="!form.zoneId || loadingRecords" @change="onRecordChange">
                <option value="" disabled>{{ loadingRecords ? '正在讀取 Records…' : form.zoneId ? `選擇 ${form.recordType} Record` : '請先選擇 Zone' }}</option>
                <option v-for="record in filteredRecords" :key="record.id" :value="record.id">{{ record.name }} · {{ record.content }}</option>
              </select>
              <span class="field-help">系統會在儲存前再次核對 Record ID、名稱與類型。</span>
            </label>

            <div v-if="selectedRecord" class="field field--full">
              <span class="label">即將綁定</span>
              <div class="selection-summary"><div><strong>{{ selectedRecord.name }}</strong><span>目前內容：{{ selectedRecord.content }}</span></div><span class="type-chip">{{ selectedRecord.type }}</span></div>
            </div>
          </div>
        </div>
      </section>

      <p v-if="error" class="notice" role="alert">{{ error }}</p>
      <div class="form-actions">
        <RouterLink class="btn-secondary" to="/clients">取消</RouterLink>
        <button class="btn-primary" :disabled="initializing || loadingRecords || saving || !form.recordId">
          {{ saving ? '正在驗證並儲存…' : props.id ? '儲存變更' : '建立並產生 Token' }}
        </button>
      </div>
    </form>

    <TokenModal v-if="token" :token="token" :slug="form.slug" :ddns-origin="ddnsOrigin" :hostname="form.recordName" @close="close" />
  </div>
</template>
