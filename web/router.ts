import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "home",
      component: () => import("./pages/LandingPage.vue"),
    },
    {
      path: "/audit",
      name: "audit",
      component: () => import("./pages/AuditPage.vue"),
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("./pages/SettingsPage.vue"),
    },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
  scrollBehavior() {
    return { top: 0 };
  },
});

export default router;
