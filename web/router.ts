import { createRouter, createWebHistory } from "vue-router";
import { nextTick } from "vue";

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
      path: "/source-audit",
      name: "source-audit",
      component: () => import("./pages/SourceAuditPage.vue"),
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

router.afterEach(async (_to, _from, failure) => {
  if (failure) return;
  await nextTick();
  const heading = document.querySelector<HTMLElement>("main h1");
  heading?.setAttribute("tabindex", "-1");
  heading?.focus({ preventScroll: true });
});

export default router;
