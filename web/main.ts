import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import "./style.css";
import "./evidence-room.css";
import "./evidence-room-workspaces.css";

createApp(App).use(router).mount("#app");
