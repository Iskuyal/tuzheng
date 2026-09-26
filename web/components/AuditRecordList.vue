<script setup lang="ts">
import { auditStatusLabel, type ClaimAuditRow } from "../audit-record-rows.js";

defineProps<{ rows: ClaimAuditRow[] }>();
</script>

<template>
  <details class="claim-audit-log">
    <summary>
      <span>本次会话的审计记录</span>
      <span class="claim-audit-log-count">{{ rows.length }} 条</span>
    </summary>
    <ol class="claim-audit-log-list">
      <li v-for="row in rows" :key="row.id">
        <time>{{ row.time }}</time>
        <span class="claim-audit-action">{{ row.action }}</span>
        <span class="claim-audit-change">{{ row.detail }}</span>
        <span v-if="row.status" class="result-status" :class="row.status">{{ auditStatusLabel(row.status) }}</span>
        <span v-else class="claim-audit-cleared">{{ row.clearedLabel }}</span>
        <span v-if="row.wasLabel" class="claim-audit-was">（{{ row.wasLabel }}）</span>
      </li>
    </ol>
  </details>
</template>
