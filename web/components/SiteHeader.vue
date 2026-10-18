<script setup lang="ts">
import { ref } from "vue";

const menuOpen = ref(false);
const menuButton = ref<HTMLButtonElement | null>(null);

function closeMenu(): void {
  menuOpen.value = false;
}

function closeMenuWithEscape(): void {
  if (!menuOpen.value) return;
  closeMenu();
  menuButton.value?.focus();
}
</script>

<template>
  <header class="topbar site-topbar room-header" :class="{ 'menu-open': menuOpen }" @keydown.esc="closeMenuWithEscape">
    <RouterLink class="brand" to="/" aria-label="图证首页">
      <svg class="room-brand-mark" viewBox="0 0 36 36" aria-hidden="true"><path d="M2 10V2h8M26 2h8v8M34 26v8h-8M10 34H2v-8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 25V17m8 8V10m8 15V5" stroke="currentColor" stroke-width="3"/><circle cx="29" cy="29" r="4" fill="#ae4634"/></svg>
      <span>图证<span class="brand-subtitle">让结论有据可查</span></span>
    </RouterLink>
    <button
      ref="menuButton"
      class="mobile-menu-button"
      type="button"
      :aria-expanded="menuOpen"
      aria-controls="site-navigation"
      :aria-label="menuOpen ? '关闭导航菜单' : '打开导航菜单'"
      @click="menuOpen = !menuOpen"
    >
      <span>菜单</span><span class="menu-glyph" :class="{ open: menuOpen }" aria-hidden="true"><i></i><i></i><i></i></span>
    </button>
    <nav id="site-navigation" class="site-nav" :class="{ open: menuOpen }" aria-label="主导航">
      <RouterLink class="site-nav-link" active-class="active" exact-active-class="active" to="/" @click="closeMenu">首页</RouterLink>
      <RouterLink class="site-nav-link" active-class="active" to="/audit" @click="closeMenu">审计工作台</RouterLink>
      <RouterLink class="site-nav-link" active-class="active" to="/source-audit" @click="closeMenu">来源核验</RouterLink>
      <RouterLink class="site-nav-link" active-class="active" to="/settings" @click="closeMenu">
        模型设置
      </RouterLink>
    </nav>
  </header>
</template>
