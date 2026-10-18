// Sound effects. Web Audio, so the loops are gapless and can fade without a click.
// Browsers keep the AudioContext suspended until the first user gesture; it is resumed on the first pointerdown / keydown / touchend.
//   crumb   - background loop that plays all the time: quiet until the final screen, then swells (swell)
//   sparkle - loop that plays on the final screen only (sparkle)

const Sound = (() => {
  const DIR = '../assets/Sound/';
  const FILES = {
    crumb: '06_crumb_fall_loop/ijunijun-shiny-disco-2149.mp3',
    sparkle: '07_sparkle fall/freesound_community-shimmering-object-79354.mp3'
  };
  const VOLUME = { crumb: 1, sparkle: .35 }; // each effect's level (1 = the file's own level)
  const CRUMB_LEVEL = { before: .01, after: .04 }; // the crumb loop's level before the final screen and after it
  const RISE = 1.2, FALL = .6; // seconds the crumb loop takes to swell up to its final level and to settle back down
  const SPARKLE_IN = 1, LOOP_FADE = .25; // seconds the sparkle loop fades in over, and a stopping loop fades out over
  const buffers = {};
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const master = ctx.createGain();
  master.connect(ctx.destination);
  let muted = false, swelled = false, crumbSrc = null, crumbGain = null, sparkSrc = null, sparkGain = null;

  // every effect plays through its own gain node into master
  const slots = {};
  Object.keys(FILES).forEach(name => {
    slots[name] = ctx.createGain();
    slots[name].gain.value = VOLUME[name];
    slots[name].connect(master);
  });

  const ready = Promise.all(Object.entries(FILES).map(([name, file]) => // resolves when every sound is decoded or has failed (the loading screen waits for it)
    fetch(DIR + file)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(data => ctx.decodeAudioData(data))
      .then(buf => { buffers[name] = buf; if (name === 'crumb') startCrumb(); }) // the crumb loop starts as soon as its sound is ready (heard from the first user gesture on)
      .catch(err => console.error('Sound load failed', file, err))
  ));

  const unlock = () => { if (ctx.state === 'suspended') ctx.resume(); };
  ['pointerdown', 'keydown', 'touchend'].forEach(ev => addEventListener(ev, unlock, { passive: true }));

  function startCrumb() {
    if (crumbSrc || !buffers.crumb) return;
    crumbSrc = ctx.createBufferSource(); crumbGain = ctx.createGain();
    crumbGain.gain.value = swelled ? CRUMB_LEVEL.after : CRUMB_LEVEL.before;
    crumbSrc.buffer = buffers.crumb; crumbSrc.loop = true;
    crumbSrc.connect(crumbGain); crumbGain.connect(slots.crumb);
    crumbSrc.start();
  }

  /** The crumb loop plays all the time as a quiet background; on = swell up to its final level (final screen), off = settle back to quiet. */
  function swell(on) {
    swelled = on;
    if (!crumbGain) return;
    const g = crumbGain.gain, t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(on ? CRUMB_LEVEL.after : CRUMB_LEVEL.before, t + (on ? RISE : FALL));
  }

  /** The sparkle loop plays only on the final screen: on = fade in and loop, off = fade out. */
  function sparkle(on) {
    const t = ctx.currentTime;
    if (on) {
      if (sparkSrc || !buffers.sparkle) return;
      sparkSrc = ctx.createBufferSource(); sparkGain = ctx.createGain();
      sparkSrc.buffer = buffers.sparkle; sparkSrc.loop = true;
      sparkGain.gain.setValueAtTime(0, t);
      sparkGain.gain.linearRampToValueAtTime(1, t + SPARKLE_IN);
      sparkSrc.connect(sparkGain); sparkGain.connect(slots.sparkle);
      sparkSrc.start();
    } else if (sparkSrc) {
      const src = sparkSrc, gain = sparkGain.gain;
      sparkSrc = null; sparkGain = null;
      gain.setValueAtTime(gain.value, t);
      gain.linearRampToValueAtTime(0, t + LOOP_FADE);
      src.stop(t + LOOP_FADE + .05);
    }
  }

  function toggleMute() {
    muted = !muted;
    master.gain.value = muted ? 0 : 1;
    return muted;
  }

  return { swell, sparkle, toggleMute, ready };
})();
