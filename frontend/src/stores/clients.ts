import { defineStore } from 'pinia';
import { ref } from 'vue';
import { adminApi } from '../services/api';
import type { Client } from '../types';

export const useClientsStore = defineStore('clients',()=>{
  const clients=ref<Client[]>([]); const loading=ref(false); const error=ref('');
  async function load(){ loading.value=true; error.value=''; try{clients.value=await adminApi.clients();}catch(e){error.value=e instanceof Error?e.message:'載入失敗';}finally{loading.value=false;} }
  return {clients,loading,error,load};
});
