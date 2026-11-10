// "Hold to unlock" buttons (touch lock, master lock): progress fill, fires after `ms`.
export function holdButton(btn: HTMLElement, ms: number, done: () => void) {
  const bar = btn.querySelector("i") as HTMLElement | null;
  let t0 = 0;
  let raf = 0;
  const reset = () => {
    t0 = 0;
    cancelAnimationFrame(raf);
    if (bar) bar.style.width = "0%";
  };
  const step = () => {
    if (!t0) return;
    const k = Math.min(1, (performance.now() - t0) / ms);
    if (bar) bar.style.width = `${k * 100}%`;
    if (k >= 1) {
      reset();
      done();
    } else raf = requestAnimationFrame(step);
  };
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    t0 = performance.now();
    raf = requestAnimationFrame(step);
  });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) btn.addEventListener(ev, reset);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
}
