// Init script: a loopback "microphone" for the mic click measurement. Everything the page sends
// to the speaker (ctx.destination) is also fed through a DelayNode (window.__micDelay s, default
// 0.15) into a MediaStream that getUserMedia returns. window.__micDeny = true → NotAllowedError.
export const FAKE_MIC = `(() => {
  const OC = window.AudioContext;
  window.AudioContext = class extends OC { constructor(...a) { super(...a); window.__lbCtx = this; } };
  const orig = AudioNode.prototype.connect;
  const lb = new WeakMap();
  const loop = (ctx) => {
    let l = lb.get(ctx);
    if (!l) {
      const d = ctx.createDelay(1);
      d.delayTime.value = window.__micDelay ?? 0.15;
      const m = ctx.createMediaStreamDestination();
      orig.call(d, m);
      l = { d, m };
      lb.set(ctx, l);
    }
    return l;
  };
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = orig.call(this, dest, ...rest);
    if (dest instanceof AudioDestinationNode) orig.call(this, loop(this.context).d);
    return r;
  };
  const md = navigator.mediaDevices || (navigator.mediaDevices = {});
  md.getUserMedia = async () => {
    if (window.__micDeny) throw new DOMException("Permission denied", "NotAllowedError");
    if (!window.__lbCtx) throw new DOMException("no context", "NotFoundError");
    return loop(window.__lbCtx).m.stream;
  };
})();`;
