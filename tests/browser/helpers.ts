import { expect, type Page } from "@playwright/test";
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}
/** Every visible control ≥ 44 px, every visible text ≥ 11 px, nothing wider than the viewport. */
export async function checkLayout(page: Page) {
  const r = await page.evaluate(() => {
    const vis = (el: Element) => {
      const b = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return b.width > 0 && b.height > 0 && st.visibility !== "hidden" && st.display !== "none" && !el.closest("[hidden]");
    };
    const small: string[] = [];
    for (const el of document.querySelectorAll("button, a, input, label.btn")) {
      if (!vis(el) || (el as HTMLInputElement).type === "file") continue;
      const b = el.getBoundingClientRect();
      if (b.height < 43.5 || b.width < 43.5) small.push(`${el.tagName}#${el.id || (el.textContent ?? "").trim().slice(0, 20)} ${Math.round(b.width)}×${Math.round(b.height)}`);
    }
    const tiny: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const el = n.parentElement;
      if (!el || !(n.textContent ?? "").trim() || !vis(el)) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 11) tiny.push(`${el.tagName}.${el.className} ${fs}px`);
    }
    return { small, tiny, overflow: document.documentElement.scrollWidth - window.innerWidth };
  });
  expect(r.small, "touch targets ≥ 44 px").toEqual([]);
  expect(r.tiny, "text ≥ 11 px").toEqual([]);
  expect(r.overflow, "no horizontal overflow").toBeLessThanOrEqual(1);
}
export const VIEWPORTS = [
  { width: 844, height: 390 },
  { width: 390, height: 844 },
  { width: 667, height: 375 },
  { width: 1280, height: 800 },
];
