// Fake DeviceMotion for Playwright: a synthetic dancer on (or off) the beat the guest hears.
// The dancer follows the guest's own synced copy of the master grid, like a person following
// the music; `offset` shifts the phase (rad), `bpm` (if set) ignores the music (random tempo).
export const FAKE_MOTION = `
window.__dance = function (o) {
  o = Object.assign({ amp: 3, offset: 0, period: 1, noise: 0.4, bpm: 0, tilt: 0.7 }, o || {});
  if (window.__danceTimer) clearInterval(window.__danceTimer);
  var t0 = performance.now();
  window.__danceTimer = setInterval(function () {
    var core = window.__guest && window.__guest.core && window.__guest.core();
    var g = core && core.link.last;
    var v = 0, th;
    if (o.bpm) th = 2 * Math.PI * (performance.now() - t0) / (60000 / o.bpm);
    else if (g) {
      var tm = core.link.clock.toMaster(performance.timeOrigin + performance.now());
      th = 2 * Math.PI * (tm - g.at) / (60000 / g.bpm * o.period);
    } else th = 2 * Math.PI * (performance.now() - t0) / 469;
    v = o.amp * Math.cos(th - o.offset) + (Math.random() - 0.5) * o.noise;
    var gy = 9.81 * o.tilt, gz = 9.81 * Math.sqrt(1 - o.tilt * o.tilt);
    var lin = { x: (Math.random() - 0.5) * o.noise, y: v * o.tilt, z: v * Math.sqrt(1 - o.tilt * o.tilt) };
    window.dispatchEvent(new DeviceMotionEvent("devicemotion", { acceleration: lin, accelerationIncludingGravity: { x: lin.x, y: gy + lin.y, z: gz + lin.z }, interval: 16 }));
  }, 16);
};
`;
