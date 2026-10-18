// Entry point: state, DOM render, event wiring. Replaces the dc-runtime React re-render loop
// with one coarse render() called after every setState(), mirroring the original's renderVals().

const state = { view: 'main', center: 0, ph: 0 };
function getState() { return state; }
function setState(patch) { Object.assign(state, patch); render(); }

const els = {
  glow: document.getElementById('glow'),
  stage: document.getElementById('stage'),
  numLabel: document.getElementById('numLabel'),
  capName: document.getElementById('capName'),
  capTag: document.getElementById('capTag'),
  dots: document.querySelectorAll('[data-dot]'),
  backBtn: document.getElementById('backBtn'),
  infoNo: document.getElementById('infoNo'),
  infoName: document.getElementById('infoName'),
  infoIntro: document.getElementById('infoIntro'),
  infoIngrList: document.getElementById('infoIngrList'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
  soundBtn: document.getElementById('soundBtn')
};

let threeScene = null;

// glowMix colours arrive in no fixed order, so roles come from the colours themselves: darkest = wide base, lightest = bright core,
// the other three by saturation = main, accent, highlight. Returns [main, base, core, accent, highlight].
function glowRoles(cols) {
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), lum = h => { const [r, g, b] = rgb(h); return .2126 * r + .7152 * g + .0722 * b; };
  const sat = h => { const v = rgb(h), mx = Math.max(...v), mn = Math.min(...v); return mx ? (mx - mn) / mx : 0; };
  const byLum = [...cols].sort((a, b) => lum(a) - lum(b)), base = byLum[0], core = byLum[byLum.length - 1];
  const rest = byLum.slice(1, -1).sort((a, b) => sat(b) - sat(a));
  return [rest[0], base, core, rest[1], rest[2]];
}

// One glow layer per flavour; render() cross-fades them with opacity (gradients can't be transitioned directly).
const glowLayers = FL.map(f => {
  const d = document.createElement('div');
  d.className = 'glow-layer';
  // gradient glow: like a softly lit sphere, each colour leans to its own side of the glow centre (--gx/--gy, scaled by --gs) with wide flat overlaps
  // so they blend into one field - bright core up-right, main colour left, accent down-right, highlight below - over a wide dark base.
  // The cursor (--mx/--my, -1..1) moves the light, not the glow: the bright core slides toward the cursor and the colours drift slightly away from it
  // (k, % of the screen), while the glow's footprint stays fixed by the mask in style.css.
  const wk = f.glowWhite || 0, whiten = h => '#' + [1, 3, 5].map(i => Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - wk) + 255 * wk).toString(16).padStart(2, '0')).join('');
  const [main, base, core, accent, hi] = glowRoles(f.glowMix).map((c, i) => i === 1 ? c : whiten(c)); // the dark base stays dark
  const blob = (w, h, dx, dy, k, c, a0, a1) => `radial-gradient(ellipse calc(${w}% * var(--gs, 1)) calc(${h}% * var(--gs, 1)) at calc(var(--gx, 50%) + (${dx}% + var(--mx, 0) * ${k}%) * var(--gs, 1)) calc(var(--gy, 54%) + (${dy}% + var(--my, 0) * ${k}%) * var(--gs, 1)), ${c}${a0} 0%, ${c}${a0} 22%, ${c}${a1} 52%, transparent 88%)`; // flat centre (no hot spot) and a long soft tail, so the colours flow into each other
  d.style.background = [
    blob(34, 40, 11, -11, 16, core, '50', '1c'),
    blob(44, 52, -14, -1, -5, main, '70', '2a'),
    blob(42, 50, 13, 10, -5, accent, '70', '2a'),
    blob(40, 48, -2, 15, -5, hi, '58', '22'),
    blob(90, 100, 0, 0, 0, base, 'cc', '44')
  ].join(', ');
  els.glow.appendChild(d);
  return d;
});

// Per-flavour accent for UI details (dots, number, divider). Text accent is the flavour colour lifted toward white so it stays readable on black.
function lift(hex, k) { const n = parseInt(hex.slice(1, 7), 16), m = c => Math.round(c + (255 - c) * k); return `rgb(${m(n >> 16)},${m((n >> 8) & 255)},${m(n & 255)})`; }
function setAccent(f) {
  const r = document.documentElement.style;
  r.setProperty('--accent', f.color); r.setProperty('--accent-text', lift(f.color, .5)); r.setProperty('--accent-glow', (f.glowColor || f.color) + '66');
}

