const root = document.documentElement;

// Neon blue → neon pink
const start = { r: 0, g: 229, b: 255 };
const end   = { r: 255, g: 62,  b: 201 };

let t = 0;
let direction = 1;
let rafId = null;

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function updateAccent() {
  t += direction * 0.0025;

  if (t >= 1 || t <= 0) direction *= -1;

  const r = lerp(start.r, end.r, t);
  const g = lerp(start.g, end.g, t);
  const b = lerp(start.b, end.b, t);

  root.style.setProperty("--accent", `rgb(${r}, ${g}, ${b})`);
  rafId = requestAnimationFrame(updateAccent);
}

function startAccentPulse() {
  if (rafId) return;
  rafId = requestAnimationFrame(updateAccent);
}

function stopAccentPulse() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopAccentPulse();
  } else {
    startAccentPulse();
  }
});

startAccentPulse();
