import * as THREE from 'three';

const CANVAS_W = 512;
const CANVAS_H = 128;

export function createLabel(text, opts = {}) {
  const {
    fontSize = 36,
    color = '#ffffff',
    bg = 'rgba(8,8,20,0.85)',
    border = 'rgba(255,255,255,0.25)',
    scaleX = 1.8,
    scaleY = 0.45,
    frame = true,
    shadow = true,
  } = opts;

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');

  _drawLabel(ctx, text, { fontSize, color, bg, border, frame, shadow });

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const mat = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(scaleX, scaleY, 1);
  sprite.userData.canvas = canvas;
  sprite.userData.ctx = ctx;
  sprite.userData.opts = { fontSize, color, bg, border, scaleX, scaleY, frame, shadow };
  return sprite;
}

export function updateLabel(sprite, text) {
  const { ctx, opts } = sprite.userData;
  if (!ctx) return;
  _drawLabel(ctx, text, opts);
  sprite.material.map.needsUpdate = true;
}

function _drawLabel(ctx, text, { fontSize, color, bg, border, frame, shadow }) {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  if (frame) {
    // Background rounded rect
    ctx.fillStyle = bg;
    roundRect(ctx, 6, 6, CANVAS_W - 12, CANVAS_H - 12, 14);
    ctx.fill();

    // Border
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    roundRect(ctx, 6, 6, CANVAS_W - 12, CANVAS_H - 12, 14);
    ctx.stroke();
  }

  // Text
  ctx.fillStyle = color;
  ctx.font = `bold ${fontSize}px 'Helvetica Neue', Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = shadow ? 'rgba(0,0,0,0.75)' : 'transparent';
  ctx.shadowBlur = shadow ? 12 : 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = shadow ? 2 : 0;

  // Truncate if too long
  let label = text;
  while (ctx.measureText(label).width > CANVAS_W - 40 && label.length > 2) {
    label = label.slice(0, -1);
  }
  if (label !== text) label += '…';

  ctx.fillText(label, CANVAS_W / 2, CANVAS_H / 2);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
