<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import SiteHeader from "../components/SiteHeader.vue";
import { useRoute } from "vue-router";
const route = useRoute();
const sourceReturn = computed(() => {
  const path = typeof route.query.returnTo === "string" ? route.query.returnTo : "";
  return path === "/source-audit" || path.startsWith("/source-audit?") ? path : null;
});
import type { ModelProvider } from "../../shared/model-providers.js";
import { presetsFor, type ModelPreset } from "../../shared/model-presets.js";

interface PublicProviderConfig {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
}

interface PublicModelSettings {
  activeProvider: ModelProvider;
  providers: Record<ModelProvider, PublicProviderConfig>;
}

const PROVIDER_META: Record<ModelProvider, {
  label: string;
  badge: string;
  baseUrlLabel: string;
  defaultBaseUrl: string;
  defaultModel: string;
  baseUrlHint: string;
  modelHint: string;
  structuredOutputLabel: string;
}> = {
  "openai-responses": {
    label: "OpenAI Responses 兼容",
    badge: "OpenAI Responses 兼容协议",
    baseUrlLabel: "Responses API Base URL",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
    baseUrlHint: "只填服务根地址（如 https://api.openai.com/v1），不要粘贴 `/chat/completions` 或 `/responses` 的完整接口地址；服务端会自行调用 `/responses`。远程服务需用 HTTPS，本机回环地址可用 HTTP。",
    modelHint: "需支持图片输入与 JSON Schema 输出；当前模型名只是可替换的候选示例。",
    structuredOutputLabel: "Responses 结构化输出",
  },
  anthropic: {
    label: "Anthropic Messages 兼容",
    badge: "Anthropic Messages 兼容协议",
    baseUrlLabel: "Anthropic Messages Base URL",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-6",
    baseUrlHint: "只填服务根地址（如 https://api.anthropic.com/v1），不要粘贴 `/messages` 的完整接口地址；服务端会自行调用 `/messages`。兼容网关填到相同的版本段。远程服务需用 HTTPS，本机回环地址可用 HTTP。",
    modelHint: "需支持图片输入与工具调用；当前模型名只是可替换的候选示例。",
    structuredOutputLabel: "Messages 工具调用结构化输出",
  },
};

function defaultPublicSettings(): PublicModelSettings {
  return {
    activeProvider: "openai-responses",
    providers: {
      "openai-responses": {
        baseUrl: PROVIDER_META["openai-responses"].defaultBaseUrl,
        model: PROVIDER_META["openai-responses"].defaultModel,
        hasApiKey: false,
      },
      anthropic: {
        baseUrl: PROVIDER_META.anthropic.defaultBaseUrl,
        model: PROVIDER_META.anthropic.defaultModel,
        hasApiKey: false,
      },
    },
  };
}

const settings = ref<PublicModelSettings>(defaultPublicSettings());
const configuration = ref<{ source: "file" | "env"; readOnly: boolean } | null>(null);
const formLocked = computed(() => loading.value || configuration.value === null || configuration.value.readOnly);
const selectedProvider = ref<ModelProvider>("openai-responses");
const apiKey = ref("");
const clearApiKey = ref(false);
const loading = ref(false);
const saving = ref(false);
const testingConnection = ref(false);
const errorMessage = ref("");
const successMessage = ref("");
const connectionStatus = ref<"success" | "error" | null>(null);
const connectionMessage = ref("");

const providerMeta = computed(() => PROVIDER_META[selectedProvider.value]);
const activeDraft = computed(() => settings.value.providers[selectedProvider.value]);
const credentialState = computed(() => activeDraft.value.hasApiKey
  ? configuration.value?.source === "env" ? "服务端环境已配置" : "已保存到本机"
  : "尚未配置");
const providerPresets = computed(() => presetsFor(selectedProvider.value));
const testedPresets = computed(() => providerPresets.value.filter((preset) => preset.verification === "live"));
const documentedPresets = computed(() => providerPresets.value.filter((preset) => preset.verification === "documented"));
const presetHint = ref("");

function applyPreset(event: Event): void {
  const select = event.target as HTMLSelectElement;
  const preset: ModelPreset | undefined = providerPresets.value.find((item) => item.id === select.value);
  select.value = "";
  if (!preset) return;
  activeDraft.value.baseUrl = preset.baseUrl;
  activeDraft.value.model = preset.model;
  presetHint.value = `已填入${preset.label}（${preset.verification === "live" ? "历史实测，不代表当前配置通过" : "文档预设，未完成在线验收"}）：${preset.note}`;
}

function currentFormSettings() {
  return {
    provider: selectedProvider.value,
    baseUrl: activeDraft.value.baseUrl,
    model: activeDraft.value.model,
    apiKey: apiKey.value,
    clearApiKey: clearApiKey.value,
  };
}

