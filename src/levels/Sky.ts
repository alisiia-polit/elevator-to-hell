import { Color3, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { canvasTexture, noise, rng } from "../utils/textures";

/**
 * Положение луны относительно камеры: она всегда видна в одном направлении.
 * Расстояние и азимут прежние, высота над горизонтом ≈ 46° (раньше ≈ 61°).
 */
export const MOON_POSITION = new Vector3(-86.5, 189.7, -158.5);

const MOON_RADIUS = 14;

/** Перевёрнутая пентаграмма в круге (одна вершина смотрит вниз) — знак на луне. */
function drawInvertedPentagram(c: CanvasRenderingContext2D, size: number) {
  const cx = size / 2, cy = size / 2, R = size * 0.44;
  c.clearRect(0, 0, size, size);
  c.strokeStyle = "#5a0b0b";
  c.fillStyle = "rgba(60,8,8,0.35)";
  c.lineWidth = size * 0.045;
  c.lineJoin = "miter";

  c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill(); c.stroke();

  // Звезда через одну вершину; первая вершина внизу.
  c.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = Math.PI / 2 + (i * 4 * Math.PI) / 5;
    const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.closePath();
  c.lineWidth = size * 0.035;
  c.stroke();
}

/** Разлом на луне: светящаяся трещина с ответвлениями, без знака радиации. */
function drawMoonRift(c: CanvasRenderingContext2D, size: number) {
  const r = rng(11);
  c.clearRect(0, 0, size, size);
  c.save();
  c.beginPath(); c.arc(size / 2, size / 2, size * 0.49, 0, Math.PI * 2); c.clip();
  c.lineJoin = "round"; c.lineCap = "round";

  const crack = (x0: number, y0: number, x1: number, y1: number, steps: number, spread: number) => {
    const pts: [number, number][] = [[x0, y0]];
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      pts.push([x0 + (x1 - x0) * t + (r() - 0.5) * spread, y0 + (y1 - y0) * t + (r() - 0.5) * spread]);
    }
    pts.push([x1, y1]);
    return pts;
  };
  const stroke = (pts: [number, number][], w: number, color: string, blur: number) => {
    c.strokeStyle = color; c.lineWidth = w; c.shadowColor = "#ff3a10"; c.shadowBlur = blur;
    c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke();
  };

  const s = size / 128;
  const main = crack(14 * s, 6 * s, 114 * s, 122 * s, 9, 20 * s);
  const branchA = crack(main[3][0], main[3][1], 118 * s, 30 * s, 5, 14 * s);
  const branchB = crack(main[6][0], main[6][1], 10 * s, 96 * s, 5, 14 * s);
  for (const pts of [main, branchA, branchB]) stroke(pts, 8 * s, "rgba(255,70,20,0.85)", 14 * s);
  for (const pts of [main, branchA, branchB]) stroke(pts, 3.5 * s, "#140403", 0);
  c.restore();
}

/** Звёздное небо и луна для крыши. Следуют за камерой (infiniteDistance) и не затуманиваются. */
export function createSky(scene: Scene) {
  const unlit = (name: string, emissive: Color3 | null, tex?: ReturnType<typeof canvasTexture>["tex"]) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = Color3.Black(); m.specularColor = Color3.Black();
    if (emissive) m.emissiveColor = emissive;
    if (tex) m.emissiveTexture = tex;
    m.backFaceCulling = false; m.fogEnabled = false;
    return m;
  };

  // Небо: градиент и звёзды.
  const st = canvasTexture(scene, 1024, 512);
  const c = st.ctx, r = rng(777);
  const g = c.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#03040c"); g.addColorStop(0.5, "#1a2140"); g.addColorStop(1, "#05060e");
  c.fillStyle = g; c.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 1100; i++) {
    const b = (110 + r() * 145) | 0;
    c.fillStyle = `rgb(${b},${b},${Math.min(255, b + 25)})`;
    c.fillRect((r() * 1024) | 0, (r() * 512) | 0, 1, 1);
  }
  c.fillStyle = "#ffffff";
  for (let i = 0; i < 70; i++) c.fillRect((r() * 1024) | 0, (r() * 420) | 0, 2, 2);
  st.tex.update();
  const sky = MeshBuilder.CreateSphere("sky", { diameter: 800, segments: 24 }, scene);
  sky.material = unlit("sky_mat", null, st.tex);
  sky.infiniteDistance = true; sky.isPickable = false; sky.applyFog = false;

  // Луна: пятна «морей» и ореол. Расположена высоко, чтобы быть видна из-за высоких стен.
  const mt = canvasTexture(scene, 64, 64);
  noise(mt.ctx, rng(5), [226, 227, 212], 16, 64);
  mt.ctx.fillStyle = "rgba(150,152,140,0.55)";
  for (let i = 0; i < 9; i++) { mt.ctx.beginPath(); mt.ctx.arc(r() * 64, r() * 64, 4 + r() * 6, 0, Math.PI * 2); mt.ctx.fill(); }
  mt.tex.update();
  const moon = MeshBuilder.CreateSphere("moon", { diameter: 28, segments: 12 }, scene);
  const moonMaterial = unlit("moon_mat", null, mt.tex);
  moon.material = moonMaterial;
  const halo = MeshBuilder.CreateSphere("moon_halo", { diameter: 44, segments: 12 }, scene);
  const hm = unlit("halo_mat", new Color3(0.35, 0.42, 0.6));
  hm.alpha = 0.16;
  halo.material = hm;
  for (const m of [moon, halo]) {
    m.position.copyFrom(MOON_POSITION);
    m.infiniteDistance = true; m.isPickable = false; m.applyFog = false;
  }

  // Перевёрнутая пентаграмма и разлом — плоские диски перед лицом луны, повёрнутые к игроку.
  // Направление на луну постоянно, поэтому ориентация задаётся один раз.
  const moonDir = MOON_POSITION.normalizeToNew();
  const overlay = (name: string, diameter: number, draw: (c: CanvasRenderingContext2D) => void) => {
    const t = canvasTexture(scene, 128, 128);
    draw(t.ctx);
    t.tex.hasAlpha = true;
    t.tex.update();
    const mat = unlit(`${name}_mat`, null, t.tex);
    mat.opacityTexture = t.tex;
    const mesh = MeshBuilder.CreatePlane(name, { size: diameter }, scene);
    mesh.material = mat;
    mesh.position.copyFrom(MOON_POSITION.subtract(moonDir.scale(MOON_RADIUS + 0.3)));
    mesh.rotationQuaternion = Quaternion.FromLookDirectionLH(moonDir, Vector3.Up());
    mesh.infiniteDistance = true; mesh.isPickable = false; mesh.applyFog = false;
    return mesh;
  };
  const sign = overlay("moon_sign", 15, (c) => drawInvertedPentagram(c, 128));
  const rift = overlay("moon_rift", MOON_RADIUS * 2, (c) => drawMoonRift(c, 128));
  rift.setEnabled(false);

  return {
    /** Секрет активирован: знак исчезает, на луне — разлом, и она краснеет. */
    crackMoon() {
      sign.setEnabled(false);
      rift.setEnabled(true);
      moonMaterial.emissiveColor = new Color3(0.6, 0.08, 0.04);
      hm.emissiveColor = new Color3(0.9, 0.12, 0.05);
    },
  };
}
