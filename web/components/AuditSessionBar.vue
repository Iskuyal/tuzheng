<script setup lang="ts">
defineProps<{
  disabled: boolean;
  notice?: string;
}>();

defineEmits<{ reset: [] }>();
</script>

<template>
  <div class="audit-session">
    <div class="claim-audit-bar">
      <span>记录只保留在本次会话；刷新、切换图片或重置后清空。</span>
      <button class="reset-audit-button" type="button" :disabled="disabled" @click="$emit('reset')">
        重置本次审计
      </button>
    </div>
    <p v-if="notice" class="reset-notice" role="status">{{ notice }}</p>
  </div>
</template>
