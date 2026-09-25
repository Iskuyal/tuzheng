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
  <header class="topbar site-topbar" :class="{ 'menu-open': menuOpen }" @keydown.esc="closeMenuWithEscape">
    <RouterLink class="brand" to="/" aria-label="图证首页">
      <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      <span>图证<span class="brand-subtitle"> / 图表证据审计</span></span>
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
      <span class="menu-glyph" :class="{ open: menuOpen }" aria-hidden="true"><i></i><i></i><i></i></span>
    </button>
    <nav id="site-navigation" class="site-nav" :class="{ open: menuOpen }" aria-label="主导航">
      <RouterLink class="site-nav-link" active-class="active" exact-active-class="active" to="/" @click="closeMenu">首页</RouterLink>
      <RouterLink class="site-nav-link" active-class="active" to="/audit" @click="closeMenu">审计工作台</RouterLink>
      <RouterLink class="site-nav-link" active-class="active" to="/settings" @click="closeMenu">
        模型设置
      </RouterLink>
    </nav>
  </header>
</template>
