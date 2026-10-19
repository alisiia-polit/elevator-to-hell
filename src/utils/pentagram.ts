/** Оформление знака «перевёрнутая пентаграмма». null — соответствующий элемент не рисуется. */
export interface PentagramPalette {
  /** Фон-диск знака. */
  disc: string | null;
  /** Цвет линий звезды. */
  line: string;
  /** Круг вокруг звезды (он же обводка диска). */
  ring: string | null;
  /** Свечение линий. */
  glow?: string | null;
  /** Острые лучи вокруг диска (зловещий вариант). */
  spikes?: string | null;
  /** Толщина линий в долях размера холста (по умолчанию 0.045). */
  lineWidth?: number;
}

const TAU = Math.PI * 2;

/**
 * Контур перевёрнутой пентаграммы с центром (cx, cy) и радиусом R: одна вершина строго внизу,
 * остальные обходятся «через одну». Путь только строится — заливку и обводку делает вызывающий.
 */
export function pentagramPath(c: CanvasRenderingContext2D, cx: number, cy: number, R: number) {
  c.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = Math.PI / 2 + (i * 2 * TAU) / 5; // ось y холста направлена вниз, поэтому π/2 — вершина внизу
    const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.closePath();
}

/** Рисует перевёрнутую пентаграмму в круге в квадратный холст size×size. */
export function drawPentagramSign(c: CanvasRenderingContext2D, size: number, p: PentagramPalette) {
  const cx = size / 2, cy = size / 2;
  const R = size * (p.spikes ? 0.34 : 0.44);
  const lw = Math.max(1, size * (p.lineWidth ?? 0.045));

  c.clearRect(0, 0, size, size);
  c.save();
  c.lineJoin = "miter";
  c.lineCap = "round";

  if (p.spikes) {
    c.fillStyle = p.spikes;
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const len = i % 2 === 0 ? size * 0.5 : size * 0.42;
      c.beginPath();
      c.moveTo(cx + Math.cos(a - 0.1) * R, cy + Math.sin(a - 0.1) * R);
      c.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      c.lineTo(cx + Math.cos(a + 0.1) * R, cy + Math.sin(a + 0.1) * R);
      c.closePath();
      c.fill();
    }
  }

  if (p.disc) {
    c.fillStyle = p.disc;
    c.beginPath();
    c.arc(cx, cy, R, 0, TAU);
    c.fill();
  }

  if (p.glow) {
    c.shadowColor = p.glow;
    c.shadowBlur = size * 0.08;
  }
  c.lineWidth = lw;

  // Вершины звезды лежат на круге: кольцо проходит по ним.
  const starR = R - lw * 0.9;
  if (p.ring) {
    c.strokeStyle = p.ring;
    c.beginPath();
    c.arc(cx, cy, starR, 0, TAU);
    c.stroke();
  }
  c.strokeStyle = p.line;
  pentagramPath(c, cx, cy, starR);
  c.stroke();
  c.restore();
}
