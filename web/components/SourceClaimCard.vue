<script setup lang="ts">
import { computed } from "vue";
import {
  BASIS_LABELS,
  CLAIM_KIND_LABELS,
  CLAIM_PART_STATUS_LABELS,
  CLAIM_STATUS_LABELS,
  type ClaimSourceConclusion,
  type ClaimSourceStatus,
  type ModelCitation,
  type SourceClaim,
  type SourceHit,
} from "../../shared/source-audit.js";

const props = defineProps<{
  claim: SourceClaim;
  conclusion: ClaimSourceConclusion | null;
  hits: SourceHit[];
  acceptedCitations: ModelCitation[];
}>();

const kindLabel = computed(() => CLAIM_KIND_LABELS[props.claim.kind] ?? props.claim.kind);

const statusLabel = computed(() => (props.conclusion ? CLAIM_STATUS_LABELS[props.conclusion.status] : ""));

function statusClass(status: ClaimSourceStatus): string {
  return status === "source-match" ? "source-state-ok"
    : status === "source-mismatch" ? "source-state-conflict"
      : status === "not-verifiable" ? "source-state-out-of-scope"
        : "source-state-pending";
}

const stateClass = computed(() => (props.conclusion ? statusClass(props.conclusion.status) : "source-state-pending"));

function basisText(basis: SourceClaim["basis"]): string {
  if (basis) return BASIS_LABELS[basis];
  return props.claim.fromImage ? "图上未写比较方式" : "未说明比较方式";
}

const citedDocuments = computed(() => (props.conclusion?.citedSourceIds ?? []).map((sourceId) => {
  const citation = props.acceptedCitations.find((entry) => entry.sourceId === sourceId);
  return {
    sourceId,
    title: props.hits.find((hit) => hit.document.id === sourceId)?.document.title ?? sourceId,
    note: citation?.note ?? "",
    roleLabel: citation?.role === "value-basis" ? "用作数值依据"
      : citation?.role === "term-explanation" ? "只用于解释术语"
        : citation?.role === "context" ? "仅作背景" : "",
  };
}));

const origin = computed(() => props.conclusion?.origin ?? null);

/** 只展示能复查的原文片段；覆盖率不足时说明为什么不能追溯。 */
const originText = computed(() => {
  const trace = origin.value;
  if (!trace) return "";
  if (!trace.traceable) return trace.note ?? "这条主张与出处的原文对不上。";
  return trace.fromImage
    ? `图上抄录「${trace.originText ?? ""}」`
    : `配文原文「${trace.matchedRun || trace.originText || ""}」`;
});

const coverageText = computed(() => {
  const trace = origin.value;
  if (!trace || trace.coverage >= 1) return "";
  return `与出处文字重合 ${Math.round(trace.coverage * 100)}%`;
});
</script>

<template>
  <article class="source-claim-card">
    <p class="source-claim-text">「{{ claim.claimText }}」</p>
    <div class="source-claim-tags">
      <span class="source-kind-chip">{{ kindLabel }}</span>
      <span v-if="conclusion" class="source-state-pill" :class="stateClass" data-testid="claim-source-status">
        {{ statusLabel }}
      </span>
    </div>

    <details class="source-claim-details">
      <summary>展开依据、推断缺口与未解决项</summary>

      <dl class="source-claim-meta">
        <div><dt>指标</dt><dd>{{ claim.metric ?? (claim.fromImage ? "图上没写" : "未说明") }}</dd></div>
        <div><dt>范围</dt><dd>{{ claim.scope ?? (claim.fromImage ? "图上没写" : "未说明") }}</dd></div>
        <div><dt>月份</dt><dd>{{ claim.period ?? (claim.fromImage ? "图上没写" : "未说明") }}</dd></div>
        <div><dt>数值</dt><dd>{{ claim.value ?? (claim.fromImage ? "图上没读清" : "未说明") }}</dd></div>
        <div><dt>比较方式</dt><dd>{{ basisText(claim.basis) }}</dd></div>
        <div v-if="claim.direction"><dt>断言方向</dt><dd>{{ claim.direction === "up" ? "上涨" : "下降" }}</dd></div>
        <div v-if="claim.fromImage && claim.imageExcerpt"><dt>图上抄录</dt><dd>「{{ claim.imageExcerpt }}」</dd></div>
      </dl>

      <p v-if="origin" class="source-claim-origin" data-testid="claim-origin">
        原文核对：{{ originText }}
        <span v-if="coverageText" class="source-claim-coverage">（{{ coverageText }}）</span>
      </p>
      <p v-if="conclusion?.periodNote" class="source-period-note">口径补全：{{ conclusion.periodNote }}</p>

      <div v-if="conclusion" class="source-conclusion" :class="stateClass">
        <p class="source-conclusion-summary">{{ conclusion.summary }}</p>
        <div v-if="conclusion.revisionReview" class="source-revision-review" data-testid="revision-review">
          <strong>版本复查：</strong>
          所引《<a :href="conclusion.revisionReview.fromUrl" target="_blank" rel="noreferrer noopener">{{ conclusion.revisionReview.fromTitle }}</a>》
          （{{ conclusion.revisionReview.fromPublishedAt }}）记载 {{ conclusion.revisionReview.fromValue }}%，
          已被《<a :href="conclusion.revisionReview.toUrl" target="_blank" rel="noreferrer noopener">{{ conclusion.revisionReview.toTitle }}</a>》
          （{{ conclusion.revisionReview.toPublishedAt }}）按官方修订声明修订为
          <strong>{{ conclusion.revisionReview.toValue }}%</strong>，本条按修订后值对照。
          <span class="source-revision-statement">修订声明原文：「{{ conclusion.revisionReview.statement }}」</span>
        </div>
        <ul v-if="conclusion.parts.length" class="source-part-list" data-testid="claim-parts">
          <li v-for="part in conclusion.parts" :key="part.label" :class="`part-${part.status}`">
            <strong>{{ part.label }} · {{ CLAIM_PART_STATUS_LABELS[part.status] }}</strong>：{{ part.detail }}
          </li>
        </ul>
        <ul v-if="conclusion.reasons.length" class="source-reason-list">
          <li v-for="reason in conclusion.reasons" :key="reason">{{ reason }}</li>
        </ul>
        <ul v-if="citedDocuments.length" class="source-cited-list">
          <li v-for="entry in citedDocuments" :key="entry.sourceId">
            引用：{{ entry.title }}
            <span v-if="entry.roleLabel" class="source-cited-note">（{{ entry.roleLabel }}<template v-if="entry.note">：{{ entry.note }}</template>）</span>
          </li>
        </ul>
        <ul v-if="conclusion.unresolved.length" class="source-unresolved-list">
          <li v-for="item in conclusion.unresolved" :key="item">未解决：{{ item }}</li>
        </ul>
      </div>
    </details>
  </article>
</template>
