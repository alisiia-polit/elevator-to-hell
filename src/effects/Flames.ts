import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";

/** Источник пламени: «коробка» в локальных координатах узла, из которой вырываются языки огня. */
export interface FlameSourceOptions {
  /** Размеры области появления (x, y, z), м; центр — в начале координат узла. */
  box: [number, number, number];
  /** Языков огня в секунду. */
  rate: number;
  /** Скорость подъёма, м/с. */
  rise?: number;
  /** Разброс по горизонтали, м/с. */
  drift?: number;
  /** Размер языка (ребро куба), м. */
  size?: number;
  /** Время жизни, с. */
  life?: number;
}

export interface FlameSource extends Required<FlameSourceOptions> {
  node: TransformNode;
  acc: number;
  scale: number;
}

interface Particle {
  mesh: Mesh;
  life: number;
  total: number;
  size: number;
  vel: Vector3;
  stage: number;
}

/**
 * Пиксельное пламя в стиле игры: пул маленьких светящихся кубов. Цвет по ходу жизни:
 * жёлтый → оранжевый → тёмно-красный, куб при этом уменьшается и поднимается. Частицы летят в мировых координатах,
 * поэтому на движущемся теле остаётся шлейф. Три общих материала, никаких текстур.
 */
export class FlameField {
  private readonly sources: FlameSource[] = [];
  private readonly pool: Particle[] = [];
  private readonly active: Particle[] = [];
  private readonly materials: StandardMaterial[];
  private enabled = true;
  /** Общий множитель частоты всех источников (0 — огонь гаснет). */
  intensity = 1;

  constructor(scene: Scene, poolSize: number, private readonly gravity = 1.2) {
    const mat = (name: string, c: Color3) => {
      const m = new StandardMaterial(`flame_${name}_mat`, scene);
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      m.emissiveColor = c;
      m.disableLighting = true;
      return m;
    };
    this.materials = [mat("hot", new Color3(1, 0.85, 0.3)), mat("mid", new Color3(1, 0.4, 0.05)), mat("cool", new Color3(0.55, 0.06, 0.02))];

    const base = MeshBuilder.CreateBox("flame_base", { size: 1 }, scene);
    base.isVisible = false;
    base.isPickable = false;
    for (let i = 0; i < poolSize; i++) {
      const mesh = base.clone(`flame_${i}`);
      mesh.isVisible = true;
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      mesh.material = this.materials[0];
      mesh.setEnabled(false);
      this.pool.push({ mesh, life: 0, total: 1, size: 0.3, vel: new Vector3(), stage: 0 });
    }
    base.setEnabled(false);
  }

  addSource(node: TransformNode, opts: FlameSourceOptions): FlameSource {
    const src: FlameSource = {
      node,
      acc: Math.random(),
      scale: 1,
      box: opts.box,
      rate: opts.rate,
      rise: opts.rise ?? 1.6,
      drift: opts.drift ?? 0.35,
      size: opts.size ?? 0.28,
      life: opts.life ?? 0.7,
    };
    this.sources.push(src);
    return src;
  }

  /** Включить/выключить появление новых языков (уже летящие догорают). */
  setEnabled(on: boolean) {
    this.enabled = on;
  }

  /** Разовый выброс огня в точке (взрыв, вспышка). */
  burst(pos: Vector3, count: number, spread = 3, size = 0.4, life = 0.7) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * spread;
      this.spawn(
        pos.x, pos.y, pos.z,
        Math.cos(a) * r, 1 + Math.random() * 2.4, Math.sin(a) * r,
        size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.7),
      );
    }
  }

  update(dt: number) {
    if (this.enabled && this.intensity > 0) {
      for (const s of this.sources) {
        s.acc += s.rate * s.scale * this.intensity * dt;
        if (s.acc < 1) continue;
        const m = s.node.getWorldMatrix();
        while (s.acc >= 1) {
          s.acc -= 1;
          const local = new Vector3((Math.random() - 0.5) * s.box[0], (Math.random() - 0.5) * s.box[1], (Math.random() - 0.5) * s.box[2]);
          const w = Vector3.TransformCoordinates(local, m);
          this.spawn(
            w.x, w.y, w.z,
            (Math.random() - 0.5) * s.drift * 2, s.rise * (0.7 + Math.random() * 0.6), (Math.random() - 0.5) * s.drift * 2,
            s.size * (0.65 + Math.random() * 0.7), s.life * (0.7 + Math.random() * 0.6),
          );
        }
      }
    }

    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.setEnabled(false);
        this.active.splice(i, 1);
        this.pool.push(p);
        continue;
      }
      const t = 1 - p.life / p.total; // 0 → 1
      p.vel.y += this.gravity * dt;
      p.mesh.position.addInPlace(p.vel.scale(dt));
      p.mesh.scaling.setAll(p.size * (1 - t * 0.85));
      const stage = t < 0.3 ? 0 : t < 0.65 ? 1 : 2;
      if (stage !== p.stage) {
        p.stage = stage;
        p.mesh.material = this.materials[stage];
      }
    }
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number) {
    const p = this.pool.pop();
    if (!p) return; // пул исчерпан — язык пропускаем
    p.life = p.total = life;
    p.size = size;
    p.vel.set(vx, vy, vz);
    p.stage = 0;
    p.mesh.material = this.materials[0];
    p.mesh.position.set(x, y, z);
    p.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    p.mesh.scaling.setAll(size);
    p.mesh.setEnabled(true);
    this.active.push(p);
  }
}
