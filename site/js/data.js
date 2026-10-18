// Flavor data + procedural label/character canvas drawing (no DOM/Three deps beyond canvas 2D).

const INK = '#1b1612';
const CREAM = '#efe7d6';

// glowMix: the five glow colours of a flavour - [0] main, [1] dark base, [2] bright core, [3] accent, [4] highlight
// glowWhite (optional, 0..1): pulls the glow's colours toward white for a paler, whiter tone
const FL = [
  { name: 'Original', glowMix: ['#7c3aed', '#101014', '#f7f5ff', '#2563eb', '#ffffff'], bake: 'ORIGINAL', chip: 'Chip_Original_v2', tag: 'Sea salt. Nothing else.', color: '#2f5bd0', glowColor: '#ffffff', glowWhite: .6, tint: '#cdd8ef', pat: 'stripes', glow: '#2f5bd055' },
  { name: 'Hot & Spicy', glowMix: ['#e9254c', '#211216', '#faf4f6', '#e7753c', '#b4f3d5'], bake: 'HOT&SPICY', chip: 'Chip_HotSpicy_v2', tag: 'Crushed chili, slow heat.', color: '#d8341f', tint: '#f0c6b6', pat: 'chevron', glow: '#d8341f55' },
  { name: 'Cheese', glowMix: ['#f59e0b', '#101827', '#f8fafc', '#38bdf8', '#fef3c7'], bake: 'Cheese', chip: 'Chip_Cheese_v2', tag: 'Cheese powder, melted gold.', color: '#FFC300', tint: '#F58A07', pat: 'dots', glow: '#FFC30055' },
  { name: 'Sour Cream', glowMix: ['#122116', '#25e939', '#f4faf6', '#3ce7c5', '#c1e1f5'], bake: 'SOUR CREAM', chip: 'Chip_SourCream_v2', tag: 'Cool, tangy, green.', color: '#2f9a62', tint: '#cbe3cf', pat: 'waves', glow: '#2f9a6255' },
  { name: 'Sweet', glowMix: ['#f9f4fa', '#a125e9', '#1d1221', '#e73cae', '#d3f3b4'], bake: 'Sweet', chip: 'Chip_Sweet_v2', tag: 'Sugar crystals, soft and bright.', color: '#F7C6D9', tint: '#BDE0FE', pat: 'rays', glow: '#F7C6D955' },
  { name: 'Wasabi', glowMix: ['#6ae925', '#152112', '#f6faf4', '#3ce778', '#eccbe1'], bake: 'Wasabi', chip: 'Chip_Wasabi_v2', tag: 'Wasabi dust, sharp and clean.', color: '#A7D129', tint: '#3A7D44', pat: 'checks', glow: '#A7D12955' }
];

// Burst seasoning per flavour: dust = fine powder colours; bits = [shape (crystal | flake | seed | lump), share, colours].
const EX = [
  { dust: ['#ffffff', '#f4f2ec', '#e8ecf2'], bits: [['crystal', 1, ['#ffffff', '#f1f4f8', '#e2e8ef']]], intro: 'Freshly fried potato flavor with just a pinch of salt, the classic of classics. Sparkling salt crystals pop in your mouth and bring out the natural taste of the potato.', ingr: ['Potato', 'Palm Oil', 'Rice Flour', 'Corn Starch', 'Salt', 'Dextrose'] },
  { dust: ['#c92a14', '#e0461e', '#a51e0e', '#d9622a'], bits: [['flake', .75, ['#d8231a', '#e8461f', '#b3170f', '#f06a2a']], ['seed', .25, ['#f2d58a', '#e8c46a']]], intro: 'Coated generously with red chili powder for a fiery flavor. It starts crisp, then the heat builds up, so you can’t stop reaching for more.', ingr: ['Potato', 'Palm Oil', 'Rice Flour', 'Chili Powder', 'Garlic Powder', 'Paprika Extract (Color)', 'Salt'] },
  { dust: ['#ffb20f', '#f59a0a', '#ffd04a', '#ff8f1a'], bits: [['lump', 1, ['#ffc21f', '#f7a50f', '#ffd75a']]], intro: 'Loaded with rich cheese powder for a deep, savory flavor. The golden powder coats every chip evenly, making each one full and satisfying.', ingr: ['Potato', 'Palm Oil', 'Rice Flour', 'Cheese Powder', 'Whey Powder', 'Carotene (Color)', 'Salt'] },
  { dust: ['#f7f3e6', '#efe9d6', '#ffffff'], bits: [['flake', .6, ['#3f8f3a', '#2f7a33', '#5aa548']], ['flake', .4, ['#f3ead0', '#e8dcb8']]], intro: 'A cool, refreshing flavor where the tang of smooth cream meets the fragrance of herbs. Every bite leaves a bright, lingering finish.', ingr: ['Potato', 'Palm Oil', 'Rice Flour', 'Sour Cream Powder', 'Onion Powder', 'Parsley', 'Salt'] },
  { dust: ['#ffffff', '#fdf0f5', '#eef6ff'], bits: [['crystal', 1, ['#ffffff', '#F7C6D9', '#BDE0FE', '#fff4f8']]], intro: 'A sweet, crispy chip sparkling with sugar crystals. A gentle sweetness meets the savory taste of potato for a snack unlike any other.', ingr: ['Potato', 'Palm Oil', 'Rice Flour', 'Sugar', 'Vanilla Flavor', 'Corn Starch', 'Salt'] },
  { dust: ['#a7d129', '#8fbf2a', '#c4e25a', '#7aa830'], bits: [['flake', 1, ['#3a7d44', '#4f9a3a', '#6bb33a']]], intro: 'The sharp aroma of wasabi tingles right up your nose. A spicy yet refreshing kick meets the crunchy texture for a clean, bright finish.', ingr: ['Potato', 'Palm Oil', 'Rice Flour', 'Wasabi Powder', 'Soy Sauce Powder', 'Green Tea Powder', 'Salt'] }
];

