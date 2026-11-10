// Offline shell: caches the app, all three pages and all samples on install (cache-first).
const PREFIX = `schwarm:${self.registration.scope}:`;
const CACHE = `${PREFIX}248a8f831358`;
const SHELL = ["./", "./index.html", "./test.html", "./guest.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./samples/CREDITS.txt", "./assets/curve-view-LnU3mZz1.js", "./assets/guest-A2yXIhcR.js", "./assets/guest-CvkSngEJ.css", "./assets/live-B96kYfxg.js", "./assets/main-CItSmbFV.js", "./assets/sw-register-BC6oRj2a.css", "./assets/sw-register-DSAZ5JrD.js", "./assets/test-BXQ01WQb.css", "./assets/test-CTd_m_16.js", "./samples/drum-kick.wav", "./samples/drum-kickdeep.wav", "./samples/drum-snare.wav", "./samples/drum-snaredark.wav", "./samples/drum-clap.wav", "./samples/drum-hat.wav", "./samples/drum-openhat.wav", "./samples/drum-rim.wav", "./samples/drum-tom.wav", "./samples/drum-conga.wav", "./samples/drum-clave.wav", "./samples/drum-shaker.wav", "./samples/drum-ride.wav", "./samples/sub-28.wav", "./samples/sub-32.wav", "./samples/sub-36.wav", "./samples/sub-40.wav", "./samples/fmbass-30.wav", "./samples/fmbass-36.wav", "./samples/fmbass-42.wav", "./samples/bowed-44.wav", "./samples/bowed-48.wav", "./samples/bowed-52.wav", "./samples/bowed-56.wav", "./samples/bowed-60.wav", "./samples/bowed-64.wav", "./samples/choir-42.wav", "./samples/choir-48.wav", "./samples/choir-54.wav", "./samples/choir-60.wav", "./samples/choir-66.wav", "./samples/sweep-44.wav", "./samples/sweep-48.wav", "./samples/sweep-52.wav", "./samples/sweep-56.wav", "./samples/sweep-60.wav", "./samples/sweep-64.wav", "./samples/brass-42.wav", "./samples/brass-48.wav", "./samples/brass-54.wav", "./samples/brass-60.wav", "./samples/brass-66.wav", "./samples/brass-72.wav", "./samples/fifths-40.wav", "./samples/fifths-44.wav", "./samples/fifths-48.wav", "./samples/fifths-52.wav", "./samples/fifths-56.wav", "./samples/fifths-60.wav", "./samples/fifths-64.wav", "./samples/fifths-68.wav", "./samples/fifths-72.wav"];
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL.map((p) => new URL(p, self.location.href).href));
      await self.skipWaiting();
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE && key.startsWith(PREFIX)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (event.request.mode === "navigate") {
        try {
          return await fetch(event.request);
        } catch {
          return (await cache.match(event.request, { ignoreSearch: true })) || (await cache.match(new URL("./", self.location.href).href));
        }
      }
      return (await cache.match(event.request, { ignoreVary: true, ignoreSearch: true })) || fetch(event.request);
    })(),
  );
});
