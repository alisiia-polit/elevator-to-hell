import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { Door } from "../elevator/Door";
import type { Elevator } from "../elevator/Elevator";
import { FlameField, FlameSource } from "../effects/Flames";
import type { FloorLighting } from "../levels/FloorLighting";
import type { Npc } from "../npc/Npc";
import type { Player } from "../player/Player";
import { FinalBoss } from "./FinalBoss";
import { GrenadeSystem } from "./Grenades";
import type { NavGrid } from "./NavGrid";

export interface BossEncounterDeps {
  scene: Scene;
  player: Player;
  npcs: Npc[];
  elevator: Elevator;
  /** Двери лифта на нулевом этаже: шахтная и кабины (на них загорается адский огонь). */
  doors: Door[];
  lighting: FloorLighting;
  /** Навигационная сетка этажа 0. */
  nav: NavGrid;
  /** Подсказка/сообщение на экране. */
  say: (text: string, ms?: number) => void;
  /** Босс бросил кусок лавы (индикатор направления на экране). */
  onLavaThrown: (origin: Vector3) => void;
  /** Босс уничтожен. */
  onDefeated: () => void;
}

type Phase = "IDLE" | "WAIT_SEAL" | "INTRO" | "FIGHT";

const RED = new Color3(1, 0.04, 0.02);
const HELL = new Color3(1, 0.3, 0.16);
const SHAKE_STAGES: Array<[number, number, number]> = [[0, 0.05, 1.6], [1.5, 0.09, 2.0], [3.3, 0.14, 3.2]]; // [через сколько после shakeFrom, амплитуда, длительность]

/**
 * Режиссёр финала: сцена появления босса и бой.
 *
 * После активации пятого секрета: двери лифта закрываются (кто был в лифте — выброшен в центр комнаты), и 7 секунд идёт сцена
 * в таком порядке — красное мигание света этажа 0, дрожание камеры, паника NPC, двери лифта загораются адским
 * огнём и открываются, из лифта выходит босс. Затем NPC звереют и по очереди бегут на босса, подрываясь
 * (каждый снимает npcBlastFraction его здоровья).
 */
export class BossEncounter {
  readonly boss: FinalBoss;
  private readonly lava: GrenadeSystem;
  private readonly fx: FlameField;
  private readonly doorFire: FlameSource;
  private readonly hot: StandardMaterial[] = [];
  private readonly blasts: Array<{ mesh: Mesh; material: StandardMaterial; life: number }> = [];

  private phase: Phase = "IDLE";
  private t = 0;
  private heat = 0;
  private shakeStage = 0;
  private panicStarted = false;
  private doorsOpened = false;
  private bossReleased = false;
  private defeated = false;
  private restlessT = 0;
  private fightT = 0;
  private queue: Npc[] = [];
  private current: Npc | null = null;
  private gap = 0;

  constructor(private readonly d: BossEncounterDeps) {
    const B = CONFIG.boss, hz = CONFIG.level.halfZ;
    this.lava = new GrenadeSystem(d.scene, d.player, [], {
      style: "lava",
      splashDamage: B.lava.splashDamage,
      explosionRadius: B.lava.explosionRadius,
      deathReason: "ВАС СПАЛИЛА ЛАВА ФІНАЛЬНОГО БОСА",
    });
    this.lava.onLaunch = (origin) => d.onLavaThrown(origin);

    // Босс стоит в кабине лицом к комнате (север — это +z, он смотрит на юг, −z).
    const cabinZ = hz + CONFIG.level.wallThickness + 0.2 + CONFIG.elevator.cabinSize / 2;
    this.boss = new FinalBoss(d.scene, new Vector3(0, 0, cabinZ - 0.7), Math.PI, d.player, d.nav, this.lava);
    this.boss.onRoar = () => {
      d.player.startCameraShake(0.14, 0.8, 30);
      d.say("ФІНАЛЬНИЙ БОС", 3000);
    };

    // Огонь на дверях и вспышки взрывов NPC.
    this.fx = new FlameField(d.scene, 110);
    const anchor = new Mesh("door_fire_anchor", d.scene);
    anchor.position.set(0, CONFIG.elevator.cabinHeight / 2, hz - 0.1);
    anchor.isVisible = false;
    anchor.isPickable = false;
    this.doorFire = this.fx.addSource(anchor, { box: [CONFIG.elevator.doorWidth, CONFIG.elevator.cabinHeight, 0.15], rate: 70, rise: 2.2, size: 0.34, life: 0.8 });
    this.doorFire.scale = 0;

    // Створки получают собственные материалы, чтобы раскалять их, не трогая остальной этаж.
    for (const door of d.doors) {
      for (const mesh of door.meshes) {
        const mat = (mesh.material as StandardMaterial).clone(`${mesh.name}_hot`) as StandardMaterial;
        mesh.material = mat;
        this.hot.push(mat);
      }
    }
  }