// Flavour name/tag: fade out, swap text, fade in.
let shownCenter = -1, swapTimer = 0;
function showCaption(i) { els.capName.textContent = FL[i].name; els.capTag.textContent = FL[i].tag; shownCenter = i; setAccent(FL[i]); }
function updateCaption() {
  if (shownCenter < 0) { showCaption(state.center); return; }
  if (state.center === shownCenter || swapTimer) return;
  els.capName.classList.add('is-fading'); els.capTag.classList.add('is-fading');
  swapTimer = setTimeout(() => {
    swapTimer = 0; showCaption(state.center);
    els.capName.classList.remove('is-fading'); els.capTag.classList.remove('is-fading');
  }, 220);
}

let shownInfo = -1; // the flavour the detail panel was last filled with
function render() {
  document.body.dataset.view = state.view;
  document.body.dataset.ph = String(state.ph);
  if (state.ph !== 0) document.body.classList.remove('idle');

  const centerF = FL[state.center];
  glowLayers.forEach((l, i) => { l.style.opacity = i === state.center ? 1 : 0; });
  els.numLabel.textContent = String(state.center + 1).padStart(2, '0') + ' / 0' + FL.length;
  updateCaption();
  els.dots.forEach((d, i) => {
    d.classList.toggle('on', i === state.center);
  });

  const sel = threeScene ? threeScene.getSel() : -1;
  const infoIdx = sel >= 0 ? sel : state.center;
  if (infoIdx === shownInfo) return; // the detail panel's text only depends on which flavour it shows
  shownInfo = infoIdx;
  els.infoNo.textContent = String(infoIdx + 1).padStart(2, '0') + ' / 0' + FL.length;
  els.infoName.textContent = FL[infoIdx].name;
  els.infoIntro.textContent = EX[infoIdx].intro;
  els.infoIngrList.innerHTML = '';
  EX[infoIdx].ingr.forEach(t => {
    const line = document.createElement('div');
    line.className = 'ingr-line';
    line.textContent = t;
    els.infoIngrList.appendChild(line);
  });
}

els.backBtn.addEventListener('click', () => threeScene.reset());
els.prevBtn.addEventListener('click', () => threeScene.scrollStep(-1));
els.nextBtn.addEventListener('click', () => threeScene.scrollStep(1));
els.soundBtn.addEventListener('click', () => {
  const off = Sound.toggleMute(), label = off ? 'Sound off' : 'Sound on';
  els.soundBtn.classList.toggle('is-off', off);
  const bars = els.soundBtn.querySelector('svg'); // the waveform animates only while the sound is on
  if (off) bars.pauseAnimations(); else bars.unpauseAnimations();
  els.soundBtn.setAttribute('aria-label', label); els.soundBtn.dataset.tip = label;
});

// Blink a centred "Scroll" hint after 5s without input on the lineup screen.
let idleTimer = 0;
function resetIdle() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (state.ph === 0) document.body.classList.add('idle'); }, 5000);
}
['wheel', 'keydown', 'pointerdown', 'touchstart'].forEach(ev => addEventListener(ev, resetIdle, { passive: true }));

// The loading screen (Pringo.html) stays up until the scene has everything and has warmed up (threeScene.ready) and the sounds are decoded, for at least one turn of its
// animation so it does not flash by. If something never arrives it still goes away after LOADING_MAX_MS (the console says what failed).
const LOADING_MIN_MS = 1350, LOADING_MAX_MS = 20000;

async function boot() {
  const loadingEl = document.getElementById('loading');
  // the fonts the first screen shows (flavour name, body text) load alongside the models instead of before them
  const fonts = Promise.all([document.fonts.load('400 68px "Lilita One"', 'Original'), document.fonts.load('400 15px "Pretendard Variable"', 'Original 01 / 06')]).catch(() => {});
  threeScene = createThreeScene(els.stage, { FL, EX, getState, setState });
  threeScene.init();
  render();
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await Promise.race([Promise.all([threeScene.ready, Sound.ready, fonts, wait(LOADING_MIN_MS)]), wait(LOADING_MAX_MS)]);
  threeScene.release(); // input works from here on, even if the wait ran out
  loadingEl.classList.add('is-done');
  loadingEl.addEventListener('transitionend', () => loadingEl.remove(), { once: true });
  resetIdle();
}

boot();
