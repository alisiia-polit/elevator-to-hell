import { Color3, HemisphericLight, PointLight } from "@babylonjs/core";

/**
 * Управление освещением одного этажа (лампы этажа + общий рассеянный свет) для сюжетных сцен:
 * красное мигание при появлении босса, затем тревожное красное освещение. Исходные значения запоминаются.
 */
export class FloorLighting {
  private readonly base: Array<{ light: PointLight; color: Color3; intensity: number }>;
  private readonly ambientColor: Color3;
  private readonly ambientIntensity: number;

  constructor(lamps: PointLight[], private readonly ambient: HemisphericLight) {
    this.base = lamps.map((light) => ({ light, color: light.diffuse.clone(), intensity: light.intensity }));
    this.ambientColor = ambient.diffuse.clone();
    this.ambientIntensity = ambient.intensity;
  }

  /** color — цвет света; lampK и ambientK — множители исходной яркости ламп и рассеянного света. */
  set(color: Color3, lampK: number, ambientK: number) {
    for (const b of this.base) {
      b.light.diffuse.copyFrom(color);
      b.light.intensity = b.intensity * lampK;
    }
    this.ambient.diffuse.copyFrom(color);
    this.ambient.intensity = this.ambientIntensity * ambientK;
  }

  /** Вернуть исходное освещение. */
  restore() {
    for (const b of this.base) {
      b.light.diffuse.copyFrom(b.color);
      b.light.intensity = b.intensity;
    }
    this.ambient.diffuse.copyFrom(this.ambientColor);
    this.ambient.intensity = this.ambientIntensity;
  }
}
