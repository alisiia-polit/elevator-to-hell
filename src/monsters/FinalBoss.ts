import { Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import { FlameField } from "../effects/Flames";
import type { BlastTarget } from "../npc/Npc";
import type { Player } from "../player/Player";
import { BossMaterials, createBossMaterials } from "./bossSkin";
import { GrenadeSystem, planThrow } from "./Grenades";
import { horizontalDistance, Monster } from "./Monster";
import { NavGrid, Point, staticBoxes } from "./NavGrid";

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const TAU = Math.PI * 2;

const HIPS_Y = 1.2;
const REST_LEAN = 0.2; // в покое босс сутулится
const TAIL_SEGMENTS = 6;
const DEATH_TIME = 2.2;
const HEIGHT_AIM = 0.6; // на какой высоте над полом целятся куски лавы (как гранаты)

/** Суставы босса: каждый — точка вращения, к ней прикреплены части тела. */
interface Rig {
  hips: TransformNode; spine: TransformNode; neck: TransformNode; jaw: TransformNode;
  thighL: TransformNode; thighR: TransformNode; kneeL: TransformNode; kneeR: TransformNode;
  armL: TransformNode; armR: TransformNode; elbowL: TransformNode; elbowR: TransformNode;
  tail: TransformNode[];
  chunk: Mesh; // кусок лавы в руке во время замаха
}

type Mode = "HIDDEN" | "EMERGE" | "ROAR" | "FIGHT";
type Action = "NONE" | "CLAW" | "TAIL" | "LOB";

/**
 * Финальный босс — огромный демон ростом с двери лифта.
 * Кожа — тлеющая лава: тёмно-бордовая корка со светящимися трещинами, из которых вырывается пламя.
 * Массивные изогнутые рога, демонические глаза, шипы по спине и плечам, длинный хвост.
 *
 * Бой: вблизи (до rangedFrom метров) бьёт когтями или круговым ударом хвоста, дальше — бросает куски лавы
 * по той же баллистике, что гранаты монстров. Атакует только игрока. Здоровье — в hpMultiplier раз
 * больше здоровья ходячего монстра. Пока выходит из лифта и ревёт — неуязвим (сцена появления).
 */
export class FinalBoss extends Monster implements BlastTarget {
  readonly maxHp: number;
  /** Радиус тела для столкновения NPC-смертников, м. */
  readonly blastRadius: number;
  /** Рёв в конце выхода из лифта: сюда подключается тряска камеры. */
  onRoar: () => void = () => {};

  private mode: Mode = "HIDDEN";
  private action: Action = "NONE";
  private actT = 0;
  private actHit = false;
  private lobReleased = false;
  private tailYaw0 = 0;
  private meleeCd = 1.0;
  private lobCd = 1.0;
  private roarT = 0;

  private moving = false;
  private walkBlend = 0;
  private walkPhase = 0;
  private lastStep = 0;
  private idleT = Math.random() * 10;
  private flameBoost = 1;

  private emergeToZ = 0;
  private readonly rig: Rig;
  private readonly mats: BossMaterials;
  private readonly flames: FlameField;
  private readonly player: Player;
  private readonly nav: NavGrid;
  private readonly lava: GrenadeSystem;

  private path: Point[] = [];
  private repath = 0;
  private goal: Point = { x: 1e9, z: 1e9 };
  private stuckT = 0;
  private lastX = 0;
  private lastZ = 0;
  private prevPlayer: Vector3 | null = null;
  private readonly playerVel = new Vector3();

  constructor(scene: Scene, position: Vector3, yaw: number, player: Player, nav: NavGrid, lava: GrenadeSystem) {
    const hp = CONFIG.monsters.walker.hp * CONFIG.boss.hpMultiplier;
    // Лёжа тело опирается на грудь/спину, поэтому труп приподнят над полом.
    super(scene, "boss", position, hp, position.y + 0.5);
    this.maxHp = hp;
    this.player = player;
    this.nav = nav;
    this.lava = lava;
    this.blastRadius = CONFIG.boss.radius + 0.1;
    this.lastX = position.x;
    this.lastZ = position.z;
    this.root.rotation.y = yaw;

    this.mats = createBossMaterials(scene);
    this.materials.push(this.mats.skin); // красная вспышка при попадании — только на коже
    this.flames = new FlameField(scene, 130);
    this.rig = this.buildRig();

    // Рост босса = высота дверей лифта (с рогами, в сутулой стойке покоя).
    this.rig.spine.rotation.x = REST_LEAN;
    const bounds = this.root.getHierarchyBoundingVectors(true);
    const height = bounds.max.y - bounds.min.y;
    if (height > 0.1) this.root.scaling.setAll(CONFIG.elevator.cabinHeight / height);

    this.root.setEnabled(false); // до выхода из лифта не виден и не принимает попаданий
    this.flames.setEnabled(false);
  }

  // ----- Интерфейс сцены появления -----

  /** Босс начинает выходить из лифта: идёт по прямой к точке z = standZ. */
  startEmerging(standZ: number) {
    if (this.mode !== "HIDDEN") return;
    this.mode = "EMERGE";
    this.emergeToZ = standZ;
    this.root.setEnabled(true);
    this.flames.setEnabled(true);
  }

  /** Сцена закончена: босс стоит на месте, отревел и готов к бою. */
  get ready() {
    return this.mode === "FIGHT";
  }

  get healthFraction() {
    return Math.max(0, this.hp / this.maxHp);
  }

  // ----- Построение модели -----

  private buildRig(): Rig {
    const m = this.mats;
    const node = (name: string, parent: TransformNode, x: number, y: number, z: number) => {
      const n = new TransformNode(`boss_${name}`, this.scene);
      n.parent = parent;
      n.position.set(x, y, z);
      return n;
    };
    const finish = (mesh: Mesh, mat: StandardMaterial, parent: TransformNode, collide: boolean) => {
      mesh.parent = parent;
      mesh.material = mat;
      mesh.isPickable = true;
      mesh.checkCollisions = collide;
      mesh.metadata = { monster: this }; // по этому признаку оружие игрока и NPC находят цель
      return mesh;
    };
    const box = (name: string, size: [number, number, number], pos: [number, number, number], mat: StandardMaterial, parent: TransformNode, collide = false, rot?: [number, number, number]) => {
      const mesh = MeshBuilder.CreateBox(`boss_${name}`, { width: size[0], height: size[1], depth: size[2] }, this.scene);
      mesh.position.set(pos[0], pos[1], pos[2]);
      if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
      return finish(mesh, mat, parent, collide);
    };
    // Конус (шип, коготь, клык), по умолчанию остриём вверх (+y).
    const cone = (name: string, d: number, h: number, pos: [number, number, number], mat: StandardMaterial, parent: TransformNode, rot?: [number, number, number]) => {
      const mesh = MeshBuilder.CreateCylinder(`boss_${name}`, { diameterTop: 0, diameterBottom: d, height: h, tessellation: 5 }, this.scene);
      mesh.position.set(pos[0], pos[1], pos[2]);
      if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
      return finish(mesh, mat, parent, false);
    };
    // Источник пламени в точке узла (области — «трещины», откуда вырывается огонь).
    const fire = (parent: TransformNode, x: number, y: number, z: number, size: [number, number, number], rate: number, flame = 0.3) => {
      this.flames.addSource(node("fire", parent, x, y, z), { box: size, rate, size: flame });
    };

    const hips = node("hips", this.root, 0, HIPS_Y, 0);
    box("pelvis", [1.1, 0.35, 0.7], [0, 0, 0], m.skin, hips, true);

    // Ноги: толстые бёдра, колени, голени и когтистые ступни.
    const leg = (s: number) => {
      const thigh = node("thigh", hips, s * 0.46, -0.1, 0);
      box("thigh_m", [0.5, 0.6, 0.55], [0, -0.24, 0], m.skin, thigh, true);
      const knee = node("knee", thigh, 0, -0.5, 0);
      box("shin", [0.42, 0.55, 0.5], [0, -0.24, 0], m.skin, knee);
      box("foot", [0.55, 0.2, 0.8], [0, -0.5, 0.17], m.skin, knee);
      for (const c of [-1, 0, 1]) cone("toe", 0.12, 0.34, [c * 0.17, -0.5, 0.62], m.bone, knee, [Math.PI / 2, 0, 0]);
      cone("knee_spike", 0.14, 0.3, [0, 0.0, 0.3], m.horn, knee, [Math.PI / 2 - 0.3, 0, 0]);
      fire(thigh, 0, -0.2, 0.25, [0.3, 0.3, 0.1], 3);
      return { thigh, knee };
    };
    const L = leg(-1), R = leg(1);

    // Корпус: массивная грудь, горб, шипы по спине.
    const spine = node("spine", hips, 0, 0.12, 0);
    box("torso", [1.4, 0.9, 0.85], [0, 0.46, 0], m.skin, spine, true);
    box("chest", [1.1, 0.5, 0.14], [0, 0.56, 0.47], m.skin, spine);
    box("chest_crack", [0.1, 0.55, 0.05], [0, 0.56, 0.55], m.glow, spine);
    box("belly", [0.9, 0.28, 0.1], [0, 0.16, 0.45], m.skin, spine);
    box("hump", [1.0, 0.5, 0.42], [0, 0.72, -0.5], m.skin, spine, false, [0.2, 0, 0]);
    const back: Array<[number, number, number]> = [[0, 1.0, -0.72], [0, 0.78, -0.72], [0, 0.52, -0.5], [0, 0.26, -0.46], [-0.4, 0.88, -0.62], [0.4, 0.88, -0.62], [-0.45, 0.55, -0.46], [0.45, 0.55, -0.46]];
    back.forEach((p, i) => cone(`back_spike_${i}`, 0.2, 0.5, p, m.horn, spine, [-1.15, 0, 0]));
    fire(spine, 0, 0.56, 0.5, [0.2, 0.5, 0.1], 5);
    fire(spine, 0, 0.9, -0.6, [0.8, 0.2, 0.3], 9, 0.34);
    fire(spine, 0, 0.35, -0.5, [0.8, 0.2, 0.2], 4);

    // Плечи с шипами.
    for (const s of [-1, 1]) {
      box("pad", [0.5, 0.4, 0.8], [s * 0.88, 0.95, 0], m.skin, spine, false, [0, 0, -s * 0.25]);
      cone("pad_spike_a", 0.18, 0.55, [s * 0.98, 1.25, 0.15], m.horn, spine, [0, 0, -s * 0.5]);
      cone("pad_spike_b", 0.16, 0.45, [s * 1.0, 1.15, -0.22], m.horn, spine, [-0.5, 0, -s * 0.6]);
      fire(spine, s * 0.88, 1.15, 0, [0.4, 0.1, 0.5], 7);
    }

    // Голова: клыкастая пасть, брови-козырёк, горящие глаза, массивные изогнутые рога.
    const neck = node("neck", spine, 0, 0.93, 0.12);
    box("neck_m", [0.5, 0.3, 0.5], [0, 0.04, 0], m.skin, neck);
    box("head", [0.78, 0.55, 0.8], [0, 0.28, 0.1], m.skin, neck);
    box("muzzle", [0.5, 0.28, 0.36], [0, 0.12, 0.5], m.skin, neck);
    box("brow", [0.86, 0.14, 0.3], [0, 0.5, 0.42], m.horn, neck, false, [0.18, 0, 0]);
    box("mouth_glow", [0.4, 0.08, 0.4], [0, 0.03, 0.4], m.glow, neck);
    const jaw = node("jaw", neck, 0, 0.06, 0.12);
    box("jaw_m", [0.6, 0.14, 0.62], [0, -0.02, 0.3], m.skin, jaw);
    for (const x of [-0.21, -0.07, 0.07, 0.21]) {
      cone("fang_low", 0.08, 0.2, [x, 0.1, 0.56], m.bone, jaw);
      cone("fang_up", 0.08, 0.2, [x, -0.1, 0.66], m.bone, neck, [Math.PI, 0, 0]);
    }
    for (const s of [-1, 1]) {
      box("eye_socket", [0.3, 0.14, 0.05], [s * 0.21, 0.36, 0.5], m.horn, neck, false, [0, 0, s * 0.45]);
      box("eye", [0.22, 0.07, 0.06], [s * 0.21, 0.36, 0.52], m.glow, neck, false, [0, 0, s * 0.45]);
      // Рог растёт наружу, загибается вверх и острием вперёд-внутрь.
      const h1 = node("horn1", neck, s * 0.3, 0.52, -0.02);
      h1.rotation.z = -s * 0.95;
      box("horn_a", [0.26, 0.34, 0.26], [0, 0.13, 0], m.horn, h1);
      const h2 = node("horn2", h1, 0, 0.28, 0);
      h2.rotation.z = s * 0.9;
      h2.rotation.x = 0.15;
      box("horn_b", [0.22, 0.3, 0.22], [0, 0.12, 0], m.horn, h2);
      const h3 = node("horn3", h2, 0, 0.26, 0);
      h3.rotation.z = s * 0.7;
      h3.rotation.x = 0.5;
      cone("horn_tip", 0.22, 0.46, [0, 0.19, 0], m.horn, h3);
      cone("horn_ridge", 0.12, 0.3, [s * 0.18, 0.12, -0.2], m.horn, neck, [-0.9, 0, -s * 0.4]); // затылочный гребень
      fire(h1, 0, 0.05, 0, [0.15, 0.1, 0.15], 5, 0.22);
      fire(neck, s * 0.21, 0.38, 0.5, [0.14, 0.06, 0.06], 3, 0.12);
    }
    fire(neck, 0, 0.05, 0.62, [0.4, 0.05, 0.1], 3, 0.18);

    // Руки: длинные, до колен, с тремя когтями.
    const arm = (s: number) => {
      const shoulder = node("shoulder", spine, s * 0.95, 0.78, 0);
      box("arm_u", [0.38, 0.6, 0.4], [0, -0.25, 0], m.skin, shoulder);
      const elbow = node("elbow", shoulder, 0, -0.55, 0);
      box("arm_f", [0.34, 0.62, 0.36], [0, -0.27, 0], m.skin, elbow);
      box("hand", [0.42, 0.26, 0.36], [0, -0.66, 0.02], m.skin, elbow);
      for (const c of [-1, 0, 1]) cone("claw", 0.1, 0.44, [c * 0.14, -0.9, 0.08], m.bone, elbow, [Math.PI - 0.25, 0, 0]);
      cone("elbow_spike", 0.14, 0.38, [s * 0.24, 0, -0.05], m.horn, elbow, [0, 0, -s * 1.3]);
      fire(elbow, 0, -0.27, 0, [0.3, 0.5, 0.3], 4);
      return { shoulder, elbow };
    };
    const aL = arm(-1), aR = arm(1);

    // Хвост: цепочка сегментов с шипами; на конце раскалённое жало.
    const tail: TransformNode[] = [];
    let prev: TransformNode = node("tail0", hips, 0, 0.05, -0.4);
    for (let k = 0; k < TAIL_SEGMENTS; k++) {
      const seg = k === 0 ? prev : node(`tail${k}`, prev, 0, 0, -0.5);
      const w = 0.46 - 0.06 * k;
      box(`tail_${k}`, [w, w * 0.9, 0.55], [0, 0, -0.25], m.skin, seg);
      cone(`tail_spike_${k}`, 0.14, 0.3, [0, w * 0.45 + 0.08, -0.2], m.horn, seg, [-0.45, 0, 0]);
      if (k === 1 || k === 3) fire(seg, 0, 0, -0.25, [0.2, 0.2, 0.3], 4);
      tail.push(seg);
      prev = seg;
    }
    cone("tail_sting", 0.2, 0.55, [0, 0, -0.78], m.ember, prev, [-Math.PI / 2, 0, 0]);
    fire(prev, 0, 0, -0.7, [0.2, 0.2, 0.2], 8, 0.34);

    // Кусок лавы в руке (виден только во время замаха). Создаётся после измерения роста — см. конструктор.
    const chunk = MeshBuilder.CreateBox("boss_held_lava", { width: 0.5, height: 0.4, depth: 0.46 }, this.scene);
    chunk.parent = aR.elbow;
    chunk.position.set(0, -0.95, 0.12);
    chunk.rotation.set(0.5, 0.3, 0.2);
    chunk.material = m.ember;
    chunk.isPickable = false;
    chunk.checkCollisions = false;
    chunk.setEnabled(false);

    return {
      hips, spine, neck, jaw,
      thighL: L.thigh, thighR: R.thigh, kneeL: L.knee, kneeR: R.knee,
      armL: aL.shoulder, armR: aR.shoulder, elbowL: aL.elbow, elbowR: aR.elbow,
      tail, chunk,
    };
  }

  // ----- Жизненный цикл -----

  update(dt: number) {
    if (this.mode === "HIDDEN") return;

    if (!this.alive) {
      this.flames.update(dt);
      this.updateCorpse(dt);
      return;
    }

    this.updateHitFlash(dt);
    this.idleT += dt;
    this.moving = false;
    this.trackPlayer(dt);

    switch (this.mode) {
      case "EMERGE": this.updateEmerge(dt); break;
      case "ROAR": this.updateRoar(dt); break;
      case "FIGHT": this.think(dt); break;
    }

    this.flameBoost += ((this.mode === "ROAR" ? 2.2 : 1) - this.flameBoost) * Math.min(1, dt * 6);
    this.flames.intensity = this.flameBoost;
    this.flames.update(dt);
    this.animate(dt);
  }

  /** Во время сцены появления босса не ранить, потом — обычный урон (кроме мёртвого). */
  damage(amount: number) {
    if (!this.alive || this.mode !== "FIGHT") return;
    super.damage(amount);
  }

  protected die() {
    this.action = "NONE";
    this.rig.chunk.setEnabled(false);
    this.flames.setEnabled(false);
    super.die();
  }

  private updateEmerge(dt: number) {
    const p = this.root.position, B = CONFIG.boss;
    const dz = this.emergeToZ - p.z;
    const step = Math.min(B.emergeSpeed * dt, Math.abs(dz));
    p.z += Math.sign(dz) * step;
    this.moving = true;
    if (Math.abs(this.emergeToZ - p.z) < 1e-3) {
      this.mode = "ROAR";
      this.roarT = 0;
      this.onRoar();
    }
  }

  private updateRoar(dt: number) {
    this.roarT += dt;
    if (this.roarT >= CONFIG.boss.roarTime) {
      this.mode = "FIGHT";
      this.meleeCd = 0.4;
      this.lobCd = 0.8;
    }
  }

  // ----- Поведение в бою -----

  /** Скорость игрока (сглаженная) — для упреждения броска лавы. */
  private trackPlayer(dt: number) {
    const pos = this.player.getWorldPosition();
    if (this.prevPlayer && dt > 1e-4) {
      const k = Math.min(1, dt * 6);
      this.playerVel.x += ((pos.x - this.prevPlayer.x) / dt - this.playerVel.x) * k;
      this.playerVel.z += ((pos.z - this.prevPlayer.z) / dt - this.playerVel.z) * k;
    }
    this.prevPlayer = pos;
  }

  private think(dt: number) {
    const B = CONFIG.boss;
    this.meleeCd = Math.max(0, this.meleeCd - dt);
    this.lobCd = Math.max(0, this.lobCd - dt);

    if (this.action !== "NONE") {
      this.actT += dt;
      this.updateAction(dt);
      return;
    }
    if (!this.player.alive) return; // игрок мёртв — босс замирает

    const from = this.getWorldPosition();
    const to = this.player.getWorldPosition();
    const dist = horizontalDistance(from, to);

    if (dist <= B.rangedFrom) {
      // Ближний бой: хвост на средней дистанции и если игрок сбоку/сзади, иначе когти.
      if (dist <= B.tailRange && this.meleeCd <= 0) {
        const behind = this.angleToPlayer(to) > 1.2;
        const tail = behind || dist > B.meleeRange || Math.random() < 0.4;
        this.startAction(tail ? "TAIL" : "CLAW");
        return;
      }
      this.advance(dt, to, B.speed, 2.4);
      return;
    }

    // Дальний бой: бросает лаву, а в паузах приближается.
    if (this.lobCd <= 0) {
      if (this.canLob(to)) { this.startAction("LOB"); return; }
      this.lobCd = 0.5; // нет дуги (укрытие) — не пытаться каждый кадр
    }
    this.advance(dt, to, B.speed, 2.4);
  }

  private startAction(a: Action) {
    this.action = a;
    this.actT = 0;
    this.actHit = false;
    this.lobReleased = false;
    this.tailYaw0 = this.root.rotation.y;
  }

  private endAction(cooldown: "melee" | "lob") {
    this.action = "NONE";
    if (cooldown === "melee") this.meleeCd = CONFIG.boss.meleeCooldown;
    else this.lobCd = CONFIG.boss.lavaCooldown;
  }

  private updateAction(dt: number) {
    const B = CONFIG.boss;
    const to = this.player.getWorldPosition();

    if (this.action === "CLAW") {
      const strike = 0.2, recover = 0.45;
      if (this.actT < B.clawWindup) this.face(to, dt, 6);
      if (!this.actHit && this.actT >= B.clawWindup + strike * 0.5) {
        this.actHit = true;
        const dist = horizontalDistance(this.getWorldPosition(), to);
        if (dist <= B.meleeRange + 0.3 && this.angleToPlayer(to) < 1.2) this.hitPlayer(B.clawDamage);
      }
      if (this.actT >= B.clawWindup + strike + recover) this.endAction("melee");
      return;
    }

    if (this.action === "TAIL") {
      const spin = 0.6, recover = 0.5;
      if (this.actT < B.tailWindup) {
        this.face(to, dt, 6);
        this.tailYaw0 = this.root.rotation.y;
      } else if (this.actT < B.tailWindup + spin) {
        // Круговой взмах: босс раскручивается на полный оборот, хвост выброшен в сторону.
        const s = clamp01((this.actT - B.tailWindup) / spin);
        this.root.rotation.y = this.tailYaw0 + TAU * smooth(s);
        if (!this.actHit && s >= 0.45) {
          this.actHit = true;
          if (horizontalDistance(this.getWorldPosition(), to) <= B.tailRange + 0.2) this.hitPlayer(B.tailDamage);
        }
      } else {
        this.root.rotation.y = this.tailYaw0 + TAU;
      }
      if (this.actT >= B.tailWindup + spin + recover) {
        this.root.rotation.y = this.tailYaw0;
        this.endAction("melee");
      }
      return;
    }

    // LOB: замах с куском лавы, бросок, возврат.
    const release = 0.18, recover = 0.4;
    if (this.actT < B.lavaWindup) this.face(to, dt, 6);
    if (!this.lobReleased && this.actT >= B.lavaWindup) {
      this.lobReleased = true;
      this.releaseLava();
    }
    if (this.actT >= B.lavaWindup + release + recover) this.endAction("lob");
  }

  private hitPlayer(damage: number) {
    if (!this.player.alive) return;
    if (this.player.health <= damage) this.player.deathReason = "ВАС ЗНИЩИВ ФІНАЛЬНИЙ БОС";
    this.player.damage(damage, this.getWorldPosition());
  }

  /** Угол между направлением взгляда босса и направлением на игрока, 0..π. */
  private angleToPlayer(to: Vector3) {
    const p = this.getWorldPosition();
    const want = Math.atan2(to.x - p.x, to.z - p.z);
    let d = want - this.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    return Math.abs(d);
  }

  // ----- Лава -----

  private handPosition(): Vector3 {
    this.rig.chunk.computeWorldMatrix(true);
    return this.rig.chunk.getAbsolutePosition().clone();
  }

  /** Куда целиться: игрок на уровне пола + HEIGHT_AIM (так же, как цель гранат монстров). */
  private aimPoint(to: Vector3) {
    return new Vector3(to.x, this.root.position.y + HEIGHT_AIM, to.z);
  }

  /** Можно ли сейчас бросить лаву: есть свободная дуга от примерной позиции руки. */
  private canLob(to: Vector3): boolean {
    const p = this.getWorldPosition(), yaw = this.root.rotation.y;
    const approxHand = new Vector3(p.x + Math.sin(yaw) * 0.6, p.y + 2.3, p.z + Math.cos(yaw) * 0.6);
    return planThrow(staticBoxes(this.scene, true), approxHand, this.aimPoint(to)) !== null;
  }

  private releaseLava() {
    this.rig.chunk.setEnabled(false);
    const boxes = staticBoxes(this.scene, true);
    const origin = this.handPosition();
    const to = this.player.getWorldPosition();
    let plan = planThrow(boxes, origin, this.aimPoint(to));
    if (!plan) return;

    // Упреждение: бросаем туда, где игрок окажется к концу полёта (с долей lavaLead), если дуга там свободна.
    const T = plan.flightTime * CONFIG.boss.lavaLead;
    const lead = this.aimPoint(to);
    lead.x = Math.max(-9.5, Math.min(9.5, lead.x + this.playerVel.x * T));
    lead.z = Math.max(-7.5, Math.min(7.5, lead.z + this.playerVel.z * T));
    plan = planThrow(boxes, origin, lead) ?? plan;
    this.lava.spawn(origin, plan.velocity);
  }

  // ----- Движение -----

  /** Идёт к цели с обходом препятствий, останавливаясь в stopGap метрах от неё. */
  private advance(dt: number, to: Vector3, speed: number, stopGap: number) {
    const from = this.getWorldPosition();
    const dist = horizontalDistance(from, to);
    this.face(to, dt, 3.5);
    const step = Math.min(speed * dt, Math.max(0, dist - stopGap));
    if (step <= 0) {
      this.separate();
      return;
    }
    const steer = this.steerPoint(from, new Vector3(to.x, from.y, to.z), dt);
    const sx = steer.x - from.x, sz = steer.z - from.z, sl = Math.hypot(sx, sz) || 1;
    this.moveGround(this.root.position.x + (sx / sl) * step, this.root.position.z + (sz / sl) * step, CONFIG.boss.radius, CONFIG.elevator.cabinHeight);
    this.moving = true;
    this.watchStuck(dt);
    this.clampToRoom();
    this.separate();
  }

  private separate() {
    this.separateGround(CONFIG.boss.radius, [{ target: this.player, radius: 0.45 }], CONFIG.elevator.cabinHeight);
  }

  /** Точка, к которой идти сейчас: цель, если путь прямой свободен, иначе очередная вершина маршрута A*. */
  private steerPoint(from: Vector3, to: Vector3, dt: number): Point {
    if (this.nav.lineFree(from.x, from.z, to.x, to.z)) {
      this.path.length = 0;
      this.goal = { x: 1e9, z: 1e9 };
      return to;
    }
    this.repath -= dt;
    if (this.repath <= 0 || Math.hypot(to.x - this.goal.x, to.z - this.goal.z) > 1.0) {
      this.repath = 0.4 + Math.random() * 0.2;
      this.goal = { x: to.x, z: to.z };
      this.path = this.nav.findPath(from.x, from.z, to.x, to.z) ?? [];
    }
    while (this.path.length && Math.hypot(this.path[0].x - from.x, this.path[0].z - from.z) < 0.5) this.path.shift();
    return this.path[0] ?? to;
  }

  /** Если босс почти не продвигается, маршрут строится заново. */
  private watchStuck(dt: number) {
    this.stuckT += dt;
    if (this.stuckT < 0.6) return;
    const p = this.root.position;
    if (Math.hypot(p.x - this.lastX, p.z - this.lastZ) < 0.2) { this.repath = 0; this.path.length = 0; }
    this.lastX = p.x; this.lastZ = p.z; this.stuckT = 0;
  }

  private face(target: Vector3, dt: number, rate: number) {
    const wanted = Math.atan2(target.x - this.root.position.x, target.z - this.root.position.z);
    let delta = wanted - this.root.rotation.y;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    this.root.rotation.y += delta * Math.min(1, dt * rate);
  }

  // ----- Анимация -----

  private animate(dt: number) {
    const r = this.rig, B = CONFIG.boss;
    const speed = this.mode === "EMERGE" ? B.emergeSpeed : B.speed;
    this.walkBlend += ((this.moving ? 1 : 0) - this.walkBlend) * Math.min(1, dt * 7);
    if (this.moving) this.walkPhase += dt * speed * 2.2;
    this.stomp();

    const w = this.walkBlend, idle = 1 - w, ph = this.walkPhase, it = this.idleT;
    const sL = Math.sin(ph), sR = -sL;

    // Базовая поза: ходьба и покой.
    r.thighL.rotation.x = -sL * 0.55 * w;
    r.thighR.rotation.x = -sR * 0.55 * w;
    r.kneeL.rotation.x = Math.max(0, Math.cos(ph)) * 0.7 * w;
    r.kneeR.rotation.x = Math.max(0, -Math.cos(ph)) * 0.7 * w;
    r.hips.position.y = HIPS_Y + Math.abs(sL) * 0.07 * w;
    r.hips.rotation.y = sL * 0.08 * w;

    r.spine.rotation.x = REST_LEAN + 0.08 * w + Math.sin(it * 1.8) * 0.012 * idle;
    r.spine.rotation.y = -sL * 0.1 * w;
    r.spine.rotation.z = Math.sin(it * 0.8) * 0.02 * idle + sL * 0.04 * w;
    r.neck.rotation.x = 0.12 + Math.sin(it * 0.9) * 0.04 * idle;
    r.neck.rotation.y = Math.sin(it * 0.5) * 0.3 * idle;
    r.jaw.rotation.x = 0.06 + Math.max(0, Math.sin(it * 1.3)) * 0.05 * idle;

    const sway = (p: number) => Math.sin(it * 1.1 + p) * 0.04 * idle;
    r.armL.rotation.x = sL * 0.4 * w + sway(0);
    r.armR.rotation.x = sR * 0.4 * w + sway(1);
    r.armL.rotation.z = -0.12;
    r.armR.rotation.z = 0.12;
    r.elbowL.rotation.x = -0.35 - 0.2 * w * Math.abs(sL);
    r.elbowR.rotation.x = -0.35 - 0.2 * w * Math.abs(sR);

    // Хвост: ленивое покачивание (сильнее на ходу), лёгкий изгиб вниз и жало кверху.
    r.tail.forEach((seg, k) => {
      seg.rotation.y = Math.sin(it * 1.6 - k * 0.7) * (0.1 + 0.08 * w) + Math.sin(ph * 0.5 - k * 0.6) * 0.05 * w;
      seg.rotation.x = k === 0 ? -0.22 : k === TAIL_SEGMENTS - 1 ? 0.45 : -0.04;
    });

    r.chunk.setEnabled(this.action === "LOB" && !this.lobReleased);

    if (this.mode === "ROAR") this.roarPose();
    else if (this.action === "CLAW") this.clawPose();
    else if (this.action === "TAIL") this.tailPose();
    else if (this.action === "LOB") this.lobPose();
  }

  /** Тяжёлые шаги: лёгкая тряска камеры, слабее с расстоянием. */
  private stomp() {
    if (!this.moving) return;
    const idx = Math.floor(this.walkPhase / Math.PI);
    if (idx === this.lastStep) return;
    this.lastStep = idx;
    const d = horizontalDistance(this.getWorldPosition(), this.player.getWorldPosition());
    if (d < 14) this.player.startCameraShake(0.05 * (1 - d / 14) + 0.012, 0.16, 32);
  }

  private clawPose() {
    const B = CONFIG.boss, r = this.rig, t = this.actT;
    const strike = 0.2, recover = 0.45;
    const wu = smooth(clamp01(t / B.clawWindup));
    const st = smooth(clamp01((t - B.clawWindup) / strike));
    const rc = smooth(clamp01((t - B.clawWindup - strike) / recover));
    const k = 1 - rc;
    // Правая рука уходит за голову, затем рубит сверху вниз вперёд; корпус закручивается вслед.
    r.armR.rotation.x += (-3.1 * wu + 2.7 * st) * k;
    r.elbowR.rotation.x += -0.5 * wu * k;
    r.armL.rotation.x += 0.6 * wu * k;
    r.spine.rotation.x += (-0.2 * wu + 0.5 * st) * k;
    r.spine.rotation.y += (-0.35 * wu + 0.7 * st) * k;
    r.neck.rotation.x += 0.2 * st * k;
    r.jaw.rotation.x += 0.5 * st * k;
  }

  private tailPose() {
    const B = CONFIG.boss, r = this.rig, t = this.actT;
    const spin = 0.6, recover = 0.5;
    const wu = smooth(clamp01(t / B.tailWindup));
    const sp = clamp01((t - B.tailWindup) / spin);
    const rc = smooth(clamp01((t - B.tailWindup - spin) / recover));
    const k = 1 - rc;
    const curl = wu * (1 - smooth(sp)); // хвост сворачивается при замахе и выбрасывается в вращении
    r.spine.rotation.y += 0.9 * curl * k;
    r.spine.rotation.x += 0.12 * wu * k;
    r.hips.position.y -= 0.12 * wu * k;
    r.armL.rotation.z += -(0.7 * wu + 0.6 * sp) * k;
    r.armR.rotation.z += (0.7 * wu + 0.6 * sp) * k;
    r.tail.forEach((seg, i) => {
      seg.rotation.y += 0.3 * curl * k;
      if (i === 0) seg.rotation.x += 0.35 * smooth(sp) * k; // хвост поднимается к горизонтали
    });
    r.jaw.rotation.x += 0.4 * sp * k;
  }

  private lobPose() {
    const B = CONFIG.boss, r = this.rig, t = this.actT;
    const release = 0.18, recover = 0.4;
    const wu = smooth(clamp01(t / B.lavaWindup));
    const st = smooth(clamp01((t - B.lavaWindup) / release));
    const rc = smooth(clamp01((t - B.lavaWindup - release) / recover));
    const k = 1 - rc;
    r.armR.rotation.x += (-3.0 * wu + 2.3 * st) * k;
    r.elbowR.rotation.x += -0.8 * wu * k;
    r.armL.rotation.x += 0.5 * wu * k;
    r.spine.rotation.x += (-0.25 * wu + 0.55 * st) * k;
    r.spine.rotation.y += (-0.4 * wu + 0.8 * st) * k;
  }

  private roarPose() {
    const r = this.rig, T = CONFIG.boss.roarTime, t = this.roarT;
    const e = 0.15;
    const a = clamp01(t / e) * (1 - clamp01((t - (T - e)) / e));
    r.armL.rotation.z += -1.1 * a;
    r.armR.rotation.z += 1.1 * a;
    r.armL.rotation.x += -0.4 * a;
    r.armR.rotation.x += -0.4 * a;
    r.neck.rotation.x += -0.6 * a;
    r.spine.rotation.x += -0.3 * a;
    r.jaw.rotation.x += 0.8 * a;
    r.spine.rotation.z += Math.sin(t * 60) * 0.02 * a;
  }

  // ----- Смерть: колени подгибаются, голова и руки повисают, тело заваливается, свечение гаснет -----
  protected get deathDuration() { return DEATH_TIME; }

  protected onDeathPose(t: number) {
    const r = this.rig, b = smooth(clamp01(t / 0.45));
    r.thighL.rotation.x = -0.9 * b;
    r.thighR.rotation.x = -0.6 * b;
    r.kneeL.rotation.x = 1.5 * b;
    r.kneeR.rotation.x = 1.2 * b;
    r.hips.position.y = HIPS_Y - 0.45 * b;
    r.spine.rotation.x = REST_LEAN + 0.7 * b;
    r.spine.rotation.z = 0.12 * b;
    r.neck.rotation.x = 0.7 * b;
    r.jaw.rotation.x = 0.9 * b;
    r.armL.rotation.x = 0.3 * b;
    r.armR.rotation.x = 0.1 * b;
    r.armL.rotation.z = -0.5 * b;
    r.armR.rotation.z = 0.5 * b;
    r.tail.forEach((seg) => (seg.rotation.y *= 1 - 0.05 * b));
    // Лава остывает: трещины и глаза тускнеют.
    const cool = 1 - 0.85 * smooth(clamp01(t / 0.9));
    this.mats.glow.emissiveColor.set(1 * cool, 0.78 * cool, 0.15 * cool);
    this.mats.ember.emissiveColor.set(1 * cool, 0.34 * cool, 0.05 * cool);
    const tex = this.mats.skin.emissiveTexture;
    if (tex) tex.level = cool;
  }

  protected toppleFraction(t: number) {
    const u = clamp01((t - 0.4) / 0.6);
    return smooth(u) + Math.sin(u * Math.PI) * 0.04;
  }
}
