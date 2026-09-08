import type { Page } from "@playwright/test";

/** Expand the same optional controls a user clicks; do not mutate page state. */
export async function expandSupplement(page: Page) {
  const summary = page.getByText("补充原剧本材料", { exact: true });
  if (await summary.count() && await summary.locator("..").getAttribute("open") === null) await summary.click();
}
