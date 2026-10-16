import { Mesh, MeshBuilder, Scene, StandardMaterial, Texture, Color3 } from "@babylonjs/core";
import { canvasTexture } from "../utils/textures";

const TEX_SIZE = 64;

/** Рисует пентаграмму в круге на прозрачном фоне. Спящая — тусклая, активная — яркая со свечением. */
function pentagramTexture(scene: Scene, active: boolean): Texture {
  const { tex, ctx: c } = canvasTexture(scene, TEX_SIZE, TEX_SIZE);
  const cx = TEX_SIZE / 2, cy = TEX_SIZE / 2, R = 26;
  c.clearRect(0, 0, TEX_SIZE, TEX_SIZE);

  if (active) {
    c.fillStyle = "rgba(255,70,30,0.35)";
    c.beginPath(); c.arc(cx, cy, 31, 0, Math.PI * 2); c.fill();
  }
  c.fillStyle = active ? "rgba(40,4,2,0.95)" : "rgba(14,3,3,0.92)";
  c.beginPath(); c.arc(cx, cy, R + 3, 0, Math.PI * 2); c.fill();

  c.strokeStyle = active ? "#ff4a22" : "#4e3208";
  c.lineWidth = active ? 3 : 2;
  c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();

  // Пятиконечная звезда: вершины через одну.
  c.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
    const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.closePath();
  c.stroke();

  tex.hasAlpha = true;
  tex.update();
  return tex;
}

/**
 * Плоский переключатель-пентаграмма на стене или предмете.
 * Активируется попаданием из оружия игрока: меш помечен metadata.secret = id.
 */
export class PentagramSwitch {
  readonly mesh: Mesh;
  private active = false;
  private readonly material: StandardMaterial;
  private readonly texOff: Texture;
  private readonly texOn: Texture;

  /** normal — направление наружу из поверхности (x, z): куда «смотрит» пентаграмма. */
  constructor(
    scene: Scene,
    readonly id: string,
    position: [number, number, number],
    normal: [number, number],
    size: number,
  ) {
    this.texOff = pentagramTexture(scene, false);
    this.texOn = pentagramTexture(scene, true);

    this.material = new StandardMaterial(`secret_${id}_mat`, scene);
    this.material.diffuseColor = Color3.Black();
    this.material.specularColor = Color3.Black();
    this.material.emissiveTexture = this.texOff;
    this.material.opacityTexture = this.texOff;
    this.material.backFaceCulling = false;
    this.material.zOffset = -2; // не мерцает на плоскости стены

    this.mesh = MeshBuilder.CreatePlane(`secret_${id}`, { size }, scene);
    this.mesh.position.set(position[0], position[1], position[2]);
    this.mesh.rotation.y = Math.atan2(normal[0], normal[1]);
    this.mesh.material = this.material;
    this.mesh.isPickable = true;
    this.mesh.checkCollisions = false;
    this.mesh.metadata = { secret: id };
  }

  get isActive() {
    return this.active;
  }

  /** Скрытый секрет не рисуется и не принимает попадания, пока его не показали. */
  setVisible(visible: boolean) {
    this.mesh.setEnabled(visible);
  }

  activate() {
    if (this.active) return;
    this.active = true;
    this.material.emissiveTexture = this.texOn;
    this.material.opacityTexture = this.texOn;
  }
}
