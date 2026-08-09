<script setup lang="ts">
const navigation = [
  { label:'總覽', to:'/' },
  { label:'Clients', to:'/clients' },
];
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="app-header__inner">
        <RouterLink to="/" class="brand" aria-label="DDNS Gateway 首頁">
          <span class="brand-mark" aria-hidden="true"><span /></span>
          <span><strong>DDNS Gateway</strong><small>Cloudflare control plane</small></span>
        </RouterLink>
        <nav class="app-nav" aria-label="主要導覽">
          <RouterLink v-for="item in navigation" :key="item.to" class="nav-link" :to="item.to" exact-active-class="nav-link--active">
            {{ item.label }}
          </RouterLink>
        </nav>
      </div>
    </header>
    <main class="app-main">
      <RouterView v-slot="{ Component }">
        <Transition name="page-fade">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
  </div>
</template>
