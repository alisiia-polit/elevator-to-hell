import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { canvasTexture } from "../utils/textures";

/**
 * Заглушка финального босса: парящая надпись в холле (этаж 0).
 * Настоящий босс будет разработан позже — этот класс нужно будет заменить.
 */
export class FinalBossPlaceholder {
  private readonly mesh: Mesh;
  private readonly baseY: number;
  private time = 0;

  constructor(scene: Scene, position: Vector3) {
    const { tex, ctx: c } = canvasTexture(scene, 512, 128);
    c.clearRect(0, 0, 512, 128);
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.shadowColor = "#ff2a00";
    c.shadowBlur = 10;
    c.fillStyle = "#ff5a2a";
    c.font = "bold 46px 'Courier New', monospace";
    c.fillText("ФІНАЛЬНИЙ БОС", 256, 48);
    c.shadowBlur = 0;
    c.fillStyle = "#d8c9a0";
    c.font = "28px 'Courier New', monospace";
    c.fillText("(заглушка)", 256, 96);
    tex.hasAlpha = true;
    tex.update();

    const mat = new StandardMaterial("final_boss_placeholder_mat", scene);
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.backFaceCulling = false;
    mat.fogEnabled = false;

    this.mesh = MeshBuilder.CreatePlane("final_boss_placeholder", { width: 4, height: 1 }, scene);
    this.mesh.material = mat;
    this.mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.mesh.isPickable = false;
    this.mesh.position.copyFrom(position);
    this.baseY = position.y;
  }

  update(dt: number) {
    this.time += dt;
    this.mesh.position.y = this.baseY + Math.sin(this.time * 1.6) * 0.12;
  }
}