  /** Запуск сцены (вызывается при активации пятого секрета). */
  begin() {
    if (this.phase === "IDLE") this.phase = "WAIT_SEAL";
  }

  get active() {
    return this.phase !== "IDLE";
  }

  /** Доля здоровья босса для шкалы: null, пока босс не стал уязвимым (сцена появления). */
  get bossBar(): number | null {
    return this.boss.ready || !this.boss.alive ? this.boss.healthFraction : null;
  }

  get bossKilled() {
    return this.phase === "FIGHT" && !this.boss.alive;
  }

  /** frozen — игра окончена: живое замирает, труп босса доигрывает анимацию. */
  update(dt: number, frozen: boolean) {
    this.fx.update(dt);
    this.updateBlasts(dt);
    if (this.phase === "IDLE") return;

    if (frozen) {
      if (!this.boss.alive) this.boss.update(dt);
      return;
    }
    this.lava.update(dt);

    if (this.phase === "WAIT_SEAL") {
      if (!this.d.elevator.canSeal()) return; // лифт ещё едет — ждём, пока встанет на нулевом этаже
      this.d.elevator.seal();
      this.phase = "INTRO";
      this.t = 0;
    }

    if (this.phase === "INTRO") {
      this.driveDoors(dt);
      this.updateIntro(dt);
    } else this.updateFight(dt);
    this.boss.update(dt);
  }

  // ----- Сцена появления (7 с) -----

  /**
   * Двери ведёт сама сцена: закрыты с первой секунды и до doorsOpenAt, затем открыты. Это независимо от лифта
   * (его update тоже двигает створки, поэтому ход удваивается — двери закрываются вдвое быстрее, что не страшно).
   * Если по какой-то причине створки не сдвинулись, через полсекунды они закрываются мгновенно.
   */
  private driveDoors(dt: number) {
    const open = this.t >= CONFIG.boss.intro.doorsOpenAt;
    for (const door of this.d.doors) {
      door.setOpen(open);
      door.update(dt);
      if (!open && this.t > 0.5 && door.open > 0.99) door.setInstant(false);
    }
  }

  private updateIntro(dt: number) {
    const I = CONFIG.boss.intro, t = (this.t += dt);

    // 1. Красное мигание освещения нулевого этажа (всю сцену, к концу чаще).
    const flick = Math.sin(t * (11 + t * 1.5)) + Math.sin(t * 5.3);
    const on = flick > -0.2;
    this.d.lighting.set(RED, on ? 2.4 : 0.1, on ? 1.7 : 0.15);

    // 2. Дрожание камеры нарастает.
    while (this.shakeStage < SHAKE_STAGES.length && t >= I.shakeFrom + SHAKE_STAGES[this.shakeStage][0]) {
      const [, amp, dur] = SHAKE_STAGES[this.shakeStage++];
      this.d.player.startCameraShake(amp, dur, 28);
    }

    // 3. NPC бегают в панике по этажу.
    if (t >= I.panicFrom) {
      if (!this.panicStarted) {
        this.panicStarted = true;
        this.d.npcs.forEach((n) => n.scare());
      }
      this.restlessT -= dt;
      if (this.restlessT <= 0) {
        this.restlessT = 1.1 + Math.random() * 0.7;
        const n = this.d.npcs.filter((x) => x.alive && !x.inCabin);
        n.forEach((x) => { if (Math.random() < 0.7) x.restless(); });
      }
    }

    // 4. Двери лифта горят адским огнём...
    if (t >= I.fireFrom) {
      this.heat = Math.min(1, this.heat + dt / 1.2);
      this.setHeat(this.heat);
      this.doorFire.scale = this.heat;
    }
    // ...и открываются.
    if (t >= I.doorsOpenAt && !this.doorsOpened) {
      this.doorsOpened = true;
      this.d.elevator.openSealed();
      this.d.say("ВСІ СЕКРЕТИ АКТИВОВАНО! ДВЕРІ ЛІФТА ГОРЯТЬ...", 3500);
    }
    // 5. Из лифта выходит босс.
    if (t >= I.bossEmergeAt && !this.bossReleased) {
      this.bossReleased = true;
      this.boss.startEmerging(I.bossStandZ);
    }

    if (this.bossReleased && this.boss.ready && t >= I.duration - 0.5) this.beginFight();
    else if (t >= I.duration + 2) this.beginFight(); // страховка
  }

