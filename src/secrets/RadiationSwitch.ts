import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, Texture } from "@babylonjs/core";
import { drawRadiationSign, SignPalette } from "../utils/radiation";
import { canvasTexture } from "../utils/textures";

const TEX_SIZE = 64;

// Обычный секрет: тусклый жёлто-чёрный знак, активный — яркий, с ядовито-зелёным свечением.
const NORMAL_OFF: SignPalette = { disc: "#7a6812", blade: "#0c0902", ring: "#0c0902" };
const NORMAL_ON: SignPalette = { disc: "#ffd61f", blade: "#050400", ring: "#050400", glow: "rgba(140,255,60,0.4)" };

// Финальный секрет: чёрный диск, кроваво-красный знак и острые лучи.
const OMINOUS_OFF: SignPalette = { disc: "#0b0304", blade: "#b01414", ring: "#8a0f0f", glow: "rgba(120,0,0,0.3)", spikes: "#5a0b0b" };
const OMINOUS_ON: SignPalette = { disc: "#1a0404", blade: "#ff5a2a", ring: "#ff3a1a", glow: "rgba(255,40,10,0.5)", spikes: "#ff2a10" };

function signTexture(scene: Scene, palette: SignPalette): Texture {
  const { tex, ctx } = canvasTexture(scene, TEX_SIZE, TEX_SIZE);
  drawRadiationSign(ctx, TEX_SIZE, palette);
  tex.hasAlpha = true;
  tex.update();
  return tex;
}

/** Тёмно-красное пятно с мягким краем: подкладка под зловещий секрет. */
function haloTexture(scene: Scene): Texture {
  const { tex, ctx: c } = canvasTexture(scene, TEX_SIZE, TEX_SIZE);
  const g = c.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, "rgba(150,0,0,0.9)");
  g.addColorStop(0.55, "rgba(70,0,0,0.55)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  c.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
  c.fillStyle = g;
  c.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  tex.hasAlpha = true;
  tex.update();
  return tex;
}

function unlitMaterial(scene: Scene, name: string, tex: Texture, zOffset: number) {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  m.emissiveTexture = tex;
  m.opacityTexture = tex;
  m.backFaceCulling = false;
  m.zOffset = zOffset; // не мерцает на плоскости стены
  return m;
}

/**
 * Плоский переключатель со знаком радиационной угрозы на стене или предмете.
 * Активируется попаданием из оружия игрока: меш помечен metadata.secret = id.
 * ominous — зловещий вид (финальный секрет): крупный чёрно-красный знак с лучами
 * и пульсирующим тёмно-красным пятном вокруг.
 */
export class RadiationSwitch {
  readonly mesh: Mesh;
  private active = false;
  private time = 0;
  private readonly material: StandardMaterial;
  private readonly texOff: Texture;
  private readonly texOn: Texture;
  private readonly halo: Mesh | null = null;
  private readonly haloMaterial: StandardMaterial | null = null;

  /** normal — направление наружу из поверхности (x, z): куда «смотрит» знак. */
  constructor(
    scene: Scene,
    readonly id: string,
    position: [number, number, number],
    normal: [number, number],
    size: number,
    private readonly ominous = false,
  ) {
    this.texOff = signTexture(scene, ominous ? OMINOUS_OFF : NORMAL_OFF);
    this.texOn = signTexture(scene, ominous ? OMINOUS_ON : NORMAL_ON);

    this.material = unlitMaterial(scene, `secret_${id}_mat`, this.texOff, -3);

    this.mesh = MeshBuilder.CreatePlane(`secret_${id}`, { size }, scene);
    this.mesh.position.set(position[0], position[1], position[2]);
    this.mesh.rotation.y = Math.atan2(normal[0], normal[1]);
    this.mesh.material = this.material;
    this.mesh.isPickable = true;
    this.mesh.checkCollisions = false;
    this.mesh.metadata = { secret: id };

    if (ominous) {
      // Пятно чуть глубже знака, у самой стены; само не принимает попаданий.
      this.haloMaterial = unlitMaterial(scene, `secret_${id}_halo_mat`, haloTexture(scene), -1);
      this.halo = MeshBuilder.CreatePlane(`secret_${id}_halo`, { size: size * 3 }, scene);
      this.halo.position.set(position[0] - normal[0] * 0.01, position[1], position[2] - normal[1] * 0.01);
      this.halo.rotation.y = this.mesh.rotation.y;
      this.halo.material = this.haloMaterial;
      this.halo.isPickable = false;
      this.halo.checkCollisions = false;
    }
  }

  get isActive() {
    return this.active;
  }

  /** Скрытый секрет не рисуется и не принимает попадания, пока его не показали. */
  setVisible(visible: boolean) {
    this.mesh.setEnabled(visible);
    this.halo?.setEnabled(visible);
  }

  activate() {
    if (this.active) return;
    this.active = true;
    this.material.emissiveTexture = this.texOn;
    this.material.opacityTexture = this.texOn;
  }

  /** Пульсация зловещего секрета: медленная в покое, частая и яркая после активации. */
  update(dt: number) {
    if (!this.ominous || !this.haloMaterial) return;
    this.time += dt;
    const speed = this.active ? 7 : 2.2;
    const wave = Math.sin(this.time * speed);
    this.haloMaterial.alpha = this.active ? 0.8 + 0.2 * wave : 0.55 + 0.3 * wave;
    // Редкое дрожание самого знака, как у неисправной лампы.
    this.material.alpha = Math.sin(this.time * 31) > 0.93 && !this.active ? 0.55 : 1;
  }
}
