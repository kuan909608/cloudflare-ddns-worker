<script setup lang="ts">
import { ref } from 'vue';
import { curlCommand, unifiSettings } from '../services/connection-details';

const props = defineProps<{ token: string; slug: string; ddnsOrigin: string; hostname?: string }>();
const emit = defineEmits<{ close: [] }>();
const copied = ref(false);

async function copy(value: string) {
  await navigator.clipboard.writeText(value);
  copied.value = true;
}

function unifi() {
  return unifiSettings(props.ddnsOrigin, props.slug, props.hostname ?? '<RECORD_NAME>', props.token);
}
</script>

<template>
  <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="token-title">
    <div class="surface token-dialog">
      <div class="surface-body">
        <p class="eyebrow">One-time secret</p>
        <h2 id="token-title" class="section-title mt-1">立即保存 Client Token</h2>
        <p class="notice my-4">關閉後無法再次取得明文；管理頁不會將 Token 寫入瀏覽器儲存空間。</p>
        <code class="code-block code-block--token">{{ token }}</code>
        <div class="action-group mt-5">
          <button class="btn-primary" @click="copy(token)">{{ copied ? '已複製' : '複製 Token' }}</button>
          <button class="btn-secondary" @click="copy(curlCommand(props.ddnsOrigin, props.slug, props.token))">複製 curl</button>
          <button class="btn-secondary" @click="copy(unifi())">複製 UniFi</button>
          <button class="btn-secondary" @click="emit('close')">我已安全保存</button>
        </div>
      </div>
    </div>
  </div>
</template>
