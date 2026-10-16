/** Оформление знака радиационной угрозы. null — соответствующий элемент не рисуется. */
export interface SignPalette {
  /** Фон-диск знака. */
  disc: string | null;
  /** Цвет трёх лопастей и центрального круга. */
  blade: string;
  /** Обводка диска. */
  ring: string | null;
  /** Мягкое свечение вокруг диска. */
  glow?: string | null;
  /** Острые лучи вокруг диска (зловещий вариант). */
  spikes?: string | null;
}

/**
 * Рисует знак радиационной угрозы («трилистник») в квадратный холст size×size.
 * Одна лопасть смотрит вниз, две — вверх влево и вправо.
 */
export function drawRadiationSign(c: CanvasRenderingContext2D, size: number, p: SignPalette) {
  const cx = size / 2, cy = size / 2;
  const R = size * (p.spikes ? 0.34 : 0.44);
  const TAU = Math.PI * 2;

  c.clearRect(0, 0, size, size);

  if (p.glow) {
    c.fillStyle = p.glow;
    c.beginPath(); c.arc(cx, cy, size * 0.5, 0, TAU); c.fill();
  }

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
    c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill();
  }
  if (p.ring) {
    c.strokeStyle = p.ring;
    c.lineWidth = Math.max(1, size * 0.045);
    c.beginPath(); c.arc(cx, cy, R - c.lineWidth / 2, 0, TAU); c.stroke();
  }

  const rOut = R * 0.8, rIn = R * 0.27;
  c.fillStyle = p.blade;
  for (let k = 0; k < 3; k++) {
    const a = Math.PI / 2 + (k * TAU) / 3;
    c.beginPath();
    c.arc(cx, cy, rOut, a - Math.PI / 6, a + Math.PI / 6);
    c.arc(cx, cy, rIn, a + Math.PI / 6, a - Math.PI / 6, true);
    c.closePath();
    c.fill();
  }
  c.beginPath(); c.arc(cx, cy, R * 0.14, 0, TAU); c.fill();
}
