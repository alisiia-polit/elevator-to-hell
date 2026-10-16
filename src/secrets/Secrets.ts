import { AbstractMesh, Ray, Scene, Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import { MOON_POSITION } from "../levels/Sky";
import { RadiationSwitch } from "./RadiationSwitch";
import { SECRET_DEFS } from "./secretDefs";

export interface SecretActivation {
  id: string;
  floor: number;
  /** Сколько секретов осталось на всю игру (включая финальный). */
  remaining: number;
  /** Это и был финальный секрет. */
  isFinale: boolean;
}

/**
 * Секреты игры. Активируются только оружием игрока:
 * знаки радиации — попаданием в меш (metadata.secret), луна — выстрелом в её сторону на крыше.
 * Финальный секрет на этаже 0 появляется после активации всех остальных.
 */
export class Secrets {
  readonly total = SECRET_DEFS.length;

  private readonly switches = new Map<string, RadiationSwitch>();
  private readonly activated = new Set<string>();
  private readonly moonDir = MOON_POSITION.normalizeToNew();

  onActivated: (info: SecretActivation) => void = () => {};

  constructor(
    private readonly scene: Scene,
    private readonly sky: { crackMoon: () => void },
  ) {
    for (const def of SECRET_DEFS) {
      if (def.kind !== "switch") continue;
      const y0 = def.floor * CONFIG.elevator.floorHeight;
      const p = def.position!;
      const sw = new RadiationSwitch(
        scene,
        def.id,
        [p[0], p[1] + y0, p[2]],
        def.normal!,
        def.size ?? CONFIG.secrets.switchSize,
        !!def.finale,
      );
      if (def.finale) sw.setVisible(false);
      this.switches.set(def.id, sw);
    }
  }

  get activatedCount() {
    return this.activated.size;
  }

  get remaining() {
    return this.total - this.activated.size;
  }

  /** Анимация зловещего финального секрета. */
  update(dt: number) {
    for (const sw of this.switches.values()) sw.update(dt);
  }

  /** Попадание оружия игрока в меш (хитскан, ракета, рельсотрон). */
  hitMesh(mesh: AbstractMesh | null | undefined) {
    const id = mesh?.metadata?.secret;
    if (typeof id === "string") this.activate(id);
  }

  /**
   * Выстрел игрока: проверяет, смотрит ли он в луну.
   * Луна нарисована с infiniteDistance, поэтому обычный pick её не видит — считаем по направлению.
   */
  shotFired(origin: Vector3, direction: Vector3) {
    const moon = SECRET_DEFS.find((d) => d.kind === "moon");
    if (!moon || this.activated.has(moon.id)) return;

    // Луну видно только с крыши.
    if (origin.y < moon.floor * CONFIG.elevator.floorHeight) return;

    const dir = direction.normalizeToNew();
    if (Vector3.Dot(dir, this.moonDir) < Math.cos(CONFIG.secrets.moonHitAngle)) return;

    // Между игроком и небом не должно быть потолка кабины, стен и предметов.
    const blocked = this.scene.pickWithRay(
      new Ray(origin, dir, CONFIG.secrets.moonRayLength),
      (m) =>
        m.isEnabled() &&
        m.isPickable &&
        !m.metadata?.monster &&
        !m.metadata?.npc &&
        !m.metadata?.secret,
    );
    if (blocked?.hit) return;

    this.activate(moon.id);
  }

  private activate(id: string) {
    const def = SECRET_DEFS.find((d) => d.id === id);
    if (!def || this.activated.has(id)) return;
    // Финальный секрет не принимает попадания, пока скрыт.
    if (def.finale && !this.allBaseActivated()) return;

    this.activated.add(id);
    this.switches.get(id)?.activate();
    if (def.kind === "moon") this.sky.crackMoon();

    if (!def.finale && this.allBaseActivated()) {
      for (const d of SECRET_DEFS) if (d.finale) this.switches.get(d.id)?.setVisible(true);
    }

    this.onActivated({
      id,
      floor: def.floor,
      remaining: this.remaining,
      isFinale: !!def.finale,
    });
  }

  private allBaseActivated() {
    return SECRET_DEFS.filter((d) => !d.finale).every((d) => this.activated.has(d.id));
  }
}
