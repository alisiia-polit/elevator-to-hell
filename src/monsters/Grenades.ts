import { Color3, LinesMesh, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { Npc } from "../npc/Npc";
import type { Player } from "../player/Player";
import { Aabb, staticBoxes } from "./NavGrid";

export interface ThrowPlan { velocity: Vector3; flightTime: number }

const hitsBox = (boxes: Aabb[], p: Vector3, r: number) =>
  boxes.some((b) => p.x + r >= b.min.x && p.x - r <= b.max.x && p.y + r >= b.min.y && p.y - r <= b.max.y && p.z + r >= b.min.z && p.z - r <= b.max.z);

/** Закрывает ли геометрия прямую между точками (стена между взрывом и целью). */
function lineBlocked(boxes: Aabb[], a: Vector3, b: Vector3) {
  const d = Vector3.Distance(a, b), n = Math.ceil(d / 0.25);
  for (let k = 1; k < n; k++) {
    const t = k / n;
    if (t * d < 0.3 || (1 - t) * d < 0.3) continue;
    if (hitsBox(boxes, Vector3.Lerp(a, b, t), 0.02)) return true;
  }
  return false;
}

function pathClear(boxes: Aabb[], from: Vector3, v: Vector3, T: number) {
  const G = CONFIG.grenade, n = Math.max(8, Math.ceil(T / 0.03));
  for (let k = 1; k <= n; k++) {
    const t = (T * 0.99 * k) / n; // почти до самой цели: иначе навесной бросок «проходит» сквозь потолок кабины
    if (t < 0.12) continue; // начало броска у руки
    const p = new Vector3(from.x + v.x * t, from.y + v.y * t - 0.5 * G.gravity * t * t, from.z + v.z * t);
    if (hitsBox(boxes, p, G.radius)) return false;
  }
  return true;
}

/**
 * Баллистический расчёт броска: перебираем скорости (сначала настильные) и берём первую дугу,
 * свободную от стен, косяков и потолка кабины. null — бросить в эту точку нельзя.
 */
export function planThrow(boxes: Aabb[], from: Vector3, to: Vector3): ThrowPlan | null {
  const G = CONFIG.grenade;
  const dx = to.x - from.x, dz = to.z - from.z, dy = to.y - from.y;
  const dist = Math.hypot(dx, dz);
  if (dist < G.throwRangeMin || dist > G.throwRangeMax) return null;
  // Сначала настильные броски, затем всё более навесные (через укрытия и низкие проёмы).
  for (const speed of [15, 12.5, 10.5, 9, 7.5, 6, 5, 4, 3.2]) {
    const T = dist / speed;
    const v = new Vector3(dx / T, (dy + 0.5 * G.gravity * T * T) / T, dz / T);
    if (v.length() > G.maxSpeed) continue;
    if (pathClear(boxes, from, v, T)) return { velocity: v, flightTime: T };
  }
  return null;
}

/**
 * Что именно летит и как взрывается. «grenade» — граната монстров (параметры из CONFIG.grenade);
 * «lava» — кусок лавы финального босса: крупнее, раскалённый, взрыв сильнее и оранжевее.
 */
export interface LobProfile {
  style: "grenade" | "lava";
  splashDamage: number;
  explosionRadius: number;
  /** Подпись на экране поражения, если снаряд добил игрока. */
  deathReason: string;
}

const GRENADE_PROFILE: LobProfile = {
  style: "grenade",
  splashDamage: CONFIG.grenade.splashDamage,
  explosionRadius: CONFIG.grenade.explosionRadius,
  deathReason: "ВАС ПІДІРВАЛА ГРАНАТА МОНСТРІВ",
};

interface Grenade {
  root: TransformNode;
  trail: LinesMesh;
  position: Vector3;
  velocity: Vector3;
  age: number;
  boxes: Aabb[];
}

interface ExplosionFx { mesh: Mesh; material: StandardMaterial; life: number; total: number; size: number }

/**
 * Гранаты монстров. Летят по параболе, взрываются при ударе о стену/пол или рядом с целью.
 * Взрыв ранит игрока и NPC, но НИКОГДА не задевает монстров. Эффект взрыва — как у ракеты.
 */
export class GrenadeSystem {
  private grenades: Grenade[] = [];
  private explosions: ExplosionFx[] = [];
  /** Вызывается при вылете гранаты: сюда подключается индикация на экране. */
  onLaunch: (origin: Vector3) => void = () => {};

  /** profile — вид снаряда; npcs — кого, кроме игрока, ранит взрыв (у босса пусто: он атакует только игрока). */
  constructor(
    private readonly scene: Scene,
    private readonly player: Player,
    private readonly npcs: Npc[],
    private readonly profile: LobProfile = GRENADE_PROFILE,
  ) {}

  spawn(from: Vector3, velocity: Vector3) {
    const root = new TransformNode("grenade", this.scene);
    root.position.copyFrom(from);
    const mat = (c: Color3, glow: number) => {
      const m = new StandardMaterial("grenade_mat", this.scene);
      m.diffuseColor = c; m.emissiveColor = c.scale(glow); m.specularColor = Color3.Black();
      return m;
    };
    const lava = this.profile.style === "lava";
    if (lava) {
      // Кусок лавы: тёмная бордовая корка и раскалённые трещины-грани.
      const crust = MeshBuilder.CreateBox("lava_chunk", { width: 0.52, height: 0.42, depth: 0.48 }, this.scene);
      crust.parent = root; crust.material = mat(new Color3(0.2, 0.04, 0.03), 0.5); crust.isPickable = false;
      crust.rotation.set(0.5, 0.3, 0.2);
      const core = MeshBuilder.CreateBox("lava_core", { width: 0.4, height: 0.3, depth: 0.62 }, this.scene);
      core.parent = root; core.material = mat(new Color3(1, 0.42, 0.06), 0.9); core.isPickable = false;
      core.rotation.set(0.2, 0.9, 0.6);
      const shard = MeshBuilder.CreateBox("lava_shard", { size: 0.26 }, this.scene);
      shard.parent = root; shard.position.set(0.24, 0.12, -0.1); shard.material = mat(new Color3(1, 0.75, 0.15), 1); shard.isPickable = false;
      shard.rotation.set(0.7, 0.2, 0.4);
    } else {
      const body = MeshBuilder.CreateSphere("grenade_body", { diameter: 0.3, segments: 6 }, this.scene);
      body.parent = root; body.material = mat(new Color3(0.24, 0.3, 0.12), 0.25); body.isPickable = false;
      const lamp = MeshBuilder.CreateSphere("grenade_lamp", { diameter: 0.12, segments: 4 }, this.scene);
      lamp.parent = root; lamp.position.y = 0.17; lamp.material = mat(new Color3(1, 0.1, 0.05), 1); lamp.isPickable = false;
    }

    const trail = MeshBuilder.CreateLines("grenade_trail", { points: [from, from], updatable: true }, this.scene);
    trail.color = lava ? new Color3(1, 0.3, 0.05) : new Color3(1, 0.55, 0.15);
    trail.isPickable = false;

    this.onLaunch(from.clone());
    this.grenades.push({ root, trail, position: from.clone(), velocity: velocity.clone(), age: 0, boxes: staticBoxes(this.scene, true) });
  }

  update(dt: number) {
    const G = CONFIG.grenade;
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.age += dt;
      const n = Math.max(1, Math.ceil(dt / 0.02)), h = dt / n;
      let boom: Vector3 | null = null;

      for (let k = 0; k < n && !boom; k++) {
        const prev = g.position.clone();
        g.velocity.y -= G.gravity * h;
        g.position.addInPlace(g.velocity.scale(h));
        if (hitsBox(g.boxes, g.position, G.radius)) boom = prev;
        else if (this.nearTarget(g.position)) boom = g.position.clone();
      }
      if (!boom && g.age > G.maxFlightTime) boom = g.position.clone();

      if (boom) {
        this.explode(boom, g.boxes);
        g.root.dispose(false, true);
        g.trail.dispose();
        this.grenades.splice(i, 1);
        continue;
      }

      g.root.position.copyFrom(g.position);
      g.root.rotation.x += dt * 9;
      if (this.profile.style === "lava") g.root.rotation.y += dt * 5;
      const tail = g.position.subtract(g.velocity.normalizeToNew().scale(0.9));
      MeshBuilder.CreateLines(g.trail.name, { points: [g.position, tail], instance: g.trail });
    }
    this.updateExplosions(dt);
  }

  /** Граната взрывается в воздухе, когда пролетает вплотную к игроку или NPC. */
  private nearTarget(p: Vector3) {
    const r = CONFIG.grenade.fuseRadius;
    const close = (c: Vector3) => Math.hypot(c.x - p.x, c.z - p.z) < r && Math.abs(c.y - p.y) < 1.4;
    if (this.player.alive && close(this.player.getWorldPosition())) return true;
    return this.npcs.some((n) => n.alive && close(n.getWorldPosition().add(new Vector3(0, 0.9, 0))));
  }

  private explode(pos: Vector3, boxes: Aabb[]) {
    const G = CONFIG.grenade, P = this.profile;
    const dmgAt = (center: Vector3) => {
      const d = Vector3.Distance(center, pos);
      if (d > P.explosionRadius) return 0;
      let f = 1 - d / P.explosionRadius;
      if (lineBlocked(boxes, pos.add(new Vector3(0, 0.2, 0)), center)) f *= G.shieldFactor;
      return Math.max(1, Math.round(P.splashDamage * f));
    };

    if (this.player.alive) {
      const dmg = dmgAt(this.player.getWorldPosition());
      if (dmg > 0) {
        if (this.player.health <= dmg) this.player.deathReason = P.deathReason;
        this.player.damage(dmg, pos);
      }
    }
    for (const npc of this.npcs) {
      if (!npc.alive) continue;
      const dmg = dmgAt(npc.getWorldPosition().add(new Vector3(0, 0.9, 0)));
      if (dmg > 0) npc.damage(dmg);
    }
    // Монстры намеренно не затрагиваются: гранаты — оружие против игрока.
    this.createExplosionFx(pos);
  }

  private createExplosionFx(position: Vector3) {
    const lava = this.profile.style === "lava";
    const mesh = MeshBuilder.CreateSphere("grenade_explosion", { diameter: 1, segments: 8 }, this.scene);
    const material = new StandardMaterial("grenade_explosion_mat", this.scene);
    material.diffuseColor = lava ? new Color3(0.9, 0.2, 0.02) : new Color3(1, 0.16, 0.02);
    material.emissiveColor = lava ? new Color3(1, 0.32, 0.03) : new Color3(1, 0.08, 0.01);
    material.specularColor = Color3.Black();
    mesh.material = material;
    mesh.isPickable = false;
    mesh.position.copyFrom(position);
    mesh.scaling.setAll(0.2);
    // Видимый размер вспышки: у гранаты 3.4 (как раньше), у лавы — по радиусу поражения.
    this.explosions.push({ mesh, material, life: lava ? 0.4 : 0.28, total: lava ? 0.4 : 0.28, size: lava ? this.profile.explosionRadius * 1.5 : 3.4 });
  }

  private updateExplosions(dt: number) {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.life -= dt;
      const progress = 1 - Math.max(0, e.life / e.total);
      e.mesh.scaling.setAll(0.2 + progress * e.size);
      e.material.alpha = 1 - progress;
      if (e.life <= 0) {
        e.mesh.dispose();
        e.material.dispose();
        this.explosions.splice(i, 1);
      }
    }
  }
}
