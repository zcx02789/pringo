// Three.js scene: GLB-based cans, carousel, select/lid-pop/particle-burst flow.
// Mirrors the original prototype's Component.initThree()/start()/select()/etc. 1:1 in behavior,
// retargeted from a procedural CylinderGeometry can to the real Pringo_V2.glb Body+Cap nodes.

function createThreeScene(host, { FL, EX, getState, setState }) {
  const T = THREE;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const R = new T.WebGLRenderer({ antialias: true, alpha: true }); R.setClearColor(0x000000, 0); R.setPixelRatio(Math.min(2, devicePixelRatio));
  R.outputEncoding = T.sRGBEncoding; R.toneMapping = T.ACESFilmicToneMapping; R.toneMappingExposure = 1;
  host.appendChild(R.domElement); R.domElement.style.display = 'block';
  R.domElement.setAttribute('role', 'img'); R.domElement.setAttribute('aria-label', 'Interactive 3D showcase of six Pringo flavour cans. Scroll, swipe or use arrow keys to change flavour; click a can to open it.');
  // whip-pan motion blur: while the camera chases the hero chip, the scene is rendered to whipRT and redrawn through a directional blur
  // along the camera's screen-space velocity, hero chip included. whipRT is tone-mapped and sRGB-encoded exactly like the
  // canvas (r128 tone-maps render targets too), so switching between the blurred pass and the direct render is seamless.
  const rtOpts = { minFilter: T.LinearFilter, magFilter: T.LinearFilter, encoding: T.sRGBEncoding };
  const whipRT = R.capabilities.isWebGL2 ? new T.WebGLMultisampleRenderTarget(1, 1, rtOpts) : new T.WebGLRenderTarget(1, 1, rtOpts);
  const whipMat = new T.ShaderMaterial({
    uniforms: { tB: { value: whipRT.texture }, uDir: { value: new T.Vector2() }, uC: { value: new T.Vector2(.5, .5) }, uCA: { value: 0 } },
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    // each sample slides along the screen-space camera velocity (uDir, a straight directional blur), and the red / blue channels are
    // pushed apart radially (chromatic aberration, uCA - stronger toward the edges, like a real lens at speed)
    fragmentShader: `uniform sampler2D tB;uniform vec2 uDir,uC;uniform float uCA;varying vec2 vUv;
float rnd(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
void main(){
  float j=rnd(gl_FragCoord.xy);vec3 c=vec3(0.);float a=0.;vec2 r=vUv-uC;
  for(int i=0;i<16;i++){
    float t=(float(i)+j)/16.-.5;vec2 uv=vUv+uDir*t;
    c.r+=texture2D(tB,uv+r*uCA).r;vec4 g=texture2D(tB,uv);c.g+=g.g;a+=g.a;c.b+=texture2D(tB,uv-r*uCA).b;
  }
  gl_FragColor=vec4(c/16.,a/16.);
}`,
    depthTest: false, depthWrite: false
  });
  const whipScene = new T.Scene(), whipCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  whipScene.add(new T.Mesh(new T.PlaneGeometry(2, 2), whipMat));
  const scene = new T.Scene(), cam = new T.PerspectiveCamera(32, 1, .1, 100);

  // Studio rig from Studio_Setup.json (Blender, metres). Scaled by SS so the 0.194 m can matches our 1.5-unit can,
  // and shifted so the studio camera (0, .5, 1.15) lines up with ours (0, 0, 8).
  const rig = new T.Group(); scene.add(rig); // all studio lights; follows the selected can
  const SS = 7.7, SY = -3.85, SZ = 8 - 1.15 * SS;
  const BURST = 2.8; // burst duration (s); the follow-camera move and the hero chip settle end here
  const WHIP = 1.5, WHIP_AT = 0; // whip-pan duration (s) and the hero chip's screen x (NDC, 0 = centre) at which the pan starts
  const RATE = 2.4; // burst playback speed: scales the chips, particles and the camera move together (1 = the earlier pace)
  // burst speed curve: playback speed (x RATE) at evenly spaced points from the launch (first) to the final screen (last), joined smoothly.
  // The burst clock (chips, particles) and the whip pan both follow it.
  const BURST_SPEED = [.4, 1.89, 1.69, .87, .05];
  function speedAt(x) { // Catmull-Rom through the points, x = 0..1 through the burst; never below .05 so the burst cannot freeze
    const P = BURST_SPEED, n = P.length, s = Math.min(Math.max(x, 0), 1) * (n - 1), i = Math.min(Math.floor(s), n - 2), t = s - i;
    const p0 = P[Math.max(i - 1, 0)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(i + 2, n - 1)];
    const v = .5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
    return Math.max(.05, v);
  }
  const SHUTTER = .35; // motion-blur exposure (s): blur length = screen velocity * SHUTTER
  const HERO_ROT = { x: -180, y: -72, z: -130 }; // default local rotation offset (degrees) of the centre chip
  const STACK = { R: .26, IN: .35, GAP: .04, GAP_MIN: .005, GAP_DECAY: .76 }; // chips in the can's own units: inner radius (they fill the can), how far below the mouth they wait, delay between the first two chips (s), the shortest delay, and the factor each later gap shrinks by
  const SCATTER = { at: .5, spread: .4 }; // seconds after a chip launches before it leaves the straight line (the earliest, and the random extra per chip; the hero leaves at .25)
  const LID_GLINT = { strength: .15, circle: .91 }; // glass-sphere highlight picture laid over the lid (its black adds nothing): strength 0 = off, above 1 = brighter; circle = share of the picture's width its round outline takes (it is fitted to the lid's top)
  // add the picture's light to the scene without touching the canvas' alpha (plain additive blending also adds alpha, which turns see-through areas into opaque black)
  const GLINT_BLEND = { blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.SrcAlphaFactor, blendDst: T.OneFactor, blendSrcAlpha: T.ZeroFactor, blendDstAlpha: T.OneFactor };
  // scroll on the final screen: the lineup is back in its place at once and the whole final scene (chips, powder, the camera's view) is moved to `drop` units straight above it,
  // out of sight. Nothing is seen to move, then the camera goes straight down onto the lineup over `time` s. The chips and powder shrink away over the first `shrink` share of it,
  // so they are gone before the lineup comes into view and never share the picture with the cans. The lineup always stays where it is, so this can repeat for ever.
  // The first screen's text and arrows stay hidden until the camera is nearly there (`ui`, a share of `time`), then fade in (style.css).
  const EXIT = { time: 1.4, drop: 14, shrink: .4, ui: .65 };
  const GRAIN = .35; // size multiplier for the Powder-mesh grains
  const FALL = .3, FOLLOW = .5; // final screen: particle fall speed (units/s) and how far chips turn with the cursor (radians)
  const FLY = 2, HERO_D = 12; // burst flight-distance multiplier; final camera distance from the hero chip
  const CENTER_Z = 1.5; // how far the centred can is pulled toward the camera on the lineup screen
  const LID_STRAIGHT = .06, LID_SPIN = { x: 8, y: 4, z: 5 }, LID_DRIFT = { x: 5, z: 10 }; // lid pop: seconds it flies straight up the can's axis, unrotated; then its turning speed (rad/s) and sideways acceleration (units/s^2)
  const STUDIO_FY = .449 * SS + SY; // studio target height (Studio_Target node) in scene units
  const glowEl = document.getElementById('glow');
  const glowVars = {}; // last text written to each glow CSS variable: a write restyles all the glow layers, so only changes are written
  const setGlow = (name, value) => { const v = String(value); if (glowVars[name] !== v) { glowVars[name] = v; glowEl.style.setProperty(name, v); } };
  const sw = v => [v[0] * SS, v[1] * SS + SY, v[2] * SS + SZ];
  // Light strengths are not Blender watts; tuned by eye against Studio_Reference.png.
  const LI = { Fill: .1, Key: .12, Top: .14, Rim: 1, Rim_L: 1, Spot: .9 };
  T.RectAreaLightUniformsLib.init();
  [ // name, colour, position (yup), direction (yup), width, height
    ['Fill', [1, 1, 1], [.9, .5, 1], [-.6685, -.0379, -.7428], 1.6, 1.6],
    ['Key', [1, .97, .93], [-.9, .95, 1], [.6269, -.349, -.6966], 1.6, 1.6],
    ['Rim', [.92, .96, 1], [.8, .75, -.5], [-.8079, -.304, .5049], .8, .8],
    ['Rim_L', [.92, .96, 1], [-.8, .75, -.5], [.8079, -.304, .5049], .8, .8],
    ['Top', [1, 1, 1], [0, 1.1, .3], [0, -.9082, -.4185], 1.6, 1.6]
  ].forEach(([name, c, p, d, w, h]) => {
    const l = new T.RectAreaLight(new T.Color(c[0], c[1], c[2]), LI[name], w * SS, h * SS), q = sw(p);
    l.name = name; l.position.set(q[0], q[1], q[2]); l.lookAt(q[0] + d[0], q[1] + d[1], q[2] + d[2]); rig.add(l);
  });
  // the spotlight colour drifts slightly toward the centred flavour's colour
  const spotBase = new T.Color(1, .95, .88), spotTarget = new T.Color(), tint = new T.Color();
  let spot = null;

  const state = {
    cans: null, pos: 0, target: 0, twFrom: 0, tw0: -1e9, acc: 0, lock: 0,
    tx: 0, ty: 0, cx: 0, cy: 0, last: 0,
    ph: 0, sel: -1, selT: 0, selDir: 0, selStart: 0, from: null,
    kick: 0, camZ: 8, camP: 0, camHero: new T.Vector3(), pts: [], chips: null, chipTpl: null, chipTpls: {}, lidT: 0, bT: 0, frz: 0, raf: 0,
    blur: new T.Vector2(), ndc0: null, canGone: false, heroRot: { x: HERO_ROT.x, y: HERO_ROT.y, z: HERO_ROT.z }, fc: 0, bAcc: 0, whipOn: false, wAcc: 0,
    leave: null, loading: true
  };

  // Preloading: main.js keeps the loading screen up until `ready`. Counted: the can, studio and chip models, plus one label image and one chip model per flavour.
  // Then the first-time work of the burst is done once, out of sight (warmUp), so nothing hitches later. Input is ignored meanwhile (state.loading).
  const PRELOAD_TOTAL = 3 + FL.length * 2;
  let preloaded = 0, readyResolve = null;
  const ready = new Promise(r => { readyResolve = r; });
  const preloadDone = () => { // one counter per file; calling it again does nothing, and a failed file counts too (the console says which)
    let done = false;
    return () => {
      if (done) return; done = true; preloaded++;
      if (preloaded >= PRELOAD_TOTAL) warmUp().then(() => { state.loading = false; readyResolve(); });
    };
  };

  function setPh(p) { state.ph = p; Sound.swell(p === 6); Sound.sparkle(p === 6); setState({ ph: p }); }
  const n = FL.length;
  function wrapK(i) { return ((i - state.pos + 3) % n + n) % n - 3; }

  // centre can keeps the classic slight top-view pitch (.08); the further from centre, the more of its own random pitch
  const pitch = (c, ak) => .08 + (c.rx0 - .08) * Math.min(1, ak);

  function step(d) { if (state.leave) return; state.twFrom = state.pos; state.tw0 = performance.now(); state.target += d; }
  function scrollStep(d) {
    if (state.ph === 0) { step(d); return; }
    if (d < 0) return;
    if (state.ph === 2) { state.lidT = performance.now(); state.kick = .12; buildChips(); setPh(3); }
    else if (state.ph === 4) startBurst();
    else if (state.ph === 6) startExit();
  }

  // final screen -> lineup. The lineup is put back at once, in its place (it has been out of the final view all along). The final scene is moved as one piece so that its
  // camera view lies straight above the lineup (a shift both the camera and the chips and powder get, so the picture does not change); then the loop sends the camera down.
  function startExit() {
    if (state.leave || !state.chips) return;
    const now = performance.now(), shift = new T.Vector3(-state.camHero.x, EXIT.drop - state.camHero.y, 0);
    state.chips.items.forEach(o => { o.leaveScale = o.mesh.scale.x; });
    state.camHero.add(shift); state.chips.group.position.add(shift);
    if (state.pts.length) state.pts[0].material.uniforms.uOrigin.value.add(shift); // one vector shared by all the powder layers
    state.leave = { t0: now, chips: state.chips, pts: state.pts };
    state.chips = null; state.pts = [];
    state.sel = -1; state.selT = 0; state.selDir = 0; state.ndc0 = null; state.blur.set(0, 0);
    state.lock = now + EXIT.time * 1000 + 600; // a scroll still coasting must not also turn the carousel once the camera is back
    document.body.classList.add('is-exiting'); // fades the flavour text out early (style.css)
    document.body.classList.remove('ui-in'); document.body.classList.add('hold-ui'); // the first screen's text and arrows wait for the camera (style.css)
    clearParticles(); // puts every lid back on (the kept chips and powder are no longer in state)
    setPh(0);
  }

  function select(i) {
    if (state.leave) return;
    const k = wrapK(i);
    state.from = { x: k * 1.9, y: -Math.sin(k * 1.2) * 1.1, s: 1.6 / (1 + .28 * Math.abs(k)), rz: Math.cos(k * 1.2) * .08, rx: pitch(state.cans[i], Math.abs(k)), ry: -k * .06 };
    loadChip(i);
    state.sel = i; state.selDir = 1; state.selStart = performance.now(); setPh(1);
  }
  // per-flavour chip models are large: they are all fetched during loading (init), and fetched on selection only if one failed to come
  const chipLoading = {};
  function loadChip(i, done) {
    if (state.chipTpls[i]) { if (done) done(); return; }
    if (chipLoading[i]) { if (done) setTimeout(() => loadChip(i, done), 300); return; } // already on its way: ask again shortly
    chipLoading[i] = true;
    new T.GLTFLoader().load('../assets/GLB/Chip/' + FL[i].chip + '.glb', gltf => { state.chipTpls[i] = gltf.scene; if (done) done(); }, undefined, err => { chipLoading[i] = false; console.error('Chip GLB load failed', FL[i].chip, err); if (done) done(); });
  }
  function reset() {
    if (state.ph === 0) return;
    state.selDir = -1; state.selStart = performance.now() - (1 - state.selT) * 1400;
    clearParticles(); setPh(0);
  }
  function clearParticles() {
    (state.pts || []).forEach(p => { scene.remove(p); p.geometry.dispose(); p.material.dispose(); });
    state.pts = [];
    if (state.chips) { scene.remove(state.chips.group); state.chips = null; }
    state.cans.forEach(c => {
      c.lid.position.set(0, c.capRestY, 0); c.lid.rotation.set(0, 0, 0); c.lid.visible = true;
    });
  }
  function startBurst() { state.bAcc = 0; state.whipOn = false; state.wAcc = 0; state.ndc0 = null; state.canGone = false; buildParticles(); if (!state.chips) buildChips(); state.bT = performance.now(); setPh(5); }

  // One Powder grain from a flavour chip GLB: the baked layer is ~1000 copies of one small shape, so take the first connected piece,
  // centre it, scale its longest side to 1 and give it flat normals. Returns null if the chip model has no Powder mesh.
  const grainCache = new Map();
  function grainGeometry(tpl) {
    if (!tpl) return null;
    if (grainCache.has(tpl)) return grainCache.get(tpl);
    let mesh = null; tpl.traverse(o => { if (o.isMesh && /powder/i.test(o.name + o.parent.name)) mesh = mesh || o; });
    let out = null;
    if (mesh && mesh.geometry.index) {
      const pos = mesh.geometry.attributes.position, idx = mesh.geometry.index.array, set = new Set([idx[0], idx[1], idx[2]]);
      for (let grew = true; grew;) { grew = false; for (let i = 0; i < idx.length; i += 3) { const a = set.has(idx[i]), b = set.has(idx[i + 1]), c = set.has(idx[i + 2]); if ((a || b || c) && !(a && b && c)) { set.add(idx[i]); set.add(idx[i + 1]); set.add(idx[i + 2]); grew = true; } } }
      const tris = []; for (let i = 0; i < idx.length; i += 3) if (set.has(idx[i])) tris.push(idx[i], idx[i + 1], idx[i + 2]);
      const g = new T.BufferGeometry(); g.setAttribute('position', pos.clone()); g.setIndex(tris);
      out = g.toNonIndexed(); out.computeBoundingBox();
      const bb = out.boundingBox, c = bb.getCenter(new T.Vector3()), sz = bb.getSize(new T.Vector3()), k = 1 / Math.max(sz.x, sz.y, sz.z);
      out.translate(-c.x, -c.y, -c.z); out.scale(k, k, k); out.computeVertexNormals(); out.deleteAttribute('uv');
    }
    grainCache.set(tpl, out); return out;
  }

  function buildParticles() {
    const f = EX[state.sel], g = state.cans[state.sel].g;
    g.updateMatrixWorld(true);
    const origin = g.localToWorld(new T.Vector3(0, state.cans[state.sel].capRestY, 0));
    // uFall: distance fallen on the final screen; each particle falls 12 units below its rest spot, then shrinks away and
    // grows back in at the rest spot (not on the first pass, so nothing pops when the fall starts) - density stays even forever.
    // Falling keeps the grains tumbling. aType picks the grain shape: 0 crystal, 1 flake, 2 seed, 3 lump, 4 dust.
    // vGl: crystal glint - flashes as a face turns to the camera, plus a slow random twinkle on the final screen (uTw).
    const VS = 'uniform float uT,uClock,uTw,uPx,uFall;uniform vec3 uOrigin;attribute vec3 aDir,aRnd,aCol;attribute vec4 aSeed;attribute float aType;varying vec3 vC;varying float vTumble,vType,vPh,vA,vGl;void main(){float tt=max(uT-aSeed.x,0.);float k=1.7;vec3 p=uOrigin+aDir*(1.-exp(-k*tt))/k+aRnd*(1.-exp(-1.1*max(tt-.45,0.)))/1.1;float f=uFall*(.6+.13*aSeed.z),c=mod(f,12.);p.y-=c;float fade=smoothstep(12.,10.2,c)*(f<12.?1.:smoothstep(0.,1.8,c));vec4 mv=modelViewMatrix*vec4(p,1.);float vis=step(.0001,tt)*smoothstep(0.,.1,tt)*fade;gl_PointSize=aSeed.y*uPx/(-mv.z)*vis;gl_Position=projectionMatrix*mv;float s=tt+uFall*.8;vC=aCol;vPh=aSeed.z+s*(aSeed.w-.5)*9.;vTumble=abs(cos(aSeed.z*3.+s*(aSeed.w+.6)*5.));vType=aType;vA=aSeed.z;vGl=aType<.5?max(pow(vTumble,24.),uTw*step(.5,aSeed.w)*pow(max(0.,sin(uClock*(1.2+aSeed.z*.35)+aSeed.z*17.)),12.)):0.;}';
    const FS = `varying vec3 vC;varying float vTumble,vType,vPh,vA,vGl;
float h(float n){return fract(sin(n*12.9898)*43758.5453);}
void main(){
  vec2 u=gl_PointCoord-.5,c=u;float ca=cos(vPh),sa=sin(vPh);c=mat2(ca,-sa,sa,ca)*c;
  vec3 col=vC;float a;
  if(vType<.5){ // crystal: squashed square with four facets, whitening on glint
    c.y/=.35+.65*vTumble;float d=max(abs(c.x),abs(c.y));a=smoothstep(.36,.32,d)*(.82+.18*vGl);
    col*=c.x>c.y?(c.x>-c.y?1.05:.8):(c.x>-c.y?.92:.7);col=mix(col,vec3(1.),vGl*.9*smoothstep(.36,0.,d));
  }else if(vType<1.5){ // flake: angular shard (7 random corner radii), lit when facing the camera
    c.y/=.2+.8*vTumble;float an=atan(c.y,c.x)/6.2832*7.+3.5,i=floor(an);float r=.2+.16*mix(h(i+vA*9.),h(mod(i+1.,7.)+vA*9.),an-i);
    a=smoothstep(r,r-.03,length(c));col*=.6+.5*vTumble;
  }else if(vType<2.5){ // seed: small ellipse with a highlight
    c.x*=1.6;c.y/=.5+.5*vTumble;a=smoothstep(.32,.27,length(c));col*=.8+.4*smoothstep(.3,0.,length(u-vec2(-.08,-.1)));
  }else if(vType<3.5){ // lump: soft lumpy blob, lit from the top left
    float an=atan(u.y,u.x);float d=length(u)*(1.+.12*sin(an*3.+vA*9.)+.07*sin(an*5.+vA*4.));
    a=smoothstep(.42,.37,d);col*=.68+.45*smoothstep(.42,0.,length(u-vec2(-.1,-.12)));
  }else{ // dust: soft matte speck
    a=smoothstep(.5,.2,length(u))*.65;
  }
  if(a<.01)discard;
  gl_FragColor=vec4(col,a);
}`;
    // 3D grains: same flight/fall/tumble timing as VS, but a real mesh (size aSeed.y world units) with a simple key light. About 2/3 of the grains (vK)
    // are glassy: sharp specular highlights from three lights that flash whenever a facet tumbles to mirror a light toward the camera; the rest stay matte
    const VSG = 'uniform float uT,uFall,uVis;uniform vec3 uOrigin;attribute vec3 aDir,aRnd,aCol;attribute vec4 aSeed;varying vec3 vC,vN;varying float vK;void main(){float tt=max(uT-aSeed.x,0.);float k=1.7;vec3 p=uOrigin+aDir*(1.-exp(-k*tt))/k+aRnd*(1.-exp(-1.1*max(tt-.45,0.)))/1.1;float f=uFall*(.6+.13*aSeed.z),c=mod(f,12.);p.y-=c;float fade=smoothstep(12.,10.2,c)*(f<12.?1.:smoothstep(0.,1.8,c));vK=step(.33,fract(aSeed.z*7.13+aSeed.w*3.71));float sc=aSeed.y*step(.0001,tt)*smoothstep(0.,.1,tt)*fade*uVis;float s=tt+uFall*.8;float a=aSeed.z*6.283+s*(aSeed.w-.5)*9.,b=aSeed.w*6.283+s*(aSeed.z-.5)*7.,g=aSeed.x*17.+s*3.;mat3 rx=mat3(1.,0.,0.,0.,cos(a),sin(a),0.,-sin(a),cos(a)),ry=mat3(cos(b),0.,-sin(b),0.,1.,0.,sin(b),0.,cos(b)),rz=mat3(cos(g),sin(g),0.,-sin(g),cos(g),0.,0.,0.,1.);mat3 R=rz*ry*rx;vN=mat3(viewMatrix)*(R*normal);vC=aCol;gl_Position=projectionMatrix*viewMatrix*vec4(p+R*position*sc,1.);}';
    // glint flares: each shiny grain gets a hidden mirror facet (random local normal) that tumbles with it; whenever that facet reflects one of the
    // three lights toward the camera (vI), an additive cross-shaped flare blooms on the grain (up to ~.16 world units), so reflections read at any grain size
    const VSF = 'uniform float uT,uFall,uPx;uniform vec3 uOrigin;attribute vec3 aDir,aRnd;attribute vec4 aSeed;varying float vI,vA;void main(){float tt=max(uT-aSeed.x,0.);float k=1.7;vec3 p=uOrigin+aDir*(1.-exp(-k*tt))/k+aRnd*(1.-exp(-1.1*max(tt-.45,0.)))/1.1;float f=uFall*(.6+.13*aSeed.z),c=mod(f,12.);p.y-=c;float fade=smoothstep(12.,10.2,c)*(f<12.?1.:smoothstep(0.,1.8,c));float vis=step(.0001,tt)*smoothstep(0.,.1,tt)*fade;float s=tt+uFall*.8;float a=aSeed.z*6.283+s*(aSeed.w-.5)*9.,b=aSeed.w*6.283+s*(aSeed.z-.5)*7.,g=aSeed.x*17.+s*3.;mat3 rx=mat3(1.,0.,0.,0.,cos(a),sin(a),0.,-sin(a),cos(a)),ry=mat3(cos(b),0.,-sin(b),0.,1.,0.,sin(b),0.,cos(b)),rz=mat3(cos(g),sin(g),0.,-sin(g),cos(g),0.,0.,0.,1.);vec3 nl=normalize(vec3(fract(aSeed.z*91.7)-.5,fract(aSeed.w*57.3)-.5,fract(aSeed.x*33.1+aSeed.z*7.)-.5)+1e-3);vec3 n=normalize(mat3(viewMatrix)*(rz*ry*rx*nl)),v=vec3(0.,0.,1.);vec3 l1=normalize(vec3(-.4,.6,.7)),l2=normalize(vec3(.7,.25,.65)),l3=normalize(vec3(-.1,-.6,.8));float sp=pow(max(dot(n,normalize(l1+v)),0.),45.)+pow(max(dot(n,normalize(l2+v)),0.),45.)+pow(max(dot(n,normalize(l3+v)),0.),45.);vI=step(.33,fract(aSeed.z*7.13+aSeed.w*3.71))*smoothstep(0.,1.,min(sp,1.));vA=aSeed.z*6.283;vec4 mv=viewMatrix*vec4(p,1.);gl_PointSize=uPx*(.05+.13*vI)*vis/(-mv.z);gl_Position=projectionMatrix*mv;}';
    // glint look: tiny hot core + soft halo, long hairline streaks that taper away (two crossing pairs, the second fainter and turned ~35deg), random angle per grain
    const FSF = 'varying float vI,vA;float ray(vec2 q,float a,float w,float l){float c=cos(a),s=sin(a);vec2 r=vec2(c*q.x+s*q.y,-s*q.x+c*q.y);return exp(-abs(r.y)*w)*exp(-abs(r.x)*l);}void main(){vec2 q=(gl_PointCoord-.5)*2.;float d=length(q);float core=exp(-d*d*220.)*1.4+exp(-d*d*26.)*.22;float st=ray(q,vA,95.,2.6)+ray(q,vA+1.5708,95.,2.6)+.35*(ray(q,vA+.62,110.,4.)+ray(q,vA+2.19,110.,4.));float I=(core+st*.8)*vI*smoothstep(1.,.8,max(abs(q.x),abs(q.y)));gl_FragColor=vec4(1.,.96,.88,min(I,1.)*.6);}';
    const FSG = 'varying vec3 vC,vN;varying float vK;void main(){vec3 n=normalize(vN),v=vec3(0.,0.,1.),l1=normalize(vec3(-.4,.6,.7)),l2=normalize(vec3(.7,.25,.65)),l3=normalize(vec3(-.1,-.6,.8));float d=max(dot(n,l1),0.);float sp=pow(max(dot(n,normalize(l1+v)),0.),70.)+.8*pow(max(dot(n,normalize(l2+v)),0.),70.)+.6*pow(max(dot(n,normalize(l3+v)),0.),70.);float rim=pow(1.-max(dot(n,v),0.),3.);gl_FragColor=vec4(vC*(.35+.8*d)+vK*(vec3(sp*3.)+vC*rim*.4),1.);}';
    const r = Math.random, pick = l => l[Math.floor(r() * l.length)], rv = (s) => { s *= FLY; const th = r() * 6.283, z = r() * 2 - 1, q = Math.sqrt(1 - z * z); return [q * Math.cos(th) * s, q * Math.sin(th) * s, z * s * .5]; };
    // grains: dust first so the bigger bits draw over it; bits are split between the flavour's shapes by share
    const SHAPE = { crystal: 0, flake: 1, seed: 2, lump: 3 }, SIZE = [[.06, .06], [.08, .1], [.05, .03], [.06, .06]]; // per shape: min size, random extra
    const specs = [], share = f.bits.reduce((s, b) => s + b[1], 0);
    for (let i = 0; i < 6500; i++) specs.push({ bit: false, type: 4, col: pick(f.dust), size: .015 + r() * .025 });
    f.bits.forEach(([shape, w, cols]) => { const t = SHAPE[shape]; for (let i = 0; i < Math.round(520 * w / share); i++) specs.push({ bit: true, type: t, col: pick(cols), size: SIZE[t][0] + r() * SIZE[t][1] }); });
    // every grain (dust and bits) uses the flavour's own Powder grain (from its chip GLB) as a real lit 3D mesh; point sprites are only the fallback
    const grain = grainGeometry(state.chipTpls[state.sel]), isMesh = () => !!grain;
    const attribs = list => {
      const N = list.length, A = { N, P: new Float32Array(N * 3), D: new Float32Array(N * 3), Rn: new Float32Array(N * 3), S: new Float32Array(N * 4), C: new Float32Array(N * 3), Ty: new Float32Array(N) };
      list.forEach((sp, i) => {
        const ang = Math.PI / 4 + (r() + r() - 1) * .6, spd = sp.bit ? 7 + r() * 8 : 5 + r() * 12;
        A.D.set([Math.cos(ang) * spd * FLY, Math.sin(ang) * spd * FLY, (r() - .5) * (sp.bit ? 4 : 8) * FLY], i * 3);
        A.Rn.set(rv(sp.bit ? 1 + r() * 4 : .8 + r() * 6.5), i * 3);
        A.S.set([r() * .55, sp.size * (grain ? GRAIN : 1), r() * 6.28, r()], i * 4);
        const col = new T.Color(sp.col).multiplyScalar(.85 + r() * .3); // slight per-grain shade
        A.C.set([col.r, col.g, col.b], i * 3); A.Ty[i] = sp.type;
      });
      return A;
    };
    const setAttrs = (geo, A, inst) => {
      const add = (n, arr, k) => geo.setAttribute(n, inst ? new T.InstancedBufferAttribute(arr, k) : new T.BufferAttribute(arr, k));
      add('aDir', A.D, 3); add('aRnd', A.Rn, 3); add('aSeed', A.S, 4); add('aCol', A.C, 3); add('aType', A.Ty, 1);
    };
    const uniforms = () => ({ uVis: { value: 1 }, uT: { value: 0 }, uClock: { value: 0 }, uTw: { value: 0 }, uPx: { value: 1 }, uFall: { value: 0 }, uOrigin: { value: origin } });
    const A = attribs(specs.filter(sp => !isMesh(sp))), geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(A.P, 3)); setAttrs(geo, A, false);
    const pts = new T.Points(geo, new T.ShaderMaterial({ uniforms: uniforms(), vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false }));
    pts.frustumCulled = false; pts.renderOrder = 2; scene.add(pts);
    state.pts = [pts];
    const crystals = specs.filter(isMesh);
    if (crystals.length) {
      const B = attribs(crystals), ig = new T.InstancedBufferGeometry();
      ig.index = grain.index; ig.setAttribute('position', grain.attributes.position); ig.setAttribute('normal', grain.attributes.normal); ig.instanceCount = B.N; setAttrs(ig, B, true);
      const mesh = new T.Mesh(ig, new T.ShaderMaterial({ uniforms: uniforms(), vertexShader: VSG, fragmentShader: FSG }));
      mesh.frustumCulled = false; mesh.renderOrder = 2; scene.add(mesh); state.pts.push(mesh);
      const fg = new T.BufferGeometry(); fg.setAttribute('position', new T.BufferAttribute(new Float32Array(B.N * 3), 3)); setAttrs(fg, B, false);
      const flare = new T.Points(fg, new T.ShaderMaterial({ uniforms: uniforms(), vertexShader: VSF, fragmentShader: FSF, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
      flare.frustumCulled = false; flare.renderOrder = 3; scene.add(flare); state.pts.push(flare);
    }
  }

  // Big flying chips are real chip GLB meshes; they follow the same motion curve as the point shader (see VS above).
  // They are built when the lid pops and wait inside the can, all the same size and pose (like a real Pringles can: nested along the can's axis).
  // At the burst they shoot out one after another in a straight line along that axis (same speed, size and pose), and only then fan out to their own paths
  // while shrinking and tumbling (updateChips blends the line path into the scatter path). Each chip leaves the line at its own random time (SCATTER), so the cloud opens up unevenly.
  function buildChips() {
    if (!state.chipTpl && !state.chipTpls[state.sel]) return;
    if (state.chips) { scene.remove(state.chips.group); state.chips = null; }
    const r = Math.random, K = 1.7, W = .055, SIZE = .53; // W: Chip.glb native width in metres; SIZE: every chip's width except the hero's
    const tpl = state.chipTpls[state.sel] || state.chipTpl; // this flavour's own chip model, or the generic one if it hasn't loaded yet
    const bbox = new T.Box3().setFromObject(tpl), c = bbox.getCenter(new T.Vector3());
    const can = state.cans[state.sel], g = can.g; g.updateMatrixWorld(true);
    const origin = g.localToWorld(new T.Vector3(0, can.capRestY, 0)), stackRot = new T.Euler().setFromQuaternion(g.getWorldQuaternion(new T.Quaternion()));
    const axis = new T.Vector3(0, 1, 0).applyQuaternion(g.getWorldQuaternion(new T.Quaternion())).multiplyScalar(11 * FLY); // the can's axis, at the hero's launch speed
    const stackS = 2 * STACK.R * g.scale.x / .062; // the chip's long side (.062 m) spans the can's inner diameter
    const group = new T.Group(); group.visible = false; scene.add(group);
    const items = [];
    let lag = 0; // launch delay of chip i: the gaps start at STACK.GAP and shrink toward STACK.GAP_MIN, so the chips bunch up toward the back of the line
    for (let i = 0; i < 34; i++) {
      if (i) lag += STACK.GAP_MIN + (STACK.GAP - STACK.GAP_MIN) * Math.pow(STACK.GAP_DECAY, i - 1);
      const inner = tpl.clone(true); inner.position.copy(c).multiplyScalar(-1);
      const mesh = new T.Group(); mesh.add(inner); mesh.scale.setScalar(stackS); mesh.rotation.copy(stackRot); mesh.position.copy(g.localToWorld(new T.Vector3(0, can.capRestY - STACK.IN, 0)));
      group.add(mesh);
      const ang = Math.PI / 4 + (r() + r() - 1) * .6, spd = 8 + r() * 5, th = r() * 6.283, z = r() * 2 - 1, q = Math.sqrt(1 - z * z), rs = .8 + r() * 2.2;
      items.push({
        mesh, delay: i ? lag + r() * .003 : 0, sc: i ? SCATTER.at + r() * SCATTER.spread : .25, axisV: axis, start: mesh.position.clone(), s0: stackS, s1: (i ? SIZE : 1.6) / W,
        dir: new T.Vector3(Math.cos(ang) * spd, Math.sin(ang) * spd, (r() - .5) * 4),
        rnd: new T.Vector3(q * Math.cos(th) * rs, q * Math.sin(th) * rs, z * rs * .5),
        spin: new T.Vector3(r() - .5, r() - .5, r() - .5).multiplyScalar(9), rot0: mesh.rotation.clone()
      });
    }
    // items[0] is the hero: it launches first, is drawn larger, and the camera follows it until it rests centred, facing the viewer
    const hero = items[0], tEnd = BURST;
    items.forEach(o => { o.dir.multiplyScalar(FLY); o.rnd.multiplyScalar(FLY); });
    // flies straight up-right through the middle of the cloud, so the camera ends on it
    hero.dir.set(Math.SQRT1_2, Math.SQRT1_2, 0).multiplyScalar(11 * FLY); hero.rnd.set(0, 0, 0);
    hero.restRot = new T.Euler(Math.PI / 2 - .25, .2, .3);
    hero.end = hero.start.clone().addScaledVector(hero.dir, (1 - Math.exp(-K * tEnd)) / K); // fixed point the camera motion blur is measured against
    // final-screen layout: nudge each chip's resting spot (through its rnd offset, which only matters late in the flight) so no two chips
    // overlap as seen from the final camera, and none covers the hero. Done in screen space: x,y divided by depth, radius = size / depth.
    const H = hero.end, camZ = H.z + HERO_D;
    const nodes = items.map((o, i) => {
      const t = Math.max(tEnd - o.delay, 0), a = (1 - Math.exp(-K * t)) / K, b = (1 - Math.exp(-1.1 * Math.max(t - o.sc - .2, 0))) / 1.1;
      const p = o.start.clone().addScaledVector(o.dir, a).addScaledVector(o.rnd, b), d = Math.max(2, camZ - p.z);
      return { o, p, b, d, x: (p.x - H.x) / d, y: (p.y - H.y) / d, rad: (i ? SIZE : 1.6) * .6 / d, fixed: i === 0 };
    });
    for (let it = 0; it < 80; it++) {
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const A = nodes[i], B = nodes[j], dx = B.x - A.x, dy = B.y - A.y, dist = Math.hypot(dx, dy) || 1e-6, gap = A.rad + B.rad - dist;
        if (gap <= 0) continue;
        const wa = A.fixed ? 0 : B.fixed ? 1 : .5, wb = 1 - wa, ux = dx / dist, uy = dy / dist;
        A.x -= ux * gap * wa; A.y -= uy * gap * wa; B.x += ux * gap * wb; B.y += uy * gap * wb;
      }
    }
    nodes.forEach(n => { if (n.fixed) return; n.o.rnd.x += (H.x + n.x * n.d - n.p.x) / n.b; n.o.rnd.y += (H.y + n.y * n.d - n.p.y) / n.b; });
    state.chips = { group, items, origin, K };
  }

  const tmpV = new T.Vector3();
  function updateChips(bt) {
    const { items, origin, K } = state.chips;
    items.forEach(o => {
      const t = Math.max(bt - o.delay, 0), a = (1 - Math.exp(-K * t)) / K, b = (1 - Math.exp(-1.1 * Math.max(t - o.sc - .2, 0))) / 1.1, c = o.sc + .05; // o.sc: when this chip leaves the line; c: when it starts to shrink and tumble
      const sm = (x, n) => { x = Math.min(1, Math.max(0, x) / n); return x * x * (3 - 2 * x); }, sw = sm(t - c, o.restRot ? 1.4 : .9);
      o.mesh.position.copy(o.start).addScaledVector(tmpV.copy(o.axisV).lerp(o.dir, sm(t - o.sc, .75)), a).addScaledVector(o.rnd, b); // straight line first, then its own path (each chip leaves the line at its own random time)
      o.mesh.scale.setScalar(o.s0 + (o.s1 - o.s0) * sw); // from stack size to its final size
      if (o.restRot) { // from the stack pose, spinning down into the rest pose (blend weight sw)
        const rem = BURST * Math.pow(Math.max(0, 1 - t / BURST), 3), l = (a0, a1) => a0 + (a1 - a0) * sw;
        o.mesh.rotation.set(l(o.rot0.x, o.restRot.x + o.spin.x * rem), l(o.rot0.y, o.restRot.y + o.spin.y * rem), l(o.rot0.z, o.restRot.z + o.spin.z * rem));
        const q = state.heroRot, d = Math.PI / 180 * sw; o.mesh.rotateX(q.x * d); o.mesh.rotateY(q.y * d); o.mesh.rotateZ(q.z * d); // offset about the chip's own axes
      } else { const u = Math.min(Math.max(0, t - c), BURST - c), h = (u - u * u / (2 * (BURST - c))) * sm(t - c, .4); o.mesh.rotation.set(o.rot0.x + o.spin.x * h, o.rot0.y + o.spin.y * h, o.rot0.z + o.spin.z * h); } // no tumbling while in the line; the tumble slows to a stop as the burst ends
    });
  }

  // final screen: each chip turns in place about its own local axes with the cursor; m fades the effect in (0..1)
  function followCursor(m) {
    const a = FOLLOW * m * m * (3 - 2 * m);
    state.chips.items.forEach(o => { o.mesh.rotateY(state.cx * a); o.mesh.rotateX(state.cy * a); });
  }

  // blur target is full-res so it matches the direct render when the blur fades out
  function resize() { const w = host.clientWidth, h = host.clientHeight; R.setSize(w, h); const dbs = R.getDrawingBufferSize(new T.Vector2()); whipRT.setSize(dbs.x, dbs.y); cam.aspect = w / h; state.camZ = Math.max(8, 8 * 1.7 / cam.aspect); cam.position.set(0, 0, state.camZ); cam.updateProjectionMatrix(); }

  function findAncestorCan(obj) {
    let o = obj;
    while (o) { const idx = state.cans.findIndex(c => c.g === o); if (idx >= 0) return idx; o = o.parent; }
    return -1;
  }

  function wireInput() {
    resize(); addEventListener('resize', resize);
    const onWheel = e => { if (getState().view !== 'main' || state.loading) return; e.preventDefault(); const t = performance.now(); state.acc += e.deltaY + e.deltaX; if (Math.abs(state.acc) > 40 && t > state.lock) { const wait = state.ph === 0 ? 800 : 450; scrollStep(Math.sign(state.acc)); state.acc = 0; state.lock = Math.max(state.lock, t + wait); } };
    const onKey = e => { if (getState().view !== 'main' || state.loading) return; if (e.key === 'Escape') return reset(); if (state.ph > 0) { if (['ArrowDown', 'ArrowRight', ' '].includes(e.key)) scrollStep(1); return; } if (e.key === 'ArrowRight' || e.key === 'ArrowDown') step(1); if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') step(-1); };
    let t0 = null;
    const onTS = e => { t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
    const onTM = e => {
      if (!t0 || getState().view !== 'main' || state.loading) return;
      const dx = t0.x - e.touches[0].clientX, dy = t0.y - e.touches[0].clientY, d = Math.abs(dx) > Math.abs(dy) ? dx : dy, t = performance.now();
      if (Math.abs(d) > 40) { t0 = null; if (t > state.lock) { const wait = state.ph === 0 ? 800 : 450; scrollStep(Math.sign(d)); state.lock = Math.max(state.lock, t + wait); } }
    };
    addEventListener('wheel', onWheel, { passive: false }); addEventListener('keydown', onKey);
    addEventListener('touchstart', onTS, { passive: true }); addEventListener('touchmove', onTM, { passive: true }); addEventListener('touchend', () => { t0 = null; });
    addEventListener('pointermove', e => { if (e.pointerType !== 'mouse') return; state.tx = e.clientX / innerWidth * 2 - 1; state.ty = e.clientY / innerHeight * 2 - 1; });
    const ray = new T.Raycaster(), mv = new T.Vector2();
    host.addEventListener('click', e => {
      if (state.loading) return;
      const r = host.getBoundingClientRect(); mv.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(mv, cam);
      const hit = ray.intersectObjects(state.cans.map(c => c.g), true)[0]; if (!hit) return;
      const i = findAncestorCan(hit.object); if (i < 0) return;
      let k = ((i - state.target) % n + n) % n; if (k > n / 2) k -= n;
      if (state.ph > 0 || state.sel >= 0) return; if (Math.round(k) === 0) select(i); else step(Math.round(k));
    });
  }

  function start() {
    const TB = BURST;
    const ease = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    const TW = 800, MAXTILT = 8 * Math.PI / 180;
    const slide = cubicBezier(.16, 1, .3, 1);
    const ss = (x, n) => { x = Math.min(1, Math.max(0, x) / n); return x * x * (3 - 2 * x); }; // smoothstep over [0, n]
    const glide = cubicBezier(.4, 0, .2, 1); // leaving the final screen: the camera eases off, then settles at the lineup's view
    const chase = cubicBezier(.7, 0, .15, 1); // whip pan: long held wind-up, a sudden snap through the middle, quick landing
    const ndc = new T.Vector3(), blurT = new T.Vector2(), frustum = new T.Frustum(), projM = new T.Matrix4(), canBox = new T.Box3();
    const loop = () => {
      state.raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(.1, (now - (state.last || now)) / 1000); state.last = now;
      const kt = 1 - Math.exp(-dt * 8); state.cx += (state.tx - state.cx) * kt; state.cy += (state.ty - state.cy) * kt;
      state.pos = state.twFrom + (state.target - state.twFrom) * slide(Math.min(1, (now - state.tw0) / TW));
      const cc = ((Math.round(state.target) % n) + n) % n; if (cc !== getState().center) setState({ center: cc });
      if (state.sel >= 0) {
        const d = (now - state.selStart) / 1400;
        state.selT = state.selDir > 0 ? Math.min(1, d) : Math.max(0, 1 - d);
        if (state.selDir < 0 && state.selT === 0) state.sel = -1;
        if (state.ph === 1 && state.selT === 1) setPh(2);
      }
      if (state.ph === 3 && now - state.lidT > 900) setPh(4);
      const hh = Math.tan(16 * Math.PI / 180) * state.camZ, hw = hh * cam.aspect, e = ease(state.selT);
      const S = 3.6, mx = -hw * .4, my = -hh * .5, cx = mx - .7071 * .8 * S, cy = my - .7071 * .8 * S;
      state.cans.forEach((c, i) => {
        const k = wrapK(i), ak = Math.abs(k), g = c.g;
        let s = 1.6 / (1 + .28 * ak), px = k * 1.9, py = -Math.sin(k * 1.2) * 1.1, rz = Math.cos(k * 1.2) * .08, rx = pitch(c, ak), ry = -k * .06, br = .03 + .97 * Math.exp(-ak * ak * 1.1);
        const isSel = i === state.sel;
        if (isSel) { const f = state.from; px = f.x + (cx - f.x) * e; py = f.y + (cy - f.y) * e; s = f.s + (S - f.s) * e; rz = f.rz + (-Math.PI / 4 - f.rz) * e; rx = f.rx * (1 - e); ry = f.ry * (1 - e); br = 1; }
        else if (state.sel >= 0) s *= (1 - e);
        if (!isSel) {
          // slow float + mouse tilt (max 8deg) + one full turn per carousel step, all fading out while a can is selected
          const free = 1 - e, spin = Math.max(-1, Math.min(1, state.target - state.pos)) * Math.PI * 2;
          const mot = reduce ? 0 : 1;
          py += Math.sin(now / 1000 * .9 + i * 1.3) * .05 * free * mot;
          rx += state.cy * MAXTILT * free * mot; ry += (state.cx * MAXTILT + spin) * free * mot;
        }
        g.position.set(px, py, CENTER_Z * Math.max(0, 1 - ak) * (1 - e)); g.scale.setScalar(Math.max(s, .0001)); g.rotation.set(rx, ry, rz);
        g.visible = ak < 3 && s > .01;
        c.lab.map = c.tex[isSel && state.selT > 0 ? 1 : 0]; c.lab.color.setScalar(br);
        c.dim.forEach(d => d.m.color.copy(d.c).multiplyScalar(br));
        c.lidGlints.forEach(m => m.color.setScalar(LID_GLINT.strength * br)); // the lid highlights dim with the can
        if (isSel && state.ph >= 3) {
          // the lid shoots straight up the can's axis as it is for LID_STRAIGHT s, then curves away: it drifts sideways (quadratically, so the bend is smooth) and tumbles
          const t = (now - state.lidT) / 1000, v = 25 * t * t, u = Math.max(0, t - LID_STRAIGHT);
          c.lid.position.set(LID_DRIFT.x * u * u, c.capRestY + v, LID_DRIFT.z * u * u);
          c.lid.rotation.set(u * LID_SPIN.x, u * LID_SPIN.y, u * LID_SPIN.z);
          c.lid.visible = t < .9;
        }
      });
      // studio lights move from their rest focus (0, STUDIO_FY) onto the lid end (mx,my) of the selected can
      // z follows the centred can's pull toward the camera so the can-to-light distance stays as before
      // on the final screen (fc: 0..1, eased) they leave the lid end and focus on the hero chip instead
      state.fc += ((state.ph === 6 ? 1 : 0) - state.fc) * (1 - Math.exp(-dt * 2.5));
      if (Math.abs(state.fc - (state.ph === 6 ? 1 : 0)) < 1e-3) state.fc = state.ph === 6 ? 1 : 0;
      const mxe = mx * (1 - state.fc), mye = my * (1 - state.fc);
      rig.position.set(mxe * e + state.camHero.x * state.camP, (mye - STUDIO_FY) * e + state.camHero.y * state.camP, CENTER_Z * (1 - e) + state.camHero.z * state.camP);
      // flavour glow centre slides from screen centre (50%, 54%) to the selected can (bottom-left)
      setGlow('--gs', 1 + .8 * e);
      setGlow('--mx', reduce ? 0 : state.cx.toFixed(3)); setGlow('--my', reduce ? 0 : state.cy.toFixed(3)); // smoothed cursor, morphs the glow
      setGlow('--gx', ((50 + cx / hw * 50 * e) * (1 - state.fc) + 50 * state.fc) + '%'); // fc: on the final screen the glow moves to the hero chip (screen centre)
      setGlow('--gy', ((54 + ((50 - cy / hh * 50) - 54) * e) * (1 - state.fc) + 50 * state.fc) + '%');
      if (spot) spot.color.lerp(spotTarget.copy(spotBase).lerp(tint.set(FL[cc].color), .3), .06);
      let bt = 0, tw = 0, fall = 0;
      if (state.ph >= 5) {
        // burst clock: its speed follows the burst speed curve (BURST_SPEED; by default slow motion at the launch, so the chips shooting out in a line can be seen)
        if (state.ph === 5) state.bAcc = Math.min(TB, state.bAcc + dt * RATE * speedAt(state.bAcc / TB));
        bt = state.bAcc;
        if (state.ph === 5 && bt >= TB) { state.frz = now; setPh(6); }
        if (state.ph === 6) {
          const tf = (now - state.frz) / 1000;
          tw = Math.min(1, tf / 1.2);
          if (!reduce) fall = FALL * (tf - (1 - Math.exp(-tf))); // fall speed eases up from 0
        }
      }
      const px = R.domElement.height / (2 * Math.tan(cam.fov * Math.PI / 360));
      state.pts.forEach(p => { const u = p.material.uniforms; u.uT.value = bt; u.uClock.value = now / 1000; u.uTw.value = tw; u.uPx.value = px; u.uFall.value = fall; });
      if (state.chips) { updateChips(bt); state.chips.group.visible = state.ph >= 5; } // the stack only shows from the burst on, not while the lid is off and the can waits
      // burst: whip pan - the aim swings to the hero chip first and the camera body follows (both eased in and out), with a brief
      // FOV widening at top speed; it then stays locked on the chip as it settles centred, with the chip cloud and particles around it
      const burst = state.ph >= 5 && state.chips;
      // the camera stays put until the hero chip crosses WHIP_AT on screen; the pan then runs on its own clock at the burst speed curve's pace
      // (its end value once the burst clock has stopped at BURST), since a late start would otherwise freeze the pan half way
      if (burst && !state.whipOn) { ndc.copy(state.chips.items[0].mesh.position).project(cam); if (ndc.x >= WHIP_AT) state.whipOn = true; }
      if (burst && state.whipOn) state.wAcc += dt * RATE * speedAt(state.bAcc / TB);
      const w = state.whipOn ? Math.min(1, state.wAcc / WHIP) : 0;
      let L;
      if (burst) {
        state.camP = chase(w); L = state.whipOn ? 1 : 0; // the aim is on the hero chip from the first frame of the pan (chip dead centre), the body follows on its own soft curve
        state.camHero.copy(state.chips.items[0].mesh.position);
        if (state.ph === 6 && !reduce) followCursor(tw);
      }
      else if (state.leave) { // straight down onto the lineup: the view was moved above it (startExit), so only the height and the distance change
        state.camP = 1 - glide(Math.min(1, (now - state.leave.t0) / 1000 / EXIT.time)); L = state.camP;
      }
      else { state.camP *= Math.exp(-dt * 6); L = state.camP; }
      if (state.camP < 1e-3) state.camP = 0;
      const H = state.camHero, P = state.camP;
      const rt = burst ? (now - state.bT) / 1000 : 0, pulse = 0; // no launch punch: the chips just pop out of the can; rt: real seconds since the burst
      const fov = burst ? 32 + 100 * P * (1 - P) : 32; // wider mid-swing
      if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
      cam.position.set(H.x * P, H.y * P, state.camZ + (H.z + HERO_D - state.camZ) * P);
      if (P > 0 || L > 0) cam.lookAt(H.x * L, H.y * L, H.z * L); else cam.rotation.set(0, 0, 0);
      cam.updateMatrixWorld();
      // motion blur = screen-space velocity of a fixed point in the cloud, measured before the shake is added
      blurT.set(0, 0);
      if (burst) {
        const hero = state.chips.items[0];
        ndc.copy(hero.end).project(cam);
        if (state.ndc0 && dt > 0) blurT.set(ndc.x - state.ndc0.x, ndc.y - state.ndc0.y).multiplyScalar(.5 * SHUTTER / dt).clampLength(0, .7);
        state.ndc0 = (state.ndc0 || new T.Vector3()).copy(ndc);
        // the can drops out once the camera has left it behind, so the final frame is just chips, particles and text
        const can = state.cans[state.sel].g;
        if (!state.canGone) { frustum.setFromProjectionMatrix(projM.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)); state.canGone = !frustum.intersectsBox(canBox.setFromObject(can)); }
        if (state.canGone) can.visible = false;
      }
      blurT.multiplyScalar(burst ? ss(bt - .12, .3) : 1); // the can stays sharp as the chips pop out; the whip blur builds from there
      state.blur.lerp(blurT, 1 - Math.exp(-dt * 25));
      // lens effect: colour fringing follows the camera speed, centred on the hero chip
      const bl = state.blur.length(), ca = Math.min(.02, bl * .04);
      if (burst) { ndc.copy(state.chips.items[0].mesh.position).project(cam); whipMat.uniforms.uC.value.set(ndc.x * .5 + .5, ndc.y * .5 + .5); }
      whipMat.uniforms.uDir.value.copy(state.blur); whipMat.uniforms.uCA.value = ca;
      state.kick *= .9;
      cam.position.x += state.kick * Math.sin(now * .06); cam.position.y += state.kick * Math.cos(now * .05);
      if (burst) { // camera body: recoil on launch, faint handheld drift, tilt through the whip, a small shake on the punch
        const amp = Math.min(1, rt * 2);
        cam.position.x += .05 * amp * (Math.sin(now * .0007) + .5 * Math.sin(now * .0013 + 2)); cam.position.y += .04 * amp * (Math.sin(now * .0009 + 1) + .5 * Math.sin(now * .0017));
        cam.position.z += .9 * pulse;
        cam.rotateZ(.4 * Math.sin(Math.PI * w) + .012 * amp * Math.sin(now * .0008) + .03 * pulse * Math.sin(now * .045));
      }
      if (state.leave) { // the kept chips and powder shrink away at the start of the descent, so they are gone before the lineup comes into view
        const lv = state.leave, x = (now - lv.t0) / 1000 / EXIT.time, k = 1 - ss(x, EXIT.shrink);
        lv.chips.items.forEach(o => o.mesh.scale.setScalar(o.leaveScale * k));
        lv.chips.group.visible = k > 0;
        lv.pts.forEach(p => { const u = p.material.uniforms; u.uPx.value = px * k; u.uVis.value = k; p.visible = k > 0; });
        if (x >= EXIT.ui && document.body.classList.contains('hold-ui')) { document.body.classList.remove('hold-ui'); document.body.classList.add('ui-in'); } // text and arrows fade in
        if (x >= 1) { // arrived: drop them for good
          scene.remove(lv.chips.group); lv.pts.forEach(p => { scene.remove(p); p.geometry.dispose(); p.material.dispose(); });
          state.leave = null; document.body.classList.remove('is-exiting');
        }
      }
      if (bl > .002 || ca > .0004) { R.setRenderTarget(whipRT); R.render(scene, cam); R.setRenderTarget(null); R.render(whipScene, whipCam); }
      else R.render(scene, cam);
    };
    loop();
  }

  function cubicBezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    return x => {
      if (x <= 0) return 0; if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) {
        const err = ((ax * t + bx) * t + cx) * t - x, d = (3 * ax * t + 2 * bx) * t + cx;
        if (Math.abs(err) < 1e-5 || Math.abs(d) < 1e-6) break;
        t = Math.min(1, Math.max(0, t - err / d));
      }
      return ((ay * t + by) * t + cy) * t;
    };
  }

  function buildCans(template) {
    // The GLB's native unit scale doesn't match the original procedural can
    // (radius .5, height 1.5) that all the carousel/select/particle math below
    // was tuned against. Normalize every clone to that same height so the rest
    // of the file's constants (camera distance, select scale, pop-arc offsets...)
    // keep working unchanged.
    const bbox = new T.Box3().setFromObject(template);
    const size = new T.Vector3(); bbox.getSize(size);
    const center = new T.Vector3(); bbox.getCenter(center);
    const scale = 1.5 / size.y;

    const imgLoader = new T.ImageLoader();
    // random resting pitch per can: half show their top (+), half their underside (-); reshuffled on every page load
    const pitchSign = [1, 1, 1, -1, -1, -1].sort(() => Math.random() - .5);
    // highlight picture for the lid (white on black, like the light on a glass sphere); used as a matcap, so it is shared by all the cans
    const glintUrl = '../assets/IMAGE/glass-sphere-highlight.png';
    const glintTex = new T.TextureLoader().load(glintUrl, undefined, undefined, err => console.error('Lid highlight image failed to load', glintUrl, err));
    glintTex.encoding = T.sRGBEncoding;
    state.cans = FL.map((f, i) => {
      const rx0 = pitchSign[i % pitchSign.length] * (.08 + Math.random() * .2);
      // Baked label unwrap; same UV layout as the GLB's embedded label texture (flipY=false).
      const bakeTex = new T.Texture();
      bakeTex.encoding = T.sRGBEncoding; bakeTex.flipY = false; bakeTex.anisotropy = 8;
      // simple dev servers can drop parallel requests, so retry a few times before giving up
      const bakeUrl = encodeURI('../assets/Bake/' + f.bake + '_BaseColor.webp');
      const bakeDone = preloadDone();
      const loadBake = left => imgLoader.load(bakeUrl, img => { bakeTex.image = img; bakeTex.needsUpdate = true; bakeDone(); }, undefined,
        () => { if (left > 0) setTimeout(() => loadBake(left - 1), 500); else { console.error('Label texture failed to load', bakeUrl); bakeDone(); } });
      loadBake(4);
      const tex = [bakeTex, bakeTex];

      const inner = template.clone(true);
      // each can needs its own materials so side cans can be dimmed independently
      inner.traverse(o => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone(); });
      inner.scale.setScalar(scale);
      inner.position.copy(center).multiplyScalar(-scale);

      const body = inner.getObjectByName('Body');
      const cap = inner.getObjectByName('Cap');
      // light reflection on the lid: a copy of the lid drawn on top with the highlight picture as a matcap (the surface direction picks the spot in the picture,
      // so the highlights hug the lid's rim and move as it tilts or tumbles). Added on top, so the picture's black adds nothing and only its white shows.
      const lidGlint = new T.MeshMatcapMaterial({ matcap: glintTex, transparent: true, ...GLINT_BLEND, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      lidGlint.color.setScalar(LID_GLINT.strength);
      const lidMeshes = []; cap.traverse(o => { if (o.isMesh) lidMeshes.push(o); });
      // the flat top of the lid gets the picture as it is, fitted over the disc (a matcap alone shows little on a face that looks sideways)
      const lidTop = new T.MeshBasicMaterial({ map: glintTex, transparent: true, ...GLINT_BLEND, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      lidTop.color.setScalar(LID_GLINT.strength);
      lidMeshes.forEach(o => {
        const m = new T.Mesh(o.geometry, lidGlint); m.renderOrder = 1; o.add(m);
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox, size = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / LID_GLINT.circle;
        const top = new T.Mesh(new T.PlaneGeometry(size, size).rotateX(-Math.PI / 2), lidTop); // lying flat, facing up the can's axis
        top.position.set((b.max.x + b.min.x) / 2, b.max.y + .0001, (b.max.z + b.min.z) / 2); top.renderOrder = 1; o.add(top);
      });

      // The glTF "Body" mesh has 2 primitives (Body_Aluminum rim + Body_Label);
      // three.js's GLTFLoader gives each primitive its own child Mesh rather than
      // one Mesh with a material array, so find the label sub-mesh by material name.
      const lab = new T.MeshStandardMaterial({ map: tex[0], roughness: .42, metalness: .18 });
      body.traverse(o => {
        if (!o.isMesh) return;
        if (Array.isArray(o.material)) {
          const idx = o.material.findIndex(m => m.name === 'Body_Label');
          if (idx >= 0) { const arr = o.material.slice(); arr[idx] = lab; o.material = arr; }
        } else if (o.material && o.material.name === 'Body_Label') {
          o.material = lab;
        }
      });

      const dim = [];
      inner.traverse(o => { if (o.isMesh) [].concat(o.material).forEach(m => { if (m !== lab) dim.push({ m, c: m.color.clone() }); }); });

      const g = new T.Group();
      g.add(inner);
      scene.add(g);
      g.updateMatrixWorld(true);
      // Re-parent the lid onto g (preserving its world transform) so its local
      // position is expressed directly in g's frame, same as the original's
      // procedural lid mesh — this is what makes the .78/25*t*t-style pop-arc
      // constants below meaningful regardless of the GLB's native scale.
      g.attach(cap);

      const capRestY = cap.position.y;
      return { g, body, lab, tex, lid: cap, capRestY, dim, rx0, lidGlints: [lidGlint, lidTop] };
    });
  }

  function init() {
    const loader = new T.GLTFLoader(), studioDone = preloadDone(), chipDone = preloadDone(), canDone = preloadDone();
    loader.load('../assets/GLB/Studio_Setup.glb', gltf => {
      const g = gltf.scene; g.scale.setScalar(SS); g.position.set(0, SY, SZ);
      g.traverse(o => { if (o.isLight) { o.intensity = LI.Spot; spot = o; } if (o.isMesh) o.visible = false; }); // studio meshes hidden, lights kept
      rig.add(g);
      studioDone();
    }, undefined, err => { console.error('Studio GLB load failed', err); studioDone(); });
    loader.load('../assets/GLB/Chip.glb', gltf => { state.chipTpl = gltf.scene; chipDone(); }, undefined, err => { console.error('Chip GLB load failed', err); chipDone(); });
    loader.load('../assets/GLB/Pringo_V2.glb', gltf => {
      buildCans(gltf.scene);
      wireInput();
      start();
      canDone();
    }, undefined, err => { console.error('GLB load failed', err); canDone(); });
    FL.forEach((f, i) => loadChip(i, preloadDone()));
  }

  // The first-time work of the lid pop and the burst, done once per flavour behind the loading screen (it also compiles the shaders and sends the models to the GPU):
  // building the chips and the powder, then drawing a frame with them, then taking them away again. One flavour per animation frame, so the screen stays alive.
  async function warmUp() {
    const nextFrame = () => new Promise(r => requestAnimationFrame(r));
    for (let i = 0; i < FL.length; i++) {
      if (!state.cans || !state.chipTpls[i]) continue;
      state.sel = i; // only for the length of this block: no frame is drawn in between
      try {
        buildParticles(); buildChips();
        if (state.chips) state.chips.group.visible = true;
        R.compile(scene, cam); R.render(scene, cam);
        if (i === 0) { R.setRenderTarget(whipRT); R.render(scene, cam); R.setRenderTarget(null); R.render(whipScene, whipCam); } // the whip-blur pass
      } catch (err) { console.error('Warm-up failed', FL[i].name, err); }
      clearParticles(); state.sel = -1;
      await nextFrame();
    }
  }

  return { init, select, reset, scrollStep, getSel: () => state.sel, ready, release: () => { state.loading = false; } };
}