  private beginFight() {
    this.phase = "FIGHT";
    this.d.lighting.set(HELL, 0.9, 0.9);
    // NPC звереют; очередь — от ближних к боссу к дальним.
    const bp = this.boss.getWorldPosition();
    this.queue = this.d.npcs
      .filter((n) => n.alive && !n.inCabin)
      .sort((a, b) => Math.hypot(a.world().x - bp.x, a.world().z - bp.z) - Math.hypot(b.world().x - bp.x, b.world().z - bp.z));
    this.queue.forEach((n) => n.enrage(this.boss, (pos) => this.onNpcBlast(pos)));
    this.gap = 0.5;
  }

  // ----- Бой -----

  private updateFight(dt: number) {
    this.fightT += dt;
    // Тревожное красное освещение с лёгкой пульсацией; огонь на дверях и их накал постепенно гаснут.
    this.d.lighting.set(HELL, 0.9 + 0.12 * Math.sin(this.fightT * 2.3), 0.9);
    this.heat = Math.max(0.25, this.heat - dt * 0.4);
    this.setHeat(this.heat);
    this.doorFire.scale = Math.max(0, this.doorFire.scale - dt * 0.5);

    if (!this.boss.alive) {
      if (!this.defeated) {
        this.defeated = true;
        this.d.say("ФІНАЛЬНОГО БОСА ПОВЕРЖЕНО!", 4000);
        this.d.onDefeated();
      }
      return;
    }

    // NPC-смертники бегут на босса по одному.
    if (this.current && this.current.alive) return;
    this.current = null;
    this.gap -= dt;
    if (this.gap > 0) return;
    while (this.queue.length) {
      const n = this.queue.shift()!;
      if (!n.alive) continue;
      this.current = n;
      n.charge();
      this.gap = CONFIG.boss.npcChargeGap;
      break;
    }
  }

  private onNpcBlast(pos: Vector3) {
    if (this.boss.alive) this.boss.damage(this.boss.maxHp * CONFIG.boss.npcBlastFraction);
    this.fx.burst(pos, 26, 2.6, 0.42, 0.8);
    const mesh = MeshBuilder.CreateSphere("npc_blast", { diameter: 1, segments: 8 }, this.d.scene);
    const material = new StandardMaterial("npc_blast_mat", this.d.scene);
    material.diffuseColor = Color3.Black();
    material.emissiveColor = new Color3(1, 0.45, 0.08);
    material.specularColor = Color3.Black();
    mesh.material = material;
    mesh.isPickable = false;
    mesh.position.copyFrom(pos);
    this.blasts.push({ mesh, material, life: 0.35 });
    const d = Math.hypot(pos.x - this.d.player.getWorldPosition().x, pos.z - this.d.player.getWorldPosition().z);
    if (d < 14) this.d.player.startCameraShake(0.08, 0.3, 34);
  }

  private updateBlasts(dt: number) {
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.life -= dt;
      const p = 1 - Math.max(0, b.life / 0.35);
      b.mesh.scaling.setAll(0.3 + p * 3.4);
      b.material.alpha = 1 - p;
      if (b.life <= 0) {
        b.mesh.dispose();
        b.material.dispose();
        this.blasts.splice(i, 1);
      }
    }
  }

  /** Накал створок дверей: тёмный металл → раскалённый оранжево-красный. */
  private setHeat(k: number) {
    for (const m of this.hot) {
      m.emissiveColor = new Color3(0.95 * k, 0.2 * k, 0.03 * k);
    }
  }
}
