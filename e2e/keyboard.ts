import { expect, type Locator, type Page } from "@playwright/test";

/** 遍历真实 Tab 顺序，避免用 focus() 把不可键盘到达的元素测成通过。 */
export async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let index = 0; index < 90; index += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}
