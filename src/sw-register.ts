export function registerSW() {
  if ("serviceWorker" in navigator && import.meta.env.PROD)
    window.addEventListener("load", () => void navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
