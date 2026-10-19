import {
  Color3,
  Color4,
  Engine,
  Scene,
  Vector3,
} from "@babylonjs/core";

import { CONFIG } from "./config";
import { Elevator } from "./elevator/Elevator";
import { buildWorld } from "./levels/World";
import {
  NpcEnv,
  spawnNpcs,
} from "./npc/Npc";
import { BossEncounter } from "./monsters/BossEncounter";
import { computeScore } from "./score";
import { MonsterManager } from "./monsters/MonsterManager";
import { Player } from "./player/Player";
import { Weapon } from "./player/Weapon";
import { WEAPON_LABELS } from "./player/WeaponModels";
import { Secrets } from "./secrets/Secrets";
import { Hud, ResultStats } from "./ui/Hud";

const canvas =
  document.getElementById(
    "game",
  ) as HTMLCanvasElement;

const engine = new Engine(
  canvas,
  false,
  { stencil: false },
);

engine.setHardwareScalingLevel(
  CONFIG.render.pixelScale,
);

const scene = new Scene(engine);

scene.collisionsEnabled = true;
scene.clearColor =
  new Color4(0.02, 0.02, 0.03, 1);

scene.fogMode = Scene.FOGMODE_EXP2;
scene.fogDensity =
  CONFIG.render.fogDensity;
scene.fogColor =
  new Color3(0.03, 0.03, 0.04);

const world = buildWorld(scene);

const npcs = spawnNpcs(
  scene,
  world.cabin.root,
);

const player = new Player(
  scene,
  canvas,
  world.spawn,
  world.spawnYaw,
);

const weapon = new Weapon(
  scene,
  player,
);

const hud = new Hud();

const elevator = new Elevator(
  scene,
  world.cabin,
  world.landing,
  player,
  npcs,
  (t) => hud.toast(t),
);

const monsters = new MonsterManager(
  scene,
  player,
  npcs,
  world.cabin.root,
);

const secrets = new Secrets(scene, world.sky);

// Финальный босс: сцена появления и бой запускаются после активации пятого секрета.
let encounter: BossEncounter | null = null;

let ending = false;

// Время игры: считается, пока игра не на паузе и не закончена.
let playTime = 0;
let paused = true;

