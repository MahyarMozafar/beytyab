// Draw one verse as a picture (1080 × 1920, the size of a phone story) and
// hand it to the phone's share sheet, or download it on a computer.

export const SITE_ADDRESS = 'sher.mahyarmozafar.ir';

const WIDTH = 1080;
const HEIGHT = 1920;
const COLORS = {
  paper: '#f5ead0',
  paperEdge: '#e2cc9c',
  ink: '#37210f',
  inkSoft: '#6a4b2f',
  gold: '#b8892b',
  goldLight: '#d9b65a',
  lapis: '#1f3f7a',
  lapisDeep: '#17305f',
  rose: '#a2412c',
};

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function diamond(ctx, x, y, size) {
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size, y);
  ctx.closePath();
  ctx.fill();
}

// Break a line into several so that none is wider than maxWidth.
function wrap(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawFrame(ctx) {
  const paper = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  paper.addColorStop(0, '#f8efd9');
  paper.addColorStop(0.5, COLORS.paper);
  paper.addColorStop(1, '#efe0bc');
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // darker edges, like old paper
  const edge = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, HEIGHT * 0.3, WIDTH / 2, HEIGHT / 2, HEIGHT * 0.72);
  edge.addColorStop(0, 'rgba(150,105,45,0)');
  edge.addColorStop(1, 'rgba(150,105,45,0.32)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // lapis band with gold lines and gold diamonds
  const inset = 56;
  const band = 30;
  ctx.fillStyle = COLORS.lapis;
  ctx.fillRect(inset, inset, WIDTH - 2 * inset, band);
  ctx.fillRect(inset, HEIGHT - inset - band, WIDTH - 2 * inset, band);
  ctx.fillRect(inset, inset, band, HEIGHT - 2 * inset);
  ctx.fillRect(WIDTH - inset - band, inset, band, HEIGHT - 2 * inset);
  ctx.strokeStyle = COLORS.goldLight;
  ctx.lineWidth = 3;
  ctx.strokeRect(inset, inset, WIDTH - 2 * inset, HEIGHT - 2 * inset);
  ctx.strokeRect(inset + band, inset + band, WIDTH - 2 * (inset + band), HEIGHT - 2 * (inset + band));
  ctx.fillStyle = COLORS.goldLight;
  const gap = 44;
  for (let x = inset + band + gap / 2; x < WIDTH - inset - band; x += gap) {
    diamond(ctx, x, inset + band / 2, 6);
    diamond(ctx, x, HEIGHT - inset - band / 2, 6);
  }
  for (let y = inset + band + gap / 2; y < HEIGHT - inset - band; y += gap) {
    diamond(ctx, inset + band / 2, y, 6);
    diamond(ctx, WIDTH - inset - band / 2, y, 6);
  }
  ctx.strokeStyle = COLORS.gold;
  ctx.lineWidth = 2;
  ctx.strokeRect(inset + band + 14, inset + band + 14, WIDTH - 2 * (inset + band + 14), HEIGHT - 2 * (inset + band + 14));
}

function drawHeadpiece(ctx) {
  const w = 620;
  const h = 190;
  const x = (WIDTH - w) / 2;
  const y = 210;
  ctx.fillStyle = COLORS.lapisDeep;
  roundedRect(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.strokeStyle = COLORS.goldLight;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = 'rgba(217,182,90,0.5)';
  for (let px = x + 22; px < x + w - 10; px += 28) {
    for (let py = y + 22; py < y + h - 10; py += 28) {
      ctx.beginPath();
      ctx.arc(px, py, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = '#f8efd9';
  roundedRect(ctx, x + 40, y + 28, w - 80, h - 56, (h - 56) / 2);
  ctx.fill();
  ctx.strokeStyle = COLORS.goldLight;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = COLORS.lapisDeep;
  ctx.font = '700 76px Nastaliq';
  ctx.textAlign = 'center';
  ctx.fillText('بیت‌یاب', WIDTH / 2, y + h / 2 + 14);
}

function drawRule(ctx, y) {
  ctx.strokeStyle = COLORS.gold;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(WIDTH / 2 - 220, y);
  ctx.lineTo(WIDTH / 2 - 24, y);
  ctx.moveTo(WIDTH / 2 + 24, y);
  ctx.lineTo(WIDTH / 2 + 220, y);
  ctx.stroke();
  ctx.fillStyle = COLORS.gold;
  diamond(ctx, WIDTH / 2, y, 10);
}

async function drawCard(verse) {
  // The verse font must be ready before it can be painted on a canvas.
  await Promise.all([
    document.fonts.load('700 76px Nastaliq', 'بیت‌یاب'),
    document.fonts.load('400 66px Nastaliq', verse.m1 + verse.m2),
    document.fonts.load('600 40px Vazirmatn', verse.poet),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  ctx.direction = 'rtl';
  ctx.textBaseline = 'middle';

  drawFrame(ctx);
  drawHeadpiece(ctx);

  // the verse: first half-line to the right, second to the left
  const maxWidth = 720;
  let size = 66;
  let first;
  let second;
  for (;;) {
    ctx.font = `400 ${size}px Nastaliq`;
    first = wrap(ctx, verse.m1, maxWidth);
    second = wrap(ctx, verse.m2, maxWidth);
    // Best: each half-line on one line. Shrink the text until that works.
    if (first.length + second.length <= 2 || size <= 46) break;
    size -= 4;
  }
  const lineHeight = size * 2.75;
  const total = (first.length + second.length) * lineHeight;
  let y = 1000 - total / 2 + lineHeight / 2;
  ctx.fillStyle = COLORS.ink;
  ctx.textAlign = 'right';
  for (const line of first) {
    ctx.fillText(line, WIDTH - 150, y);
    y += lineHeight;
  }
  ctx.textAlign = 'left';
  for (const line of second) {
    ctx.fillText(line, 150, y);
    y += lineHeight;
  }

  drawRule(ctx, Math.max(y + 10, 1380));
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.rose;
  ctx.font = '800 46px Vazirmatn';
  ctx.fillText(verse.poet, WIDTH / 2, Math.max(y + 100, 1470));
  ctx.fillStyle = COLORS.inkSoft;
  ctx.font = '500 32px Vazirmatn';
  const source = wrap(ctx, `${verse.book}، ${String(verse.title).split(' - ')[0]}`, 760)[0];
  ctx.fillText(source, WIDTH / 2, Math.max(y + 168, 1538));

  ctx.direction = 'ltr';
  ctx.fillStyle = COLORS.lapis;
  ctx.font = '600 34px Vazirmatn';
  ctx.fillText(SITE_ADDRESS, WIDTH / 2, HEIGHT - 170);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no image'))), 'image/png');
  });
}

// Returns 'shared' or 'saved'.
export async function shareVerse(verse) {
  const blob = await drawCard(verse);
  const file = new File([blob], 'beytyab.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'بیت‌یاب' });
      return 'shared';
    } catch (error) {
      if (error.name === 'AbortError') return 'shared'; // the visitor closed the sheet
    }
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'beytyab.png';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  return 'saved';
}
