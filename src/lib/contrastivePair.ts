import type { AttackPattern } from "@/types/attackPattern";
import { LEVER_KEYS } from "@/lib/levers";
import type { LeverKey } from "@/lib/weights";

// ── 鏡像汚染ガード（対照ペア検証）— 純粋・LLM 非依存 ──────────────────────
//
// 山場（標的型/BEC）の検証データを "集める" のは道B（完全な詐欺文面を保存しない）と
// ゼロ段（ラベル枯渇）の二重の壁にぶつかる。だから "生成する" に切り替える——ただし
// 系統分離（生成器は文を書くが採点もラベル付けもしない）を守る *盲変異ペア* として。
//
// 盲変異ペア = effective-benign（正規なのにレバーが立つ本物寄り）を土台に、target レバー
// *1個だけ* を自然な一文で足した対。ラベルは「動かしたレバー」という構成事実。
//
// 素朴な「1レバー反転」は鏡像構成そのもので、holdout 規律（鏡像汚染禁止）が名指しで
// 禁じる。だからこのガードが二重ゲートの (i) を機械化する:
//   「base と mutated を *多数決* でレバー抽出し、target の指紋 *だけ* が動き他は不変」
// を確認する。多数決なのは analyzeStructure が非決定（probeMajorityVote の一件）で、
// 単発再抽出だと妥当なペアが偶発ドリフトで落ちるため。
//
// このモジュールに LLM・ネットワークは入らない（決定論＝テスト対象）。実 analyzeStructure
// を K 回叩く LIVE 抽出は runner（scripts/validateContrastivePairs.ts）側。

type Levers = AttackPattern["levers"];

// 1 回の analyzeStructure 抽出結果（levers＋縮退フラグ）。runner が K 個渡す。
export type Draw = { levers: Levers; degraded: boolean };

// レバーの正準指紋（score に効く全フィールドを含む・probeMajorityVote と同一形）。
// 2 つのレバーが同指紋 ⇔ score 上等価。指紋差 = 「動いた」の定義。intensity のみの
// ドリフトも指紋差になる（score を動かすので汚染として捕捉すべき）。
export function leverFingerprint(key: LeverKey, l: Levers): string {
  switch (key) {
    case "urgency":
      return `${l.urgency.tactic}/i${l.urgency.intensity}`;
    case "authority":
      return `${l.authority.impersonates}/[${[...l.authority.credibilityTricks].sort().join(",")}]`;
    case "incentive":
      return `${l.incentive.type}/${l.incentive.hook}/i${l.incentive.intensity}`;
    case "callToAction":
      return `${l.callToAction.action}/${l.callToAction.friction}`;
    case "personalization":
      return `${l.personalization.level}/[${[...l.personalization.signals].sort().join(",")}]`;
    case "isolation":
      return `${l.isolation.tactic}/i${l.isolation.intensity}`;
  }
}

// 指紋が異なるレバー鍵の一覧（＝ base→mutated で "動いた" レバー）。
export function changedLevers(a: Levers, b: Levers): LeverKey[] {
  return LEVER_KEYS.filter(
    (k) => leverFingerprint(k, a) !== leverFingerprint(k, b),
  );
}

// ratio（modeCount/validN）がこれ以下なら mode は僅差＝fragile（probeMajorityVote の
// ★僅差帯と同基準）。fragile なレバーは 1 回の再抽出で mode が裏返りうる＝ペアが
// valid に見えても不安定。
export const MODE_STABLE_RATIO = 0.6;

// 最低有効ドロー数。これ未満は多数決が成立しない＝検証保留。
export const DEFAULT_MIN_VALID_DRAWS = 3;

export type LeverVote = {
  key: LeverKey;
  modeFp: string;
  modeCount: number;
  validN: number;
  fragile: boolean;
};

export type MajorityResult = {
  modeLevers: Levers | null; // validN===0 のとき null
  votes: LeverVote[];
  validN: number;
  degradedN: number;
};