const formatTime = (seconds: number) => {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");

  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

const gameStats = (won: boolean): ResultStats => {
  const { killed, total } = monsters.totalStats();
  const npcEnraged = npcs.filter((n) => n.wasEnraged).length;

  return {
    time: formatTime(playTime),
    monstersKilled: killed,
    monstersTotal: total,
    secretsFound: secrets.activatedCount,
    secretsTotal: secrets.total,
    health: player.health,
    maxHealth: player.maxHealth,
    npcEnraged,
    npcTotal: npcs.length,
    score: computeScore({
      playSeconds: playTime,
      won,
      bossKilled: encounter?.bossKilled ?? false,
      monstersKilled: killed,
      monstersTotal: total,
      npcEnraged,
      npcTotal: npcs.length,
      secretsRegular: secrets.regularActivatedCount,
      finalSecretFound: secrets.finaleActivated,
      health: player.health,
      maxHealth: player.maxHealth,
    }),
  };
};

// Счётчик монстров включается при первом открытии дверей лифта на этаже с монстрами.
let monsterCounterShown = false;

const restartGame = () => {
  const url =
    new URL(window.location.href);

  url.searchParams.set(
    "restart",
    String(Date.now()),
  );

  window.location.assign(
    url.toString(),
  );
};

const showGameOver = () => {
  if (ending) return;

  ending = true;

  player.freezeInput(true);
  player.enableFreeLook();

  weapon.hide();
  monsters.freezeLiving();

  hud.showResult(
    "GAME OVER",
    player.deathReason,
    gameStats(false),
    restartGame,
  );
};

const finishVictory = (
  message: string,
) => {
  if (ending) return;

  ending = true;

  player.freezeInput(true);
  player.enableFreeLook();

  weapon.hide();
  monsters.freezeLiving();

  hud.setEnding();

  const delay =
    CONFIG.result.delayBeforeMessage *
    1000;

  window.setTimeout(() => {
    if (!ending) return;

    hud.showResult(
      "YOU WIN",
      message,
      gameStats(true),
      restartGame,
    );
  }, delay);
};

monsters.setDoorOpenProvider(() => elevator.exitOpen());
monsters.onGrenadeThrown = (origin) => hud.warnGrenade(origin);

elevator.onArrived = (floor) =>
  monsters.spawnForFloor(floor);

// Победа: уничтожены все монстры на всех этажах, и при этом ни один секрет не активирован.
monsters.setVictoryGate(
  () => secrets.activatedCount === 0,
);

monsters.onVictory = () =>
  finishVictory(
    "ВСІХ МОНСТРІВ ЗНИЩЕНО — ПЕРЕМОГА",
  );

weapon.onShotRay = (origin, direction) =>
  secrets.shotFired(origin, direction);

weapon.onSecretMesh = (mesh) =>
  secrets.hitMesh(mesh);

secrets.onActivated = (info) => {
  hud.setSecretsRemaining(info.remaining);

  if (info.isFinale) {
    encounter = new BossEncounter({
      scene,
      player,
      npcs,
      elevator,
      doors: [world.landing.get(0)!, world.cabin.door],
      lighting: world.hallLighting,
      nav: monsters.navFor(0),
      say: (t, ms) => hud.toast(t, ms),
      onLavaThrown: (origin) => hud.warnGrenade(origin),
      onDefeated: () => finishVictory("ФІНАЛЬНОГО БОСА ПОВЕРЖЕНО — ПЕРЕМОГА"),
    });
    encounter.begin();
    return;
  }

  hud.toast(
    `СЕКРЕТ АКТИВОВАНО! Залишилось секретів: ${info.remaining}`,
    4500,
  );
};

weapon.onPickup = (type) => {
  hud.toast(
    `ПІДІБРАНО: ${WEAPON_LABELS[type]}`,
    1800,
  );
};

player.onDamage = (hp) => {
  hud.bloodSplash(64);

  // Индикатор здоровья появляется при первом уроне и дальше обновляется.
  hud.setHealth(
    Math.round((hp / player.maxHealth) * 100),
  );
};

const env: NpcEnv = {
  cabin: world.cabin.root,
  scene,
  player,
  weapon,
  elevator,
  npcs,
  nav: (floor: number) => monsters.navFor(floor),
};

npcs.forEach(
  (npc) => (npc.env = env),
);

hud.setPaused(true);

hud.onStart(() =>
  player.requestLock(),
);

hud.onRestart(restartGame);

player.onLockChange = (locked) => {
  paused = !locked;

  if (!ending && player.alive) {
    hud.setPaused(!locked);
  }
};

player.onToggleWeapon = () =>
  weapon.toggle();

player.onFire = () =>
  weapon.fire();

player.onFireHeld = () =>
  weapon.fireHeld();

player.onInteract = () => {
  // Сначала проверяем оружие.
  // Если рядом pickup — кнопка E забирает его
  // и не нажимает кнопку лифта.
  if (weapon.interact()) {
    return;
  }

  const key =
    elevator.pickKey();

  if (key !== null) {
    elevator.press(key);
  }
};

scene.onBeforeRenderObservable.add(
  () => {
    const dt = Math.min(
      engine.getDeltaTime() / 1000,
      0.05,
    );

    world.lava.update(dt);

    if (!ending && !paused) {
      playTime += dt;
    }

    if (!ending) {
      const weaponHint =
        weapon.getPickupHint();

      if (weaponHint !== null) {
        hud.setHint(
          weaponHint,
        );
      } else {
        const key =
          elevator.pickKey();

        if (key === null) {
          hud.setHint(null);
        } else if (key === "stop") {
          hud.setHint(
            "E — аварійна зупинка",
          );
        } else {
          hud.setHint(
            "E — поверх",
          );
        }
      }

      elevator.update(dt);
      weapon.update(dt);
    }

    encounter?.update(dt, ending);
    if (!ending) hud.setBossHealth(encounter?.bossBar ?? null);
    secrets.update(dt);

    if (!ending) {
      const stats =
        elevator.moving
          ? null
          : monsters.waveStats(
              elevator.floor,
            );

      if (
        !monsterCounterShown &&
        stats &&
        elevator.exitOpen()
      ) {
        monsterCounterShown = true;
      }

      if (monsterCounterShown && stats) {
        hud.setMonsters(
          stats.killed,
          stats.total,
        );
      } else {
        hud.hideMonsters();
      }
    }

    npcs.forEach(
      (npc) =>
        npc.update(dt, ending),
    );

    player.update(dt);

    elevator.constrainPlayer();

    if (
      !ending &&
      !player.alive
    ) {
      showGameOver();
    }

    // Индикация броска гранаты: стрелка у края экрана со стороны, откуда бросили.
    const eye = player.getEyeRay(1);
    const pp = player.getWorldPosition();
    hud.updateWarning(dt, pp.x, pp.z, Math.atan2(eye.direction.x, eye.direction.z));

    monsters.update(dt);
  },
);

engine.runRenderLoop(() =>
  scene.render(),
);

window.addEventListener(
  "resize",
  () => engine.resize(),
);