function resetKeyDraft(): void {
  apiKey.value = "";
  clearApiKey.value = false;
  presetHint.value = "";
}

watch([
  selectedProvider,
  () => activeDraft.value.baseUrl,
  () => activeDraft.value.model,
  apiKey,
  clearApiKey,
], () => {
  connectionStatus.value = null;
  connectionMessage.value = "";
});

async function loadSettings(): Promise<void> {
  loading.value = true;
  errorMessage.value = "";
  try {
    const response = await fetch("/api/settings");
    const payload = await response.json().catch(() => null) as {
      settings?: PublicModelSettings;
      configuration?: { source: "file" | "env"; readOnly: boolean };
      error?: { message?: string };
    } | null;
    if (payload?.configuration) configuration.value = payload.configuration;
    if (!response.ok || !payload?.settings) {
      throw new Error(payload?.error?.message ?? "本机设置暂时无法读取。");
    }
    settings.value = payload.settings;
    configuration.value = payload.configuration ?? { source: "file", readOnly: false };
    selectedProvider.value = payload.settings.activeProvider;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "本机设置暂时无法读取。";
  } finally {
    loading.value = false;
  }
}

async function saveSettings(): Promise<void> {
  if (formLocked.value) return;
  saving.value = true;
  errorMessage.value = "";
  successMessage.value = "";
  connectionStatus.value = null;
  connectionMessage.value = "";
  try {
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(currentFormSettings()),
    });
    const payload = await response.json().catch(() => null) as {
      settings?: PublicModelSettings;
      error?: { message?: string };
    } | null;
    if (!response.ok || !payload?.settings) {
      throw new Error(payload?.error?.message ?? `设置保存失败（${response.status}）。`);
    }
    settings.value = payload.settings;
    selectedProvider.value = payload.settings.activeProvider;
    apiKey.value = "";
    clearApiKey.value = false;
    successMessage.value = activeDraft.value.hasApiKey
      ? "设置已保存到本机，可以返回审计台上传图片。"
      : "连接参数已保存；填写 API Key 后才能实时读取。";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "设置保存失败，请重试。";
  } finally {
    saving.value = false;
  }
}

async function testConnection(): Promise<void> {
  if (testingConnection.value || saving.value || loading.value || configuration.value === null || (configuration.value.readOnly && !activeDraft.value.hasApiKey)) return;
  testingConnection.value = true;
  errorMessage.value = "";
  successMessage.value = "";
  connectionStatus.value = null;
  connectionMessage.value = "";
  try {
    const response = await fetch("/api/settings/test-connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(configuration.value.readOnly ? {} : currentFormSettings()),
    });
    const payload = await response.json().catch(() => null) as {
      connection?: { model: string; latencyMs: number };
      error?: { message?: string };
    } | null;
    if (!response.ok || !payload?.connection) {
      throw new Error(payload?.error?.message ?? `连接测试失败（${response.status}）。`);
    }
    connectionStatus.value = "success";
    connectionMessage.value = `连接成功：${payload.connection.model}，耗时 ${Math.round(payload.connection.latencyMs)} 毫秒。已验证${providerMeta.value.structuredOutputLabel}；图片识别仍需上传样例核验。`;
  } catch (error) {
    connectionStatus.value = "error";
    connectionMessage.value = error instanceof Error ? error.message : "连接测试失败，请重试。";
  } finally {
    testingConnection.value = false;
  }
}

function requestKeyRemoval(): void {
  apiKey.value = "";
  clearApiKey.value = true;
  successMessage.value = "保存后会清除本机保存的 API Key。";
}

onMounted(loadSettings);
</script>

