import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { canvasTexture } from "../utils/textures";

export interface FloatingLabelOptions {
  /** Крупная верхняя строка. */
  title: string;
  /** Мелкая нижняя строка (необязательна). */
  subtitle?: string;
  /** Цвет и свечение заголовка. */
  titleColor?: string;
  glowColor?: string;
  /** Цвет нижней строки. */
  subtitleColor?: string;
  /** Размер плоскости в мире, м. */
  width?: number;
  height?: number;
  /** Амплитуда и скорость покачивания по вертикали. */
  bobAmplitude?: number;
  bobSpeed?: number;
}

/**
 * Парящая в мире надпись, всегда повёрнутая к камере: для ввода в курс дела, подсказок и пометок.
 * Раньше этот класс был заглушкой финального босса (FinalBossPlaceholder).
 *
 *   const hint = new FloatingLabel(scene, new Vector3(0, 2.2, -1), { title: "ПІДКАЗКА", subtitle: "стріляйте по знаку" });
 *   // в игровом цикле: hint.update(dt);  когда не нужна: hint.dispose();
 */
export class FloatingLabel {
  private readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private readonly baseY: number;
  private readonly bobAmplitude: number;
  private readonly bobSpeed: number;
  private time = 0;

  constructor(scene: Scene, position: Vector3, options: FloatingLabelOptions) {
    const o = options;
    const { tex, ctx: c } = canvasTexture(scene, 512, 128);
    c.clearRect(0, 0, 512, 128);
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.shadowColor = o.glowColor ?? "#ff2a00";
    c.shadowBlur = 10;
    c.fillStyle = o.titleColor ?? "#ff5a2a";
    c.font = "bold 46px 'Courier New', monospace";
    c.fillText(o.title, 256, o.subtitle ? 48 : 64);
    if (o.subtitle) {
      c.shadowBlur = 0;
      c.fillStyle = o.subtitleColor ?? "#d8c9a0";
      c.font = "28px 'Courier New', monospace";
      c.fillText(o.subtitle, 256, 96);
    }
    tex.hasAlpha = true;
    tex.update();

    this.material = new StandardMaterial("floating_label_mat", scene);
    this.material.diffuseColor = Color3.Black();
    this.material.specularColor = Color3.Black();
    this.material.emissiveTexture = tex;
    this.material.opacityTexture = tex;
    this.material.backFaceCulling = false;
    this.material.fogEnabled = false;

    this.mesh = MeshBuilder.CreatePlane("floating_label", { width: o.width ?? 4, height: o.height ?? 1 }, scene);
    this.mesh.material = this.material;
    this.mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.mesh.isPickable = false;
    this.mesh.position.copyFrom(position);
    this.baseY = position.y;
    this.bobAmplitude = o.bobAmplitude ?? 0.12;
    this.bobSpeed = o.bobSpeed ?? 1.6;
  }

  update(dt: number) {
    this.time += dt;
    this.mesh.position.y = this.baseY + Math.sin(this.time * this.bobSpeed) * this.bobAmplitude;
  }

  setVisible(visible: boolean) {
    this.mesh.setEnabled(visible);
  }

  dispose() {
    this.mesh.dispose();
    this.material.dispose();
  }
}
