/// <reference types="vite/client" />

// 让不认识 SFC 的工具（编辑器内置的 tsc 服务、tsc -b、第三方 CLI）也能解析 .vue 导入。
// vue-tsc 会解析真实的 .vue 文件，因此 npm run typecheck 仍然做完整检查，这里只兜底。
declare module "*.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent<{}, {}, any>;
  export default component;
}
