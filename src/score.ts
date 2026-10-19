import { CONFIG } from "./config";

export interface ScoreInput {
  /** Время игры без пауз, секунды. */
  playSeconds: number;
  won: boolean;
  bossKilled: boolean;
  monstersKilled: number;
  monstersTotal: number;
  npcEnraged: number;
  npcTotal: number;
  /** Найдено обычных секретов. */
  secretsRegular: number;
  finalSecretFound: boolean;
  health: number;
  maxHealth: number;
}

export interface ScoreLine {
  label: string;
  value: number;
}

export interface ScoreResult {
  total: number;
  lines: ScoreLine[];
}

/** Итоговый результат с разбивкой по статьям. Все значения — в CONFIG.score. Итог не бывает меньше нуля. */
export function computeScore(i: ScoreInput): ScoreResult {
  const S = CONFIG.score;
  const share = (a: number, b: number) => (b > 0 ? Math.max(0, Math.min(1, a / b)) : 0);
  const lines: ScoreLine[] = [{ label: "Базові очки", value: S.base }];

  const overtime = Math.max(0, Math.floor(i.playSeconds) - S.timePenaltyFreeSeconds);
  if (overtime > 0) lines.push({ label: `Час понад ${S.timePenaltyFreeSeconds} с (${overtime} с)`, value: -overtime * S.timePenaltyPerSecond });
  if (i.won) lines.push({ label: "Перемога", value: S.victory });
  else lines.push({ label: "Поразка", value: -S.defeatPenalty });
  const unkilled = Math.max(0, i.monstersTotal - i.monstersKilled);
  if (unkilled > 0) {
    lines.push({ label: `Невбиті монстри (${unkilled}/${i.monstersTotal})`, value: -Math.round(S.unkilledMonstersFull * share(unkilled, i.monstersTotal)) });
  }
  if (i.npcTotal > 0 && i.npcEnraged > 0) {
    lines.push({ label: `Осатанілі NPC (${i.npcEnraged}/${i.npcTotal})`, value: Math.round(S.enragedNpcsFull * share(i.npcEnraged, i.npcTotal)) });
  }
  if (i.secretsRegular > 0) lines.push({ label: `Секрети (${i.secretsRegular})`, value: i.secretsRegular * S.secret });
  if (i.finalSecretFound) lines.push({ label: "Фінальний секрет", value: S.finalSecret });
  if (i.bossKilled) lines.push({ label: "Фінальний бос знищений", value: S.bossKill });
  const hp = Math.round(S.fullHealth * share(i.health, i.maxHealth));
  if (hp > 0) lines.push({ label: "Здоров'я", value: hp });

  const total = Math.max(0, lines.reduce((sum, l) => sum + l.value, 0));
  return { total, lines };
}
