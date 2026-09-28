<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import SiteHeader from "../components/SiteHeader.vue";

type ModelProvider = "openai-responses" | "anthropic";

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
    badge: "OpenAI Responses API 候选协议",
    baseUrlLabel: "Responses API Base URL",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
    baseUrlHint: "只填服务根地址（如 https://api.openai.com/v1），不要粘贴 `/chat/completions` 或 `/responses` 的完整接口地址；服务端会自行调用 `/responses`。远程服务需用 HTTPS，本机回环地址可用 HTTP。",
    modelHint: "需支持图片输入与 JSON Schema 输出；当前模型名只是可替换的候选示例。",
    structuredOutputLabel: "Responses 结构化输出",
  },
  anthropic: {
    label: "Anthropic Messages",
    badge: "Anthropic Messages 协议",
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
const credentialState = computed(() => activeDraft.value.hasApiKey ? "已保存到本机" : "尚未配置");

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
      error?: { message?: string };
    } | null;
    if (!response.ok || !payload?.settings) {
      throw new Error(payload?.error?.message ?? "本机设置暂时无法读取。");
    }
    settings.value = payload.settings;
    selectedProvider.value = payload.settings.activeProvider;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "本机设置暂时无法读取。";
  } finally {
    loading.value = false;
  }
}

async function saveSettings(): Promise<void> {
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
  if (testingConnection.value || saving.value || loading.value) return;
  testingConnection.value = true;
  errorMessage.value = "";
  successMessage.value = "";
  connectionStatus.value = null;
  connectionMessage.value = "";
  try {
    const response = await fetch("/api/settings/test-connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(currentFormSettings()),
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
  <div class="settings-page">
    <SiteHeader />

    <main class="settings-shell">
      <section class="settings-intro">
        <div>
          <p class="section-kicker">本机连接 / 仅服务端读取</p>
          <h1>模型设置</h1>
          <p class="settings-lede">可选择 OpenAI Responses 兼容或 Anthropic Messages 协议；两种协议各自保存地址、模型与密钥，可分别填写与替换。可先测试连接，再决定是否保存。</p>
        </div>
      </section>

      <div class="settings-layout">
        <aside class="settings-rail">
          <div class="rail-art" aria-hidden="true">
            <span class="rail-pixel-lock"><i></i><b></b></span>
          </div>
          <p class="section-kicker">连接说明</p>
          <h2>密钥留在这台电脑</h2>
          <ul class="settings-notes">
            <li>浏览器提交后，由本机 Node 服务端写入当前 Windows 用户的 LocalAppData。</li>
            <li>读取设置时只返回“已配置”状态，不会把 API Key 回显给页面。</li>
            <li>审计图片由服务端发送到你配置的模型服务。</li>
            <li>设置文件按本机用户账户权限保存；同一 Windows 账户下的进程也可读取它。</li>
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
              <span>本机保存；同账户程序可读，页面不回显。</span>
            </div>
          </div>

          <form class="settings-form" @submit.prevent="saveSettings">
            <label class="settings-field">
              <span>接口协议</span>
              <select v-model="selectedProvider" :disabled="testingConnection" @change="resetKeyDraft">
                <option value="openai-responses">OpenAI Responses 兼容</option>
                <option value="anthropic">Anthropic Messages</option>
              </select>
              <small>保存后用于图片读取；切换协议会带出该协议已保存的地址与模型，密钥留空会保留该协议已存密钥。</small>
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
                :disabled="testingConnection"
              />
              <small>{{ providerMeta.baseUrlHint }}</small>
            </label>

            <label class="settings-field">
              <span>模型名称</span>
              <input v-model="activeDraft.model" type="text" autocomplete="off" :placeholder="providerMeta.defaultModel" required :disabled="testingConnection" />
              <small>{{ providerMeta.modelHint }}</small>
            </label>

            <label class="settings-field key-field">
              <span>API 密钥 <b>{{ activeDraft.hasApiKey && !clearApiKey ? "已保存；留空会保留" : "必填后才能实时读取" }}</b></span>
              <input
                v-model="apiKey"
                type="password"
                autocomplete="new-password"
                :placeholder="activeDraft.hasApiKey ? '输入新密钥以替换当前密钥' : '粘贴服务商 API 密钥'"
                @input="clearApiKey = false"
                :disabled="testingConnection"
              />
              <small>保存时密钥仅发给本机服务；点击读取后图片才发送到所配服务。</small>
            </label>

            <div class="settings-actions">
              <button class="pixel-button primary-action save-settings" type="submit" :disabled="saving || loading || testingConnection">
                {{ saving ? "正在保存…" : "保存设置" }}
              </button>
              <button class="pixel-button test-connection" type="button" :disabled="saving || loading || testingConnection" @click="testConnection">
                {{ testingConnection ? "正在测试…" : "测试连接" }}
              </button>
              <button
                v-if="activeDraft.hasApiKey && !clearApiKey"
                class="clear-key-button"
                type="button"
                :disabled="saving || testingConnection"
                @click="requestKeyRemoval"
              >
                清除已保存 Key
              </button>
              <span v-else-if="clearApiKey" class="clear-key-pending">保存后清除 Key</span>
            </div>
            <p class="settings-test-note">测试时向所填服务发送一条短文本请求和当前密钥，以检查{{ providerMeta.structuredOutputLabel }}；不发送图片，也不保存表单改动。</p>
          </form>

          <details class="settings-mobile-details settings-form-details">
            <summary><span>查看本机保存与图片发送范围</span><span class="disclosure-cue" aria-hidden="true"></span></summary>
            <ul class="settings-notes">
              <li>提交后由本机 Node 服务写入当前 Windows 用户的 LocalAppData。</li>
              <li>设置读取接口只返回“已配置”状态，不会把密钥回传给页面。</li>
              <li>点击读取时，图片会发送到本页配置的模型服务。</li>
              <li>同一 Windows 账户下运行的其他程序也可以读取设置文件。</li>
            </ul>
            <div class="settings-protocol"><span class="protocol-led"></span>{{ providerMeta.badge }}</div>
          </details>

          <p v-if="loading" class="settings-feedback" role="status">正在读取本机设置…</p>
          <p v-if="successMessage" class="settings-feedback success-feedback" role="status">{{ successMessage }}</p>
          <p v-if="errorMessage" class="settings-feedback error-feedback" role="alert">{{ errorMessage }}</p>
          <p v-if="connectionMessage" class="settings-feedback" :class="connectionStatus === 'success' ? 'success-feedback' : 'error-feedback'" :role="connectionStatus === 'success' ? 'status' : 'alert'">{{ connectionMessage }}</p>
        </section>
      </div>

      <footer class="settings-footer">
        <RouterLink to="/audit">返回审计工作台 <span aria-hidden="true">→</span></RouterLink>
        <span>本机服务只监听 127.0.0.1</span>
      </footer>
    </main>
  </div>
</template>
