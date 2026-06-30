import { useEffect, useRef } from "react";

interface HazeFieldProps {
  color: string;
}

interface Blob {
  x: number;
  y: number;
  r: number;
  vy: number;
  drift: number;
  phase: number;
  alpha: number;
}

// Drifting smog field, drawn on a 2D canvas. The blob tint follows the worst
// air-quality band currently on the board. Renders a static first frame even
// before animation, and stops on prefers-reduced-motion.
export function HazeField({ color }: HazeFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorRef = useRef(color);
  colorRef.current = color;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const blobs: Blob[] = [];

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const make = (): Blob => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 80 + Math.random() * 160,
      vy: 0.08 + Math.random() * 0.22,
      drift: 0.2 + Math.random() * 0.5,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.05 + Math.random() * 0.10,
    });

    resize();
    for (let i = 0; i < 26; i++) blobs.push(make());

    const hexToRgb = (hex: string) => {
      const m = hex.replace("#", "");
      const n = parseInt(m.length === 3 ? m.split("").map((c) => c + c).join("") : m, 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    };

    const draw = (t: number) => {
      const { r, g, b } = hexToRgb(colorRef.current);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (const blob of blobs) {
        const cx = blob.x + Math.sin(t * 0.0003 + blob.phase) * 40 * blob.drift;
        const grad = ctx.createRadialGradient(cx, blob.y, 0, cx, blob.y, blob.r);
        grad.addColorStop(0, `rgba(${r},${g},${b},${blob.alpha})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, blob.y, blob.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    };

    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const tick = (t: number) => {
      for (const blob of blobs) {
        blob.y -= blob.vy;
        if (blob.y + blob.r < 0) {
          blob.y = h + blob.r;
          blob.x = Math.random() * w;
        }
      }
      draw(t);
      raf = requestAnimationFrame(tick);
    };

    draw(0);
    if (!reduce) raf = requestAnimationFrame(tick);

    const ro = new ResizeObserver(() => { resize(); draw(0); });
    ro.observe(canvas);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <canvas ref={canvasRef} className="hazefield" aria-hidden="true" />;
}
