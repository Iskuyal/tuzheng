<template>
  <RouterView v-slot="{ Component }">
    <KeepAlive include="SourceAuditPage">
      <component :is="Component" />
    </KeepAlive>
  </RouterView>
</template>
