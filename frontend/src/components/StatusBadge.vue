<script setup lang="ts">defineProps<{value:string|boolean|null}>();</script>
<template><span class="rounded-full px-2 py-1 text-xs font-semibold" :class="value===true||value==='updated'||value==='unchanged'?'bg-emerald-950 text-emerald-300':'bg-slate-800 text-slate-300'">{{ value===true?'啟用':value===false?'停用':value??'尚無資料' }}</span></template>
