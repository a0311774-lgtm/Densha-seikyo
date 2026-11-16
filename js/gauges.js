// Canvas tachometer and speedometer. 240° sweep from 8 o'clock to 4 o'clock.

const THEME = {
  amber: "rgb(255, 184, 56)",
  needle: "rgb(255, 82, 31)",
  teal: "rgb(97, 230, 214)",
  warning: "rgb(242, 56, 46)",
  tick: "rgb(224, 230, 235)",
  muted: "rgba(255, 255, 255, 0.45)",
  metal: "rgb(46, 48, 56)",
  faceInner: "rgb(31, 33, 41)",
  faceOuter: "rgb(13, 14, 18)",
};

function angleFor(value, max) {
  const t = Math.min(1, Math.max(0, value / max));
  return ((150 + 240 * t) * Math.PI) / 180;
}

function point(cx, cy, radius, angle) {
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}

function setupCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const css = canvas.getBoundingClientRect();
  const side = Math.max(1, Math.min(css.width, css.height));
  const w = Math.round(side * dpr);
  const h = Math.round(side * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, side, dpr };
}

function drawBezel(ctx, cx, cy, radius) {
  const g = ctx.createRadialGradient(cx, cy, radius * 0.08, cx, cy, radius);
  g.addColorStop(0, THEME.faceInner);
  g.addColorStop(1, THEME.faceOuter);
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 10, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  const ring = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
  ring.addColorStop(0, "rgba(255,255,255,0.28)");
  ring.addColorStop(0.45, "rgba(255,255,255,0.05)");
  ring.addColorStop(1, "rgba(255,255,255,0.18)");
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 8, 0, Math.PI * 2);
  ctx.strokeStyle = ring;
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function strokeArc(ctx, cx, cy, radius, startVal, endVal, max, color, width) {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, angleFor(startVal, max), angleFor(endVal, max), false);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "butt";
  ctx.stroke();
}

function drawNeedle(ctx, cx, cy, radius, angle, color, width, tail) {
  const tip = point(cx, cy, radius - 8, angle);
  const back = point(cx, cy, -tail, angle);
  ctx.beginPath();
  ctx.moveTo(back.x, back.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.stroke();
}

export function drawTachometer(canvas, { rpm, redline, isShifting }) {
  const { ctx, side } = setupCanvas(canvas);
  ctx.clearRect(0, 0, side, side);
  const cx = side / 2;
  const cy = side / 2;
  const radius = side * 0.42;
  const maxRPM = 8000;
  const value = Math.min(maxRPM, Math.max(0, rpm));

  if (rpm >= redline * 0.92) {
    ctx.shadowColor = "rgba(242, 56, 46, 0.55)";
    ctx.shadowBlur = 16;
  } else if (isShifting) {
    ctx.shadowColor = "rgba(255, 184, 56, 0.35)";
    ctx.shadowBlur = 12;
  } else {
    ctx.shadowBlur = 0;
  }
  drawBezel(ctx, cx, cy, radius);
  ctx.shadowBlur = 0;

  strokeArc(ctx, cx, cy, radius + 6, 0, maxRPM, maxRPM, THEME.metal, 10);
  strokeArc(ctx, cx, cy, radius + 6, 6500, maxRPM, maxRPM, "rgba(242, 56, 46, 0.85)", 10);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let v = 0; v <= maxRPM; v += 250) {
    const major = v % 1000 === 0;
    const ang = angleFor(v, maxRPM);
    const outer = point(cx, cy, radius + 1, ang);
    const inner = point(cx, cy, radius - (major ? 16 : 8), ang);
    ctx.beginPath();
    ctx.moveTo(inner.x, inner.y);
    ctx.lineTo(outer.x, outer.y);
    ctx.strokeStyle = v >= 6500 ? THEME.warning : major ? "rgba(224,230,235,0.9)" : "rgba(224,230,235,0.4)";
    ctx.lineWidth = major ? 2.2 : 1;
    ctx.lineCap = "butt";
    ctx.stroke();
    if (major) {
      const label = point(cx, cy, radius - 30, ang);
      ctx.fillStyle = v >= 6500 ? THEME.warning : THEME.tick;
      ctx.font = `600 ${Math.max(11, side * 0.055)}px "SF Pro Rounded", "PingFang HK", ui-rounded, system-ui, sans-serif`;
      ctx.fillText(String(v / 1000), label.x, label.y);
    }
  }

  const rpmColor = rpm >= redline * 0.92 ? THEME.warning : THEME.amber;
  ctx.fillStyle = rpmColor;
  ctx.font = `600 ${side * 0.16}px "SF Pro Rounded", "PingFang HK", ui-rounded, system-ui, sans-serif`;
  ctx.fillText(String(Math.round(Math.max(0, rpm))), cx, cy + side * 0.13);
  ctx.fillStyle = THEME.muted;
  ctx.font = `500 ${side * 0.055}px "SF Pro Rounded", "PingFang HK", ui-rounded, system-ui, sans-serif`;
  ctx.letterSpacing = "1.5px";
  ctx.fillText("RPM", cx, cy + side * 0.205);
  ctx.letterSpacing = "0px";

  drawNeedle(ctx, cx, cy, radius, angleFor(value, maxRPM), THEME.needle, 3, 12);
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fillStyle = THEME.tick;
  ctx.fill();
}

