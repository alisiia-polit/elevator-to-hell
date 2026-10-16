import { CONFIG } from "../config";

/**
 * Секреты игры: по одному на этаж 1–4 и финальный на этаже 0.
 * Координаты — локальные для этажа (y отсчитывается от пола этажа).
 */
export interface SecretDef {
  id: string;
  floor: number;
  /** switch — плоский знак радиационной угрозы на поверхности; moon — выстрел в луну на крыше. */
  kind: "switch" | "moon";
  position?: [number, number, number];
  /** Направление наружу из поверхности (x, z). */
  normal?: [number, number];
  size?: number;
  /** Финальный секрет: скрыт, пока не активированы все остальные. */
  finale?: boolean;
}

const { halfX, halfZ } = CONFIG.level;
const INSET = 0.02; // знак чуть выступает над поверхностью

/** Ящик-носитель секрета на этаже 2 (добавляется в World вместе с остальными предметами). */
export const SECRET_CRATE = { pos: [9.0, 0.6, 1.0] as [number, number, number], size: 1.2 };

export const SECRET_DEFS: SecretDef[] = [
  // Склад: восточная стена в узком проходе за штабелем ящиков.
  { id: "floor1", floor: 1, kind: "switch", position: [halfX - INSET, 1.0, -5.0], normal: [-1, 0] },
  // Лаборатория: на южной грани ящика (со стороны входа знак не виден).
  {
    id: "floor2", floor: 2, kind: "switch", normal: [0, -1],
    position: [SECRET_CRATE.pos[0], SECRET_CRATE.pos[1], SECRET_CRATE.pos[2] - SECRET_CRATE.size / 2 - INSET],
  },
  // Котельная: западная стена за котлом.
  { id: "floor3", floor: 3, kind: "switch", position: [-halfX + INSET, 1.4, 2.5], normal: [1, 0] },
  // Крыша: выстрел в луну.
  { id: "floor4", floor: 4, kind: "moon" },
  // Холл: стена напротив входа в лифт (лифт — на севере, секрет — на южной стене).
  { id: "floor0", floor: 0, kind: "switch", position: [0, 1.6, -halfZ + INSET], normal: [0, 1], size: 1.5, finale: true },
];