// K ドロー（縮退は除外）→ レバーごと最頻指紋（mode）→ 単一の決定論 levers。
export function majorityVote(draws: Draw[]): MajorityResult {
  const valid = draws.filter((d) => !d.degraded);
  const degradedN = draws.length - valid.length;
  const validN = valid.length;
  if (validN === 0) {
    return { modeLevers: null, votes: [], validN: 0, degradedN };
  }

  const votes: LeverVote[] = [];
  const modeLevers = {} as Record<string, unknown>;
  for (const key of LEVER_KEYS) {
    const counts = new Map<string, { count: number; rep: Levers[LeverKey] }>();
    for (const d of valid) {
      const fp = leverFingerprint(key, d.levers);
      const cur = counts.get(fp);
      if (cur) cur.count += 1;
      else counts.set(fp, { count: 1, rep: d.levers[key] });
    }
    let modeFp = "";
    let modeCount = -1;
    let rep: Levers[LeverKey] | null = null;
    for (const [fp, v] of counts) {
      if (v.count > modeCount) {
        modeFp = fp;
        modeCount = v.count;
        rep = v.rep;
      }
    }
    modeLevers[key] = rep;
    votes.push({
      key,
      modeFp,
      modeCount,
      validN,
      fragile: modeCount / validN <= MODE_STABLE_RATIO,
    });
  }
  return { modeLevers: modeLevers as Levers, votes, validN, degradedN };
}

export type PairValidation = {
  valid: boolean;
  moved: LeverKey[];
  reason: string;
  // どちらか一方でも mode が僅差だったレバー（valid でもペアは不安定＝要 K 増）。
  fragile: LeverKey[];
  baseMode: Levers | null;
  mutatedMode: Levers | null;
};

// 二重ゲートの (i): base と mutated を多数決抽出し「target 指紋だけが動き他は不変」を確認。
// (ii)（人間が挿入文を "自然" と読む）はコード外＝このガードの守備範囲ではない。
export function validateContrastivePair(args: {
  baseDraws: Draw[];
  mutatedDraws: Draw[];
  targetLever: LeverKey;
  minValidDraws?: number;
}): PairValidation {
  const minValid = args.minValidDraws ?? DEFAULT_MIN_VALID_DRAWS;
  const base = majorityVote(args.baseDraws);
  const mut = majorityVote(args.mutatedDraws);
  const fragile = [
    ...new Set(
      [...base.votes, ...mut.votes].filter((v) => v.fragile).map((v) => v.key),
    ),
  ];

  if (
    base.validN < minValid ||
    mut.validN < minValid ||
    !base.modeLevers ||
    !mut.modeLevers
  ) {
    return {
      valid: false,
      moved: [],
      reason: `insufficient_valid_draws (base ${base.validN}, mutated ${mut.validN}, need ${minValid})`,
      fragile,
      baseMode: base.modeLevers,
      mutatedMode: mut.modeLevers,
    };
  }

  const moved = changedLevers(base.modeLevers, mut.modeLevers);
  if (moved.length === 1 && moved[0] === args.targetLever) {
    return {
      valid: true,
      moved,
      reason:
        fragile.length > 0
          ? `valid_but_fragile (unstable mode on: ${fragile.join(",")})`
          : "valid",
      fragile,
      baseMode: base.modeLevers,
      mutatedMode: mut.modeLevers,
    };
  }

  let reason: string;
  if (moved.length === 0) {
    reason =
      "no_lever_moved (base と mutated が同構造＝変異が構造に効いていない)";
  } else if (!moved.includes(args.targetLever)) {
    reason = `target_not_moved (moved: ${moved.join(",")}, expected: ${args.targetLever})`;
  } else {
    reason = `contamination (target 以外もドリフト: ${moved.filter((k) => k !== args.targetLever).join(",")})`;
  }
  return {
    valid: false,
    moved,
    reason,
    fragile,
    baseMode: base.modeLevers,
    mutatedMode: mut.modeLevers,
  };
}