export function drawSpeedometer(canvas, { speedKmh, usingLiveGPS }) {
  const { ctx, side } = setupCanvas(canvas);
  ctx.clearRect(0, 0, side, side);
  const cx = side / 2;
  const cy = side / 2;
  const radius = side * 0.42;
  const maxSpeed = 220;
  const value = Math.min(maxSpeed, Math.max(0, speedKmh));

  drawBezel(ctx, cx, cy, radius);
  strokeArc(ctx, cx, cy, radius + 6, 0, maxSpeed, maxSpeed, THEME.metal, 10);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let v = 0; v <= maxSpeed; v += 10) {
    const major = v % 20 === 0;
    const ang = angleFor(v, maxSpeed);
    const outer = point(cx, cy, radius + 1, ang);
    const inner = point(cx, cy, radius - (major ? 16 : 8), ang);
    ctx.beginPath();
    ctx.moveTo(inner.x, inner.y);
    ctx.lineTo(outer.x, outer.y);
    ctx.strokeStyle = major ? "rgba(224,230,235,0.9)" : "rgba(224,230,235,0.35)";
    ctx.lineWidth = major ? 2.2 : 1;
    ctx.lineCap = "butt";
    ctx.stroke();
    if (major) {
      const label = point(cx, cy, radius - 30, ang);
      ctx.fillStyle = THEME.tick;
      ctx.font = `600 ${Math.max(9, side * 0.046)}px "SF Pro Rounded", "PingFang HK", ui-rounded, system-ui, sans-serif`;
      ctx.fillText(String(v), label.x, label.y);
    }
  }

  ctx.fillStyle = THEME.amber;
  ctx.font = `600 ${side * 0.22}px "SF Pro Rounded", "PingFang HK", ui-rounded, system-ui, sans-serif`;
  ctx.fillText(String(Math.round(Math.max(0, speedKmh))), cx, cy + side * 0.1);
  ctx.fillStyle = THEME.muted;
  ctx.font = `500 ${side * 0.055}px "SF Pro Rounded", "PingFang HK", ui-rounded, system-ui, sans-serif`;
  ctx.fillText("km/h", cx, cy + side * 0.175);
  if (usingLiveGPS) {
    ctx.fillStyle = THEME.teal;
    ctx.font = `600 ${side * 0.04}px "SF Pro Rounded", "PingFang HK", ui-rounded, system-ui, sans-serif`;
    ctx.fillText("GPS", cx, cy + side * 0.225);
  }

  drawNeedle(ctx, cx, cy, radius, angleFor(value, maxSpeed), "rgba(255,255,255,0.92)", 3.2, 14);
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fillStyle = THEME.needle;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
}
