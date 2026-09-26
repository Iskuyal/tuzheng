<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import SiteHeader from "../components/SiteHeader.vue";
import { queueLandingUpload } from "../upload-transfer.js";

interface SampleSummary {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
}

const router = useRouter();
const samples = ref<SampleSummary[]>([]);
const loadError = ref("");
const uploadError = ref("");

const samplePresentation: Record<string, { tone: string; kind: string }> = {
  conflict: { tone: "contradictory", kind: "图内矛盾" },
  consistent: { tone: "consistent", kind: "图内一致" },
  unclear: { tone: "needs-confirmation", kind: "需要确认" },
  "multi-claims": { tone: "grouped", kind: "多条主张" },
};

async function loadSamples(): Promise<void> {
  try {
    const response = await fetch("/api/samples");
    const payload = await response.json().catch(() => null) as { samples?: SampleSummary[] } | null;
    if (!response.ok || !payload?.samples) throw new Error("样例暂时无法载入。");
    samples.value = payload.samples;
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "样例暂时无法载入。";
  }
}

function openSample(id: string): void {
  void router.push({ name: "audit", query: { sample: id } });
}

function uploadScreenshot(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;

  if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(file.type)) {
    uploadError.value = "请上传 PNG、JPG 或 WebP 图片。";
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    uploadError.value = "图片不能超过 5 MB。";
    return;
  }

  uploadError.value = "";
  queueLandingUpload(file);
  void router.push({ name: "audit" });
}

function sampleTone(id: string): string {
  return samplePresentation[id]?.tone ?? "grouped";
}

function sampleKind(id: string): string {
  return samplePresentation[id]?.kind ?? "团队自制";
}

onMounted(loadSamples);
</script>

<template>
  <div class="landing-page">
    <SiteHeader />

    <main>
      <section class="landing-hero">
        <div class="hero-copy">
          <p class="hero-kicker">图表证据审计台</p>
          <h1>图表说的，<br /><span>和数字对得上吗？</span></h1>
          <p class="hero-description">对照标题与图中标注，检查图内关系是否相符。没有来源时不核验真实数据。</p>
          <div class="hero-actions">
            <label class="pixel-button primary-action primary-upload-action" for="landing-upload">
              上传我的截图 <span aria-hidden="true">↑</span>
              <input id="landing-upload" type="file" accept="image/png,image/jpeg,image/webp" @change="uploadScreenshot" />
            </label>
            <a class="pixel-button secondary-sample-action" href="#sample-dock">浏览四个自制样例 <span aria-hidden="true">↓</span></a>
          </div>
          <p class="upload-support-note">支持 PNG、JPG、WebP；单张不超过 5 MB。</p>
          <p v-if="uploadError" class="landing-error" role="alert">{{ uploadError }}</p>
          <div class="signal-strip" aria-label="审计顺序：截图、证据、计算">
            <span>截图</span><i></i><span>证据</span><i></i><span>计算</span>
          </div>
        </div>

        <div class="hero-scene" aria-label="图内矛盾示意：80 到 100 计算为 25%，标题写 40%">
          <div class="scene-topline">
            <span>图内审计 / 示意图</span>
            <span class="scene-live">示意预览</span>
          </div>
          <div class="scene-screen">
            <div class="scene-title-row">
              <span>年营业收入增长</span>
              <strong>40%</strong>
            </div>
            <div class="scene-chart">
              <div class="scene-axis-labels" aria-hidden="true"><span>120</span><span>80</span><span>40</span><span>0</span></div>
              <svg class="scene-chart-svg" viewBox="0 0 520 264" role="img" aria-label="2024 年 80 万元，2025 年 100 万元">
                <g class="scene-grid-lines">
                  <path d="M28 26H500M28 90H500M28 154H500M28 218H500" />
                </g>
                <g class="scene-bars" shape-rendering="crispEdges">
                  <rect x="116" y="90" width="102" height="128" />
                  <rect x="310" y="58" width="102" height="160" />
                </g>
                <g class="scene-chart-values">
                  <text x="167" y="76">80</text><text x="361" y="44">100</text>
                  <text x="167" y="250">2024</text><text x="361" y="250">2025</text>
                </g>
              </svg>
            </div>
            <div class="scene-verdict">
              <div class="scene-verdict-mark" aria-hidden="true"><span></span><span></span><span></span></div>
              <div><span>按图中数字计算</span><strong>增长 25%</strong></div>
              <span class="scene-flag">图内矛盾</span>
            </div>
          </div>
          <div class="scene-footline"><span>图内可核对</span><span>原始来源未提供</span></div>
        </div>
      </section>

      <section id="sample-dock" class="sample-section">
        <div class="section-title-row">
          <div>
            <p class="section-kicker">即开即用 / 团队自制</p>
            <h2>选一张图，看看证据怎么对</h2>
          </div>
          <span class="section-count">{{ String(samples.length).padStart(2, "0") }} 个样例</span>
        </div>

        <div v-if="loadError" class="landing-error" role="alert">{{ loadError }}</div>
        <div v-else class="sample-dock">
          <button
            v-for="(sample, index) in samples"
            :key="sample.id"
            class="sample-tile"
            :class="`tone-${sampleTone(sample.id)}`"
            @click="openSample(sample.id)"
          >
            <div class="sample-tile-top">
              <span class="sample-tile-index">{{ String(index + 1).padStart(2, "0") }}</span>
            <span class="sample-tile-kind">{{ sampleKind(sample.id) }}</span>
            </div>
            <div class="sample-thumb"><img :src="sample.imageUrl" :alt="sample.name" loading="lazy" /></div>
            <div class="sample-tile-bottom">
              <div><h3>{{ sample.name }}</h3><p>{{ sample.description }}</p></div>
              <span class="sample-open">使用此样例 <span aria-hidden="true">→</span></span>
            </div>
          </button>
        </div>
      </section>

      <footer class="landing-footer">
        <span>图证 / 单图图内审计</span>
        <RouterLink to="/audit?sample=conflict">试跑矛盾样例 <span aria-hidden="true">→</span></RouterLink>
      </footer>
    </main>
  </div>
</template>