function drawChar(ctx, cx, cy, s, color, surprised) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
  ctx.fillStyle = INK; ctx.strokeStyle = INK; ctx.lineCap = 'round';
  const ey = surprised ? -0.68 : -0.62;
  if (surprised) {
    [-1, 1].forEach(sg => {
      ctx.beginPath(); ctx.arc(sg * 0.36, ey, 0.17, 0, 7); ctx.fillStyle = '#fffaf0'; ctx.fill();
      ctx.lineWidth = 0.04; ctx.stroke();
      ctx.beginPath(); ctx.arc(sg * 0.36, ey + 0.01, 0.06, 0, 7); ctx.fillStyle = INK; ctx.fill();
    });
  } else {
    ctx.beginPath(); ctx.arc(-0.34, ey, 0.1, 0, 7); ctx.fill();
    ctx.lineWidth = 0.055; ctx.beginPath(); ctx.moveTo(0.22, ey + 0.02); ctx.quadraticCurveTo(0.34, ey - 0.16, 0.46, ey + 0.02); ctx.stroke();
  }
  ctx.translate(0, surprised ? -0.05 : 0); ctx.scale(1, surprised ? 1.5 : 1.38);
  ctx.fillStyle = color;
  [1, -1].forEach(sg => {
    ctx.save(); ctx.scale(sg, 1); ctx.beginPath();
    ctx.moveTo(0, -0.2); ctx.bezierCurveTo(0.35, -0.42, 0.85, -0.4, 1.05, -0.14);
    ctx.bezierCurveTo(1.15, 0, 1.32, -0.06, 1.3, -0.3); ctx.bezierCurveTo(1.55, -0.1, 1.42, 0.3, 0.95, 0.32);
    ctx.bezierCurveTo(0.6, 0.34, 0.3, 0.2, 0.1, 0.1); ctx.lineTo(0, 0.1); ctx.closePath(); ctx.fill(); ctx.restore();
  });
  ctx.restore();
}

function pattern(ctx, W, H, f) {
  ctx.fillStyle = CREAM; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = f.tint; ctx.strokeStyle = f.tint; ctx.lineWidth = 14;
  const p = f.pat;
  if (p === 'stripes') for (let x = 0; x < W; x += 64) ctx.fillRect(x, 0, 28, H);
  if (p === 'chevron') for (let y = 0; y < H + 80; y += 70) { ctx.beginPath(); for (let x = 0; x <= W; x += 64) ctx.lineTo(x, y + ((x / 64) % 2 ? 30 : 0)); ctx.stroke(); }
  if (p === 'dots') for (let y = 20; y < H; y += 56) for (let x = ((y / 56) % 2) * 28; x < W; x += 56) { ctx.beginPath(); ctx.arc(x, y, 14, 0, 7); ctx.fill(); }
  if (p === 'waves') for (let y = 20; y < H; y += 56) { ctx.beginPath(); for (let x = 0; x <= W; x += 8) ctx.lineTo(x, y + Math.sin(x / 40) * 14); ctx.stroke(); }
  if (p === 'rays') { for (let i = 0; i < 48; i++) { ctx.beginPath(); ctx.moveTo(W * (i / 48), 0); ctx.lineTo(W * ((i + .5) / 48), 0); ctx.lineTo(W * ((i + .5) / 48) + (i % 2 ? 40 : -40), H); ctx.lineTo(W * (i / 48) + (i % 2 ? 40 : -40), H); ctx.fill(); } }
  if (p === 'checks') for (let y = 0; y < H; y += 56) for (let x = 0; x < W; x += 56) if (((x + y) / 56) % 2 === 0) ctx.fillRect(x, y, 56, 56);
}

function labelCanvas(f, surprised) {
  const W = 2048, H = 980, c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  pattern(ctx, W, H, f);
  ctx.fillStyle = f.color; ctx.fillRect(0, 0, W, 90); ctx.fillRect(0, H - 90, W, 90);
  ctx.fillStyle = INK; ctx.textAlign = 'center';
  ctx.font = '700 84px "Instrument Sans", Helvetica, sans-serif';
  if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '26px';
  ctx.fillText('PRINGO', 1024, 245);
  drawChar(ctx, 1024, 560, 190, f.color, surprised);
  ctx.font = '700 58px "Instrument Sans", Helvetica, sans-serif';
  if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '10px';
  ctx.fillText(f.name.toUpperCase(), 1024, 860);
  const id = ctx.getImageData(0, 0, W, H), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - .5) * 18; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  ctx.putImageData(id, 0, 0);
  return c;
}
