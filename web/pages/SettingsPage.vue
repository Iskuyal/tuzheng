<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import SiteHeader from "../components/SiteHeader.vue";

interface PublicModelSettings {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
}

const settings = ref<PublicModelSettings>({
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  hasApiKey: false,
});
const apiKey = ref("");
const clearApiKey = ref(false);
const loading = ref(false);
const saving = ref(false);
const errorMessage = ref("");
const successMessage = ref("");

const credentialState = computed(() => settings.value.hasApiKey ? "已保存到本机" : "尚未配置");

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
  try {
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: settings.value.baseUrl,
        model: settings.value.model,
        apiKey: apiKey.value,
        clearApiKey: clearApiKey.value,
      }),
    });
    const payload = await response.json().catch(() => null) as {
      settings?: PublicModelSettings;
      error?: { message?: string };
    } | null;
    if (!response.ok || !payload?.settings) {
      throw new Error(payload?.error?.message ?? `设置保存失败（${response.status}）。`);
    }
    settings.value = payload.settings;
    apiKey.value = "";
    clearApiKey.value = false;
    successMessage.value = settings.value.hasApiKey
      ? "设置已保存到本机，可以返回审计台上传图片。"
      : "连接参数已保存；填写 API Key 后才能实时读取。";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "设置保存失败，请重试。";
  } finally {
    saving.value = false;
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
          <p class="settings-lede">可填写任意 Responses API 兼容服务。当前预填 OpenAI 候选示例；地址与模型均可替换，真实调用尚未验证。</p>
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
            <li>审计图片由服务端发送到你配置的 Responses API 兼容服务。</li>
            <li>设置文件按本机用户账户权限保存；同一 Windows 账户下的进程也可读取它。</li>
          </ul>
          <div class="settings-protocol"><span class="protocol-led"></span>OpenAI Responses API 候选协议</div>
        </aside>

        <section class="settings-form-panel" aria-labelledby="settings-form-title">
            <div class="settings-panel-heading">
            <div class="settings-panel-heading-row">
              <h2 id="settings-form-title">连接参数</h2>
              <span class="settings-credential-status" :class="{ configured: settings.hasApiKey }" aria-live="polite">密钥：{{ credentialState }}</span>
            </div>
            <div class="settings-security-note" role="note">
              <strong>密钥安全</strong>
              <span>本机保存；同账户程序可读，页面不回显。</span>
            </div>
          </div>

          <form class="settings-form" @submit.prevent="saveSettings">
            <label class="settings-field">
              <span>接口地址 <b>Responses API Base URL</b></span>
              <input
                v-model="settings.baseUrl"
                type="url"
                inputmode="url"
                autocomplete="url"
                placeholder="https://api.openai.com/v1"
                required
              />
              <small>填写服务根地址；服务端会在后面调用 `/responses`。远程服务需用 HTTPS，本机回环地址可用 HTTP。</small>
            </label>

            <label class="settings-field">
              <span>模型名称</span>
              <input v-model="settings.model" type="text" autocomplete="off" placeholder="gpt-4.1-mini" required />
              <small>需支持图片输入与 JSON Schema 输出；当前模型名只是可替换的候选示例。</small>
            </label>

            <label class="settings-field key-field">
              <span>API 密钥 <b>{{ settings.hasApiKey && !clearApiKey ? "已保存；留空会保留" : "必填后才能实时读取" }}</b></span>
              <input
                v-model="apiKey"
                type="password"
                autocomplete="new-password"
                :placeholder="settings.hasApiKey ? '输入新密钥以替换当前密钥' : '粘贴服务商 API 密钥'"
                @input="clearApiKey = false"
              />
              <small>保存时密钥仅发给本机服务；点击读取后图片才发送到所配服务。</small>
            </label>

            <div class="settings-actions">
              <button class="pixel-button primary-action save-settings" type="submit" :disabled="saving || loading">
                {{ saving ? "正在保存…" : "保存设置" }}
              </button>
              <button
                v-if="settings.hasApiKey && !clearApiKey"
                class="clear-key-button"
                type="button"
                :disabled="saving"
                @click="requestKeyRemoval"
              >
                清除已保存 Key
              </button>
              <span v-else-if="clearApiKey" class="clear-key-pending">保存后清除 Key</span>
            </div>
          </form>

          <details class="settings-mobile-details settings-form-details">
            <summary><span>查看本机保存与图片发送范围</span><span class="disclosure-cue" aria-hidden="true"></span></summary>
            <ul class="settings-notes">
              <li>提交后由本机 Node 服务写入当前 Windows 用户的 LocalAppData。</li>
              <li>设置读取接口只返回“已配置”状态，不会把密钥回传给页面。</li>
              <li>点击读取时，图片会发送到本页配置的 Responses API 兼容服务。</li>
              <li>同一 Windows 账户下运行的其他程序也可以读取设置文件。</li>
            </ul>
            <div class="settings-protocol"><span class="protocol-led"></span>OpenAI Responses API 候选协议</div>
          </details>

          <p v-if="loading" class="settings-feedback" role="status">正在读取本机设置…</p>
          <p v-if="successMessage" class="settings-feedback success-feedback" role="status">{{ successMessage }}</p>
          <p v-if="errorMessage" class="settings-feedback error-feedback" role="alert">{{ errorMessage }}</p>
        </section>
      </div>

      <footer class="settings-footer">
        <RouterLink to="/audit">返回审计工作台 <span aria-hidden="true">→</span></RouterLink>
        <span>本机服务只监听 127.0.0.1</span>
      </footer>
    </main>
  </div>
</template>
