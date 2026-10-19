import { Color3, Scene, StandardMaterial, Texture } from "@babylonjs/core";
import { canvasTexture, noise, rng } from "../utils/textures";

const SIZE = 128;

/** Случайная ломаная трещина с ответвлениями: возвращает список отрезков-вершин. */
function crackPaths(r: () => number, count: number): Array<Array<[number, number]>> {
  const paths: Array<Array<[number, number]>> = [];
  const walk = (x: number, y: number, ang: number, steps: number, depth: number) => {
    const pts: Array<[number, number]> = [[x, y]];
    for (let i = 0; i < steps; i++) {
      ang += (r() - 0.5) * 1.2;
      x += Math.cos(ang) * (5 + r() * 7);
      y += Math.sin(ang) * (5 + r() * 7);
      pts.push([x, y]);
      if (depth < 2 && r() < 0.28) walk(x, y, ang + (r() < 0.5 ? -1 : 1) * (0.6 + r() * 0.7), 3 + ((r() * 4) | 0), depth + 1);
    }
    paths.push(pts);
  };
  for (let i = 0; i < count; i++) walk(r() * SIZE, r() * SIZE, r() * Math.PI * 2, 6 + ((r() * 6) | 0), 0);
  return paths;
}

/**
 * Кожа босса: тлеющая лава. Корка тёмно-бордовых тонов с пятнами и «жилами», по ней светящиеся трещины.
 * Диффузная текстура — корка и тёмные края трещин; эмиссивная — только трещины (оранжево-жёлтые) и редкие угли,
 * поэтому они светятся независимо от освещения этажа. Текстура мапится целиком на каждую грань куба.
 */
function createSkinMaterial(scene: Scene): StandardMaterial {
  const r = rng(6661);
  const diffuse = canvasTexture(scene, SIZE, SIZE);
  const emissive = canvasTexture(scene, SIZE, SIZE);
  const d = diffuse.ctx, e = emissive.ctx;

  // Корка: тёмно-бордовая с шумом и более светлыми/тёмными пятнами остывшего камня.
  noise(d, r, [52, 9, 12], 30, SIZE);
  for (let i = 0; i < 46; i++) {
    const x = r() * SIZE, y = r() * SIZE, rad = 4 + r() * 11;
    d.fillStyle = r() < 0.55 ? "rgba(18,2,4,0.45)" : "rgba(96,18,16,0.32)";
    d.beginPath(); d.arc(x, y, rad, 0, Math.PI * 2); d.fill();
  }

  e.fillStyle = "#000";
  e.fillRect(0, 0, SIZE, SIZE);
  // Угли: редкие тусклые красные точки по всей коже.
  for (let i = 0; i < 150; i++) {
    e.fillStyle = r() < 0.2 ? "rgb(150,40,8)" : "rgb(64,10,4)";
    e.fillRect((r() * SIZE) | 0, (r() * SIZE) | 0, 1 + ((r() * 2) | 0), 1 + ((r() * 2) | 0));
  }

  const paths = crackPaths(r, 9);
  const stroke = (c: CanvasRenderingContext2D, pts: Array<[number, number]>, w: number, color: string) => {
    c.strokeStyle = color; c.lineWidth = w; c.lineJoin = "round"; c.lineCap = "round";
    c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke();
  };
  for (const pts of paths) stroke(d, pts, 5, "#0b0102");                   // тёмный край трещины на коже
  for (const pts of paths) stroke(e, pts, 4.2, "rgb(214,56,8)");           // свечение трещины
  for (const pts of paths) stroke(e, pts, 2.1, "rgb(255,150,24)");
  for (const pts of paths) stroke(e, pts, 0.9, "rgb(255,236,150)");        // раскалённая сердцевина

  diffuse.tex.update();
  emissive.tex.update();
  diffuse.tex.wrapU = diffuse.tex.wrapV = Texture.WRAP_ADDRESSMODE;

  const m = new StandardMaterial("boss_skin_mat", scene);
  m.diffuseTexture = diffuse.tex;
  m.diffuseColor = new Color3(1, 0.85, 0.85);
  m.emissiveTexture = emissive.tex;
  m.specularColor = Color3.Black();
  return m;
}

export interface BossMaterials {
  /** Лавовая кожа. Единственный материал, на который действует красная вспышка попадания. */
  skin: StandardMaterial;
  /** Рога, шипы: тёмный обсидиан с тлеющим оттенком. */
  horn: StandardMaterial;
  /** Когти и клыки: кость. */
  bone: StandardMaterial;
  /** Глаза и пасть: яркое свечение (гасится при смерти). */
  glow: StandardMaterial;
  /** Раскалённые кончики шипов и хвоста. */
  ember: StandardMaterial;
}

export function createBossMaterials(scene: Scene): BossMaterials {
  const flat = (name: string, diffuse: Color3, emissive: Color3) => {
    const m = new StandardMaterial(`boss_${name}_mat`, scene);
    m.diffuseColor = diffuse;
    m.emissiveColor = emissive;
    m.specularColor = Color3.Black();
    return m;
  };
  return {
    skin: createSkinMaterial(scene),
    horn: flat("horn", new Color3(0.11, 0.035, 0.035), new Color3(0.16, 0.025, 0.005)),
    bone: flat("bone", new Color3(0.62, 0.5, 0.38), new Color3(0.14, 0.07, 0.03)),
    glow: flat("glow", Color3.Black(), new Color3(1, 0.78, 0.15)),
    ember: flat("ember", Color3.Black(), new Color3(1, 0.34, 0.05)),
  };
}
