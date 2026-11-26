// TinyBots avatars v2 — состояние, цвет и взгляд за курсором. Без зависимостей.
export const STATES = ["idle", "thinking", "talking", "happy", "error", "sleep"];

export function setState(el, state) { el.dataset.state = STATES.includes(state) ? state : "idle"; }
export function setColor(el, color) {
  if (color) el.dataset.color = color
  else delete el.dataset.color
}

// Делает id градиентов уникальными, если один аватар инлайнится несколько раз.
let seq = 0;
export function uniquify(svgText) {
  const n = ++seq;
  return svgText.replace(/id="([^"]+)"/g, 'id="$1-' + n + '"').replace(/url\(#([^)]+)\)/g, "url(#$1-" + n + ")");
}

// Взгляд и наклон к курсору. Только для аватаров >= 44px, не во сне, не при reduced motion.
export function followPointer(root = document) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
  let x = 0, y = 0, raf = 0, idle = 0;
  const reset = () => root.querySelectorAll(".tb-av2[data-follow]").forEach(el => {
    el.removeAttribute("data-follow"); ["--px", "--py", "--plean"].forEach(v => el.style.removeProperty(v));
  });
  const tick = () => {
    raf = 0;
    root.querySelectorAll(".tb-av2").forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.bottom < 0 || r.top > innerHeight || el.dataset.state === "sleep") return;
      const dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 260);
      el.setAttribute("data-follow", "");
      el.style.setProperty("--px", (dx / d * 1.7 * k).toFixed(2) + "px");
      el.style.setProperty("--py", (dy / d * 1.4 * k).toFixed(2) + "px");
      el.style.setProperty("--plean", Math.max(-5, Math.min(5, dx / 60)).toFixed(1) + "deg");
    });
  };
  const move = e => {
    x = e.clientX; y = e.clientY; raf ||= requestAnimationFrame(tick);
    clearTimeout(idle); idle = setTimeout(reset, 2500);
  };
  addEventListener("pointermove", move, { passive: true });
  return () => { removeEventListener("pointermove", move); clearTimeout(idle); reset(); };
}