<template>
  <div class="settings-page evidence-room">
    <SiteHeader />

    <main class="settings-shell room-settings">
      <RouterLink v-if="sourceReturn" class="room-return-link" :to="sourceReturn">← 返回来源核验材料</RouterLink>
      <section class="settings-intro">
        <div>
          <p class="section-kicker"><RouterLink to="/">开始</RouterLink> / 模型设置</p>
          <h1>模型设置</h1>
          <p class="settings-lede">支持 OpenAI Responses 兼容或 Anthropic Messages 协议。默认在本机保存两种协议的配置；显式启用服务端环境配置时，本页显示当前配置并锁定编辑。</p>
        </div>
      </section>

      <div class="settings-layout">
        <aside class="settings-rail">
          <p class="section-kicker">连接说明</p>
          <h2>密钥留在本机，<br />图片按需发送。</h2>
          <ul class="settings-notes">
            <li><strong>所配模型必须支持图片输入（多模态）。</strong>应用要靠模型读图；预设只收录支持图片输入的型号，手填时请自行确认型号的输入模态。</li>
            <li>{{ configuration?.source === 'env' ? '当前配置由服务端环境变量完整提供，密钥仅在服务端内存使用。' : '浏览器提交后，由本机 Node 服务端写入当前 Windows 用户的 LocalAppData。' }}</li>
            <li>读取设置时只返回“已配置”状态，不会把 API Key 回显给页面。</li>
            <li>审计图片由服务端发送到你配置的模型服务。</li>
            <li>{{ configuration?.source === 'env' ? '修改环境配置后需重启服务；应用不会将环境密钥写入设置文件。' : '设置文件按本机用户账户权限保存；同一 Windows 账户下的进程也可读取它。' }}</li>
          </ul>
          <div class="settings-protocol"><span class="protocol-led"></span>{{ providerMeta.badge }}</div>
        </aside>

        <section class="settings-form-panel" aria-labelledby="settings-form-title">
            <div class="settings-panel-heading">
            <div class="settings-panel-heading-row">
              <h2 id="settings-form-title">连接参数</h2>
              <span class="settings-credential-status" :class="{ configured: activeDraft.hasApiKey }" aria-live="polite">密钥：{{ credentialState }}</span>
            </div>
            <div class="settings-security-note" role="note">
              <strong>密钥安全</strong>
              <span>{{ configuration?.source === 'env' ? '服务端环境密钥仅在内存使用，不写入设置文件，页面不回显。' : '本机保存；同账户程序可读，页面不回显。' }}</span>
            </div>
            <p class="settings-source" role="status">配置来源：{{ configuration ? (configuration.source === 'env' ? '服务端环境（env） · 只读' : '本机文件（file） · 可编辑') : '尚未读取' }}</p>
            <p v-if="configuration?.readOnly" class="settings-test-note">请修改服务端环境变量并重启服务。连接测试只使用当前环境配置。</p>
          </div>



          <form v-if="!(configuration?.readOnly && !activeDraft.hasApiKey)" class="settings-form" @submit.prevent="saveSettings">
            <label class="settings-field">
              <span>接口协议</span>
              <select v-model="selectedProvider" :disabled="formLocked || testingConnection" @change="resetKeyDraft">
                <option value="openai-responses">OpenAI Responses 兼容</option>
                <option value="anthropic">Anthropic Messages 兼容</option>
              </select>
              <small>{{ configuration?.readOnly ? '当前启用协议由服务端环境指定，用于全部模型请求。' : '保存后用于图片读取；切换协议会带出该协议已保存的地址与模型，密钥留空会保留该协议已存密钥；预设列表随协议切换（同一家服务商只在支持该协议的端点上出现）。' }}</small>
            </label>

            <label class="settings-field">
              <span>常用模型预设 <b>图片模型候选；需按任务核验</b></span>
              <select :value="''" :disabled="formLocked || testingConnection" @change="applyPreset">
                <option value="">选择预设以填入地址与模型…</option>
                <optgroup label="历史实测 · 仅所记录任务">
                  <option v-for="preset in testedPresets" :key="preset.id" :value="preset.id">{{ preset.label }}（历史实测）</option>
                </optgroup>
                <optgroup label="文档预设 · 未完成在线验收">
                  <option v-for="preset in documentedPresets" :key="preset.id" :value="preset.id">{{ preset.label }}（文档预设·未在线验收）</option>
                </optgroup>
              </select>
              <small role="status">{{ configuration?.readOnly ? '环境模式的地址与模型由服务端环境指定，本页预设不可修改当前配置。' : presetHint || "选取后只填入当前协议的地址与模型，不自动测试或保存，密钥不受影响；也可手动填写。" }}</small>
            </label>

            <label class="settings-field">
              <span>接口地址 <b>{{ providerMeta.baseUrlLabel }}</b></span>
              <input
                v-model="activeDraft.baseUrl"
                type="url"
                inputmode="url"
                autocomplete="url"
                :placeholder="providerMeta.defaultBaseUrl"
                required
                :disabled="formLocked || testingConnection"
              />
              <small>{{ providerMeta.baseUrlHint }}</small>
            </label>

            <label class="settings-field">
              <span>模型名称</span>
              <input v-model="activeDraft.model" type="text" autocomplete="off" :placeholder="providerMeta.defaultModel" required :disabled="formLocked || testingConnection" />
              <small>{{ configuration?.readOnly ? '当前模型名来自服务端环境配置，读图需要模型支持图片输入；本次连接测试只检查协议结构。' : providerMeta.modelHint }}</small>
            </label>

            <label class="settings-field key-field">
              <span>API 密钥 <b>{{ configuration?.readOnly ? "由服务端环境提供；不回显" : activeDraft.hasApiKey && !clearApiKey ? "已保存；留空会保留" : "必填后才能实时读取" }}</b></span>
              <input
                v-model="apiKey"
                type="password"
                autocomplete="new-password"
                :placeholder="configuration?.readOnly ? '环境密钥不回显' : activeDraft.hasApiKey ? '输入新密钥以替换当前密钥' : '粘贴服务商 API 密钥'"
                @input="clearApiKey = false"
                :disabled="formLocked || testingConnection"
              />
              <small>{{ configuration?.readOnly ? '密钥不进入浏览器；点击读取后图片才发送到所配服务。' : '保存时密钥仅发给本机服务；点击读取后图片才发送到所配服务。' }}</small>
            </label>

            <div class="settings-actions">
              <button class="pixel-button primary-action save-settings" type="submit" :disabled="formLocked || saving || testingConnection">
                {{ saving ? "正在保存…" : "保存设置" }}
              </button>
              <button class="pixel-button test-connection" type="button" :disabled="saving || loading || testingConnection || configuration === null || (configuration.readOnly && !activeDraft.hasApiKey)" @click="testConnection">
                {{ testingConnection ? "正在测试…" : "测试连接" }}
              </button>
              <button
                v-if="!formLocked && activeDraft.hasApiKey && !clearApiKey"
                class="clear-key-button"
                type="button"
                :disabled="saving || testingConnection"
                @click="requestKeyRemoval"
              >
                清除已保存 Key
              </button>
              <span v-else-if="clearApiKey" class="clear-key-pending">保存后清除 Key</span>
            </div>
          </form>

          <p v-if="loading" class="settings-feedback" role="status">正在读取本机设置…</p>
          <p v-if="successMessage" class="settings-feedback success-feedback" role="status">{{ successMessage }}</p>
          <p v-if="errorMessage" class="settings-feedback error-feedback" role="alert">{{ errorMessage }}</p>
          <p v-if="connectionMessage" class="settings-feedback" :class="connectionStatus === 'success' ? 'success-feedback' : 'error-feedback'" :role="connectionStatus === 'success' ? 'status' : 'alert'">{{ connectionMessage }}</p>
          <p class="settings-test-note settings-test-explanation">测试时向{{ configuration?.readOnly ? '当前环境配置的' : '所填' }}服务发送一条短文本请求和当前密钥，以检查{{ providerMeta.structuredOutputLabel }}；不发送图片，也不保存表单改动。<strong>测试通过不代表能读图</strong>：纯文本模型也可能测通，读图能力必须上传样例核验。</p>

          <details class="settings-evidence" aria-label="历史记录与验证范围">
            <summary>历史实测与文档预设说明</summary>
            <h3 id="settings-evidence-title">本项目的验证范围</h3>
            <p>历史实测只证明当时的端点、模型和任务，不能代表当前配置或其他预设已通过。</p>
            <details v-for="preset in testedPresets" :key="preset.id">
              <summary>{{ preset.label }} · 历史实测记录</summary>
              <p>{{ preset.note }}</p>
            </details>
            <p class="settings-protocol-boundary">{{ selectedProvider === 'openai-responses'
              ? 'Responses 有历史连接与单图读取记录；来源调查工具循环尚无与 Messages 同等的整组在线证据。'
              : 'Messages 的来源调查另有历史评测记录；不代表每个兼容端点都已通过完整流程。' }}</p>
            <p>文档预设未完成本项目在线验收；文档说明或未鉴权路由探测不等于读图、工具循环通过。</p>
          </details>

          <details class="settings-mobile-details settings-form-details">
            <summary><span>查看配置来源与图片发送范围</span><span class="disclosure-cue" aria-hidden="true"></span></summary>
            <ul class="settings-notes">
              <li><strong>所配模型必须支持图片输入（多模态）。</strong>预设只收录支持图片输入的型号；「测试连接」不发送图片，纯文本模型也可能测通。</li>
              <li>{{ configuration?.source === 'env' ? '当前配置来自服务端环境变量，密钥仅在内存使用，不写入设置文件。' : '提交后由本机 Node 服务写入当前 Windows 用户的 LocalAppData。' }}</li>
              <li>设置读取接口只返回“已配置”状态，不会把密钥回传给页面。</li>
              <li>点击读取时，图片会发送到本页配置的模型服务。</li>
              <li>{{ configuration?.source === 'env' ? '修改环境配置后需重启服务，本页为只读。' : '同一 Windows 账户下运行的其他程序也可以读取设置文件。' }}</li>
            </ul>
            <div class="settings-protocol"><span class="protocol-led"></span>{{ providerMeta.badge }}</div>
          </details>

        </section>
      </div>

      <footer class="settings-footer">
        <RouterLink to="/source-audit">前往来源核验 <span aria-hidden="true">→</span></RouterLink>
        <span>本机服务只监听 127.0.0.1</span>
      </footer>
    </main>
  </div>
</template>
