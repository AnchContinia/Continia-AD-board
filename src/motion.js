// JS mirror of the Continia motion tokens (motion/README.md in the design system).
// Every duration and easing in the 3D scene comes from here — never a literal.

export const motion = {
  duration: {
    instant: 100,
    fast: 150,
    base: 250,
    moderate: 400,
    slow: 600,
    slower: 800,
  },
  ease: {
    standard: [0.2, 0, 0, 1],
    out: [0.16, 1, 0.3, 1],
    in: [0.7, 0, 0.84, 0],
    inOut: [0.65, 0, 0.35, 1],
  },
};

export function prefersReducedMotion() {
  const forced = document.documentElement.dataset.motion;
  if (forced === 'reduced') return true;
  if (forced === 'full') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Cubic-bezier easing, same curve the CSS tokens describe.
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t) => (3 * ax * t + 2 * bx) * t + cx;

  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-5) break;
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    t = Math.min(1, Math.max(0, t));
    return sampleY(t);
  };
}

export const ease = {
  standard: cubicBezier(...motion.ease.standard),
  out: cubicBezier(...motion.ease.out),
  in: cubicBezier(...motion.ease.in),
  inOut: cubicBezier(...motion.ease.inOut),
};
