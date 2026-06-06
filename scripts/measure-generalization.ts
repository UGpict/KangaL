// PLAN-v2 T2-③ 検証: 暗記 vs 汎化。最小閉ループでコーパスが育ったとき、
// 「攻撃側が一度も出していない（evolve が生成不能な）新規ホールドアウト型」を
// 検知器が新たに捕捉できるか＝汎化を観測する。
//
// 実行: GOOGLE_CLOUD_PROJECT=ai-bridging GOOGLE_CLOUD_LOCATION=us-central1 \
//        DEMO_MODE=true npx tsx scripts/measure-generalization.ts
// 要 Vertex ADC + Firestore datastore.user。
//
// ── 観測の線引き（厳守） ──────────────────────────────────────────────────
// - in-loop 走は診断（diagnose-loop-recall.ts）と同条件: 同じ固定 literal seed・
//   同じ no-break 停止ポリシー・investigate→judge→evolve の step 本体は不変。
//   *唯一の差は persistPattern を ON にする（すり抜けラウンドで書き戻す）* こと。
// - ホールドアウト評価は lever ベースの完全決定論（Gemini 不使用）:
//   total = computeScore(levers) + known-scam bonus（matchKnownScams 由来）。
//   BEFORE/AFTER の差は matchKnownScams の照合変化だけに帰属する。道B クリーン。
// - 観測を脚色しない。holdout が上がらなければ「上がらなかった」と記録。flip が
//   アーティファクト（不在一致・coin-flip）由来なら「汎化は観測されず」と書く。
// - 実行後 corpus を cleanup で空に戻す（以降の T3/T5・デモの観測を汚さないため）。

process.env.DEMO_MODE = "true";

import { Firestore } from "@google-cloud/firestore";
import { randomUUID } from "node:crypto";
import { computeScore, judge } from "@/agents/judge";
import { investigate } from "@/agents/investigate";
import { evolve } from "@/agents/attacker";
import { matchKnownScams } from "@/tools/matchKnownScams";
import {
  listAttackPatterns,
  upsertAttackPattern,
  ATTACK_PATTERN_COLLECTION,
} from "@/lib/firestore";
import {
  BONUS_KNOWN_SCAM_CAP,
  BONUS_KNOWN_SCAM_PER_MATCH,
  type LeverKey,
} from "@/lib/weights";
import { getDetectionThreshold } from "@/lib/metrics";
import {
  classifyFlipTier,
  countActiveMatches,
  type FlipTier,
  hasAnyActiveMatch,
  knownScamBonus,
} from "@/lib/generalizationCheck";
import { LEVER_KEYS, classifyMatchedLever, mainValue } from "@/lib/levers";
import type { AttackPattern } from "@/types/attackPattern";

function leverDigest(l: AttackPattern["levers"]): string {
  return [
    `urg=${l.urgency.tactic}/${l.urgency.intensity}`,
    `auth=${l.authority.impersonates}/tr${l.authority.credibilityTricks.length}`,
    `inc=${l.incentive.type}/${l.incentive.intensity}`,
    `cta=${l.callToAction.action}/${l.callToAction.friction}`,
    `pers=${l.personalization.level}/sig${l.personalization.signals.length}`,
    `iso=${l.isolation.tactic}/${l.isolation.intensity}`,
  ].join(" ");
}

// mainValue / classifyMatchedLever / countActiveMatches / classifyFlipTier は
// 評価側の解釈ロジック（@/lib/generalizationCheck）。検知器(matchKnownScams)には
// 触れない。

// ── ホールドアウト集合（lever のみ・全て攻撃側未到達） ──────────────────────
// 構築原則（照合器ブラインド・現実性のみ）:
//  - 照合器(matchKnownScams)の enum セットを見ない・寄せない・離さない。各 holdout は
//    「現実的な subtle BEC で、かつ攻撃側 evolve が生成しない型」という脅威モデルの
//    現実性だけで作る。
//  - evolve は authority.impersonates / callToAction.action / incentive.type /
//    urgency.tactic を変えない。各 seed 系統の (authority×cta) は固定なので、holdout は
//    「seed 系統に存在しない (authority×cta) 組合せ」を *現実性として* 選ぶ。これが
//    攻撃側への唯一の制約＝未到達の担保であって、照合式への操作ではない。
//  - 残り4レバー（urgency/incentive/personalization/isolation）は現実の手口から
//    そのままレバー化する。seed 署名と一致するか否かは成り行きに任せる（寄せも離しも
//    しない）。lever-score がどの帯に落ちるかも設計目標ではなく結果。
//  - 結果として各 holdout が flip するかは「走らせるまで分からない」。flip を増やす/
//    0 にするためではなく、flip 結果を設計で事前確定させないための作り方。
//  - flip した holdout は (a)能動レバー一致=汎化の芽 / (b)不在・coin-flip一致=
//    アーティファクト を下の自己点検で機械的に判定。AFTER recall がどう出ても正直に
//    記録し、捕捉できない subtle 型が残れば T5（照合式の改善）に繋ぐ。
type Holdout = { name: string; pattern: AttackPattern };

function holdout(
  name: string,
  levers: AttackPattern["levers"],
): Holdout {
  return {
    name,
    pattern: {
      id: `holdout-${name}-${randomUUID()}`,
      generation: 1,
      sourceContext: `t2c-holdout:${name}`,
      channel: "email",
      levers,
    },
  };
}

// 各 holdout は「現実の subtle BEC をそのままレバー化」したもの。コメントは手口の
// シナリオと、選んだ (authority×cta) が seed 系統に無い（＝攻撃側未到達）ことだけを
// 記す。意図的に狙った similarity / lever-score は記さない（それを書いた時点で逆算）。
const HOLDOUTS: Holdout[] = [
  // 役員を装い「新しい経費精算ポータルに今日中にログインして私の申請を承認しておいて。
  // 経理にはまだ言わないで」。脅し薄め・内密・社内用語の典型 BEC。
  // (authority×cta) = executive×input_credentials は seed 系統に無い。
  holdout("exec-portal-login", {
    urgency: { tactic: "deadline", intensity: 1 },
    authority: { impersonates: "executive", credibilityTricks: ["formal_tone"] },
    incentive: { type: "fear", hook: "penalty", intensity: 1 },
    callToAction: { action: "input_credentials", friction: "low" },
    personalization: { level: "targeted", signals: ["real_name", "internal_jargon"] },
    isolation: { tactic: "secrecy", intensity: 1 },
  }),
  // 取引先の既存スレッドに割り込み「請求書を更新しました。こちらのリンクからご確認を」
  // → 資格情報窃取サイトへ。自然な業務メールで赤信号が薄い vendor email compromise。
  // (authority×cta) = business_partner×click_link は seed 系統に無い。
  holdout("vendor-thread-link", {
    urgency: { tactic: "none", intensity: 0 },
    authority: {
      impersonates: "business_partner",
      credibilityTricks: ["formal_tone", "reference_number"],
    },
    incentive: { type: "reward", hook: "refund", intensity: 0 },
    callToAction: { action: "click_link", friction: "low" },
    personalization: { level: "targeted", signals: ["thread_injection"] },
    isolation: { tactic: "none", intensity: 0 },
  }),
  // 役員/IT を装い「新しい承認アプリを各自インストールしておいて。明日から運用」。
  // MFA 回避・RAT 誘導系の BEC。(authority×cta) = executive×install_app は seed に無い。
  holdout("exec-app-install", {
    urgency: { tactic: "deadline", intensity: 2 },
    authority: { impersonates: "executive", credibilityTricks: ["formal_tone"] },
    incentive: { type: "fear", hook: "penalty", intensity: 1 },
    callToAction: { action: "install_app", friction: "low" },
    personalization: { level: "targeted", signals: ["internal_jargon"] },
    isolation: { tactic: "secrecy", intensity: 1 },
  }),
  // 取引先を装い「支払いポータルの仕様変更により、再ログインして請求内容をご確認を」。
  // (authority×cta) = business_partner×input_credentials は seed 系統に無い。
  holdout("vendor-portal-login", {
    urgency: { tactic: "none", intensity: 0 },
    authority: {
      impersonates: "business_partner",
      credibilityTricks: ["reference_number", "formal_tone"],
    },
    incentive: { type: "reward", hook: "refund", intensity: 1 },
    callToAction: { action: "input_credentials", friction: "low" },
    personalization: { level: "targeted", signals: ["thread_injection"] },
    isolation: { tactic: "none", intensity: 0 },
  }),
  // 決済/SaaS プラットフォームを装い「アカウントの未精算分があります。指定口座へお振込を」。
  // (authority×cta) = platform×transfer_money は seed 系統(platform×input_credentials)に無い。
  holdout("platform-settle-wire", {
    urgency: { tactic: "account_freeze", intensity: 1 },
    authority: {
      impersonates: "platform",
      credibilityTricks: ["logo_mimicry", "url_lookalike"],
    },
    incentive: { type: "fear", hook: "account_loss", intensity: 2 },
    callToAction: { action: "transfer_money", friction: "low" },
    personalization: { level: "segmented", signals: ["real_name"] },
    isolation: { tactic: "none", intensity: 0 },
  }),
  // 役員を装い「至急の件、メールでは書けない。この携帯に直接電話して」。vishing 橋渡し
  // BEC。直接チャネルへ誘導し正規の確認経路を断つ。
  // (authority×cta) = executive×call_number は seed 系統に無い。
  holdout("exec-vishing-call", {
    urgency: { tactic: "deadline", intensity: 2 },
    authority: { impersonates: "executive", credibilityTricks: ["formal_tone"] },
    incentive: { type: "fear", hook: "penalty", intensity: 1 },
    callToAction: { action: "call_number", friction: "low" },
    personalization: { level: "targeted", signals: ["real_name"] },
    isolation: { tactic: "direct_channel", intensity: 2 },
  }),

  // ── T5 柱1(ii) 検証用・新規 blind ホールドアウト（2026-06-06 追加） ──────────
  // 構築原則は §8.1 と同一（照合器ブラインド・現実性のみ・(authority×cta) は seed 系統に
  // 無い＝攻撃側未到達）。*加えて (ii) の能動/アーティファクト分類も見ない*＝active 一致が
  // 3 に届くよう寄せない・lever-score 帯も狙わない。flip は走らせるまで不明。系統は
  // vendor/platform に加え、seed に無い authority（government/delivery/financial）も
  // 現実性として含める。(ii) は lever-score 床に触れないので、床落ちが残るのは
  // 「(ii) では救えない」正直な所見として受け入れる（救済は (iii)/(i) の領分）。
  // ↓ これらの (authority×cta) 未到達は main() の構築不変条件チェックで機械的に保証する。

  // 税務当局を装い「還付手続きのため本人確認ポータルで再認証を」。穏やかな gov フィッシング。
  // (authority×cta) = government×input_credentials は seed 系統に無い（government 系統自体が未到達）。
  holdout("gov-tax-refund-portal", {
    urgency: { tactic: "deadline", intensity: 1 },
    authority: {
      impersonates: "government",
      credibilityTricks: ["reference_number", "formal_tone"],
    },
    incentive: { type: "reward", hook: "refund", intensity: 1 },
    callToAction: { action: "input_credentials", friction: "low" },
    personalization: { level: "segmented", signals: [] },
    isolation: { tactic: "none", intensity: 0 },
  }),
  // 配送業者を装い「不在のため再配達リンクから日時指定を」。再送失敗で返送＝弱い圧。
  // (authority×cta) = delivery×click_link は seed 系統に無い（delivery 系統自体が未到達）。
  holdout("delivery-redelivery-link", {
    urgency: { tactic: "deadline", intensity: 1 },
    authority: {
      impersonates: "delivery",
      credibilityTricks: ["logo_mimicry", "url_lookalike"],
    },
    incentive: { type: "fear", hook: "penalty", intensity: 1 },
    callToAction: { action: "click_link", friction: "low" },
    personalization: { level: "broadcast", signals: [] },
    isolation: { tactic: "none", intensity: 0 },
  }),
  // 取引先を装い「振込先変更の確認は記載の番号へ電話を」。正規確認経路を電話に逸らす vendor 詐欺。
  // (authority×cta) = business_partner×call_number は seed 系統(business_partner×transfer_money)に無い。
  holdout("vendor-bankchange-call", {
    urgency: { tactic: "none", intensity: 0 },
    authority: {
      impersonates: "business_partner",
      credibilityTricks: ["reference_number", "formal_tone"],
    },
    incentive: { type: "reward", hook: "refund", intensity: 0 },
    callToAction: { action: "call_number", friction: "low" },
    personalization: { level: "targeted", signals: ["thread_injection"] },
    isolation: { tactic: "direct_channel", intensity: 1 },
  }),
  // 決済/SaaS を装い「セキュリティ強化のため QR をスキャンして再認証を」。
  // (authority×cta) = platform×scan_qr は seed 系統(platform×input_credentials)に無い。
  holdout("platform-qr-reauth", {
    urgency: { tactic: "account_freeze", intensity: 1 },
    authority: {
      impersonates: "platform",
      credibilityTricks: ["logo_mimicry", "url_lookalike"],
    },
    incentive: { type: "fear", hook: "account_loss", intensity: 1 },
    callToAction: { action: "scan_qr", friction: "low" },
    personalization: { level: "segmented", signals: ["real_name"] },
    isolation: { tactic: "none", intensity: 0 },
  }),
  // 銀行を装い「不正利用を検知。記載の番号へ至急ご連絡を」。account_freeze + 直接電話橋渡し。
  // (authority×cta) = financial×call_number は seed 系統に無い（financial 系統自体が未到達）。
  holdout("bank-fraud-alert-call", {
    urgency: { tactic: "account_freeze", intensity: 2 },
    authority: { impersonates: "financial", credibilityTricks: ["logo_mimicry"] },
    incentive: { type: "fear", hook: "account_loss", intensity: 2 },
    callToAction: { action: "call_number", friction: "low" },
    personalization: { level: "segmented", signals: ["real_name"] },
    isolation: { tactic: "direct_channel", intensity: 1 },
  }),
];

// ── 決定論ホールドアウト評価（Gemini 不使用） ──────────────────────────────
type HoldoutEval = {
  name: string;
  leverScore: number;
  matchCount: number;
  bonus: number;
  total: number;
  detected: boolean;
  // 最良一致 corpus doc に対する main-value 一致内訳（自己点検）。
  topMatchId: string | null;
  topMatchSimilarity: number | null;
  matchedActive: LeverKey[];
  matchedArtifact: LeverKey[];
  // 厳格化した (a)/(b) 自己点検: 能動レバーのみの bonus と、それで閾値到達するか、
  // および3段階分類。検知（total/detected）は不変で、解釈だけを足す。
  activeBonus: number;
  activeOnlyDetected: boolean;
  tier: FlipTier;
};

async function evalHoldout(
  h: Holdout,
  threshold: number,
): Promise<HoldoutEval> {
  const levers = h.pattern.levers;
  const leverScore = computeScore(levers);

  // 実際の検知は matchKnownScams（検知器本体）を通す。total>=threshold の flip 判定は
  // 一切変えない。以降の active-only は *解釈用の反実仮想* で、検知器には触れない。
  const res = await matchKnownScams({ levers });
  if (!res.ok) {
    throw new Error(`matchKnownScams failed for ${h.name}: ${res.reason}`);
  }
  const matchCount = res.matches.length;
  const bonus = knownScamBonus(matchCount);
  const total = Math.min(100, leverScore + bonus);
  const detected = total >= threshold;

  const corpus = await listAttackPatterns();

  // 最良一致 doc の main-value 内訳を能動/アーティファクトに分類（表示用）。
  let topMatchId: string | null = null;
  let topMatchSimilarity: number | null = null;
  const matchedActive: LeverKey[] = [];
  const matchedArtifact: LeverKey[] = [];
  if (matchCount > 0) {
    const top = res.matches[0];
    topMatchId = top.id;
    topMatchSimilarity = top.similarity;
    const doc = corpus.find((p) => p.id === top.id);
    if (doc) {
      for (const key of LEVER_KEYS) {
        const v = mainValue(key, levers);
        if (v === mainValue(key, doc.levers)) {
          if (classifyMatchedLever(key, v) === "active") matchedActive.push(key);
          else matchedArtifact.push(key);
        }
      }
    }
  }

  // 反実仮想: 照合から (b) アーティファクト（incentive.type の coin-flip、none/broadcast
  // の不在一致）を除いた「能動レバーのみ」の bonus。これだけで leverScore が単独で閾値に
  // 届けば robust 汎化（coin-flip を抜いても flip が残る）。届かなければ coin-flip 依存。
  // ※ T5 柱1(ii) 後は検知器(matchKnownScams)自体が能動限定なので、real 検知と
  //   この反実仮想は一致する＝flip した holdout の tier は構造的に robust か
  //   non_generalization のみ（coinflip_dependent は出ない）。tier 機構は変更前の
  //   挙動を読むための凍結オラクルとして残置。
  const activeBonus = knownScamBonus(countActiveMatches(levers, corpus));
  const activeOnlyDetected = leverScore + activeBonus >= threshold;
  const tier = classifyFlipTier({
    flipped: detected,
    activeOnlyDetected,
    hasActiveMatch: hasAnyActiveMatch(levers, corpus),
  });

  return {
    name: h.name,
    leverScore,
    matchCount,
    bonus,
    total,
    detected,
    topMatchId,
    topMatchSimilarity,
    matchedActive,
    matchedArtifact,
    activeBonus,
    activeOnlyDetected,
    tier,
  };
}

// 3段階分類の短いラベル（非 flip は分類対象外なので "—"）。
function tierLabel(e: HoldoutEval): string {
  if (!e.detected) return "—       ";
  switch (e.tier) {
    case "robust":
      return "robust  ";
    case "coinflip_dependent":
      return "coinflip";
    case "non_generalization":
      return "artifact"; // flip したが能動一致なし
  }
}

function printHoldoutTable(label: string, evals: HoldoutEval[]): void {
  console.log(`\n[${label}] ホールドアウト評価`);
  console.log(
    "name             | leverScore | matches | bonus | total | detected | 能動bonus(単独閾値) | tier     | active一致 | artifact一致",
  );
  for (const e of evals) {
    console.log(
      `${e.name.padEnd(16)} |    ${String(e.leverScore).padStart(3)}     |   ${String(e.matchCount).padStart(2)}    |  +${String(e.bonus).padStart(2)}  |  ${String(e.total).padStart(3)}  |   ${e.detected ? "YES" : "no "}    |      +${String(e.activeBonus).padStart(2)} ${e.activeOnlyDetected ? "(≥th)" : "(<th)"}      | ${tierLabel(e)} | ${e.matchedActive.join(",") || "—"} | ${e.matchedArtifact.join(",") || "—"}`,
    );
  }
  const scams = evals.length;
  const detected = evals.filter((e) => e.detected).length;
  console.log(`  holdout recall = ${detected}/${scams} = ${(detected / scams).toFixed(2)}`);
}

// ── in-loop 走（診断と同一 step ＋ persistPattern ON のみ） ─────────────────
// 固定 literal seed は diagnose-loop-recall.ts の SEEDS と同一。
type Seed = { name: string; note: string; pattern: AttackPattern };

function seedPattern(name: string, levers: AttackPattern["levers"]): AttackPattern {
  return {
    id: `${name}-${randomUUID()}`,
    generation: 1,
    sourceContext: `t2c-seed:${name}`,
    channel: "email",
    levers,
  };
}

const SEEDS: Seed[] = [
  {
    name: "bec-exec-wire",
    note: "CEO詐欺風（赤信号薄）",
    pattern: seedPattern("bec-exec-wire", {
      urgency: { tactic: "none", intensity: 0 },
      authority: { impersonates: "executive", credibilityTricks: ["formal_tone"] },
      incentive: { type: "fear", hook: "penalty", intensity: 0 },
      callToAction: { action: "transfer_money", friction: "mid" },
      personalization: { level: "targeted", signals: ["internal_jargon"] },
      isolation: { tactic: "secrecy", intensity: 1 },
    }),
  },
  {
    name: "vendor-invoice",
    note: "取引先請求書風",
    pattern: seedPattern("vendor-invoice", {
      urgency: { tactic: "none", intensity: 0 },
      authority: {
        impersonates: "business_partner",
        credibilityTricks: ["reference_number", "formal_tone"],
      },
      incentive: { type: "reward", hook: "refund", intensity: 0 },
      callToAction: { action: "transfer_money", friction: "mid" },
      personalization: { level: "targeted", signals: ["thread_injection"] },
      isolation: { tactic: "none", intensity: 0 },
    }),
  },
  {
    name: "platform-credential-soft",
    note: "穏やかな資格情報フィッシング",
    pattern: seedPattern("platform-credential-soft", {
      urgency: { tactic: "none", intensity: 0 },
      authority: { impersonates: "platform", credibilityTricks: [] },
      incentive: { type: "reward", hook: "refund", intensity: 0 },
      callToAction: { action: "input_credentials", friction: "high" },
      personalization: { level: "segmented", signals: [] },
      isolation: { tactic: "none", intensity: 0 },
    }),
  },
];

// 1本の seed を no-break で回し切る。すり抜けラウンドのみ persist（loop.ts と同一
// セマンティクス）。各ラウンドで *corpus-so-far* に対する matchKnownScams を記録し、
// 閉ループが in-loop の score に効いているか（known-scam bonus の寄与）を可視化する。
async function inLoopRun(
  seed: Seed,
  maxRounds: number,
  threshold: number,
): Promise<string[]> {
  console.log(`\n----- in-loop seed=${seed.name} (no-break, maxRounds=${maxRounds}, persist ON) -----`);
  console.log(`  note: ${seed.note}`);
  console.log(
    "round | gen | leverScore | total | knownScamBonus | corpusMatches | detected | persisted | levers",
  );
  let pattern = seed.pattern;
  const writtenIds: string[] = [];
  for (let round = 1; round <= maxRounds; round++) {
    // corpus-so-far に対する matchKnownScams（記録専用。investigate も内部で叩く）。
    const mk = await matchKnownScams({ levers: pattern.levers });
    const corpusMatches = mk.ok ? mk.matches.length : -1;

    // ↓↓ loop.ts が呼ぶのと同一の step（本体不変）。
    const report = await investigate({ message: "", levers: pattern.levers });
    const { score } = await judge(pattern.levers, report);
    // ↑↑ ここまで本番と同一。
    const detected = score >= threshold;
    const leverScore = computeScore(pattern.levers);
    const knownBonus =
      report.knownScams?.status === "ok"
        ? Math.min(
            BONUS_KNOWN_SCAM_CAP,
            (report.knownScams.matches?.length ?? 0) * BONUS_KNOWN_SCAM_PER_MATCH,
          )
        : 0;

    let persisted = false;
    if (!detected) {
      // persistPattern ON（唯一の差分）。すり抜けラウンドのみ書き戻す。
      await upsertAttackPattern(pattern);
      writtenIds.push(pattern.id);
      persisted = true;
    }

    console.log(
      `  ${String(round).padStart(2)}  |  ${pattern.generation}  |    ${String(leverScore).padStart(3)}     |  ${String(score).padStart(3)}  |      +${knownBonus}       |      ${String(corpusMatches).padStart(2)}       |   ${detected ? "YES" : "no "}   |   ${persisted ? "yes" : "no "}    | ${leverDigest(pattern.levers)}`,
    );

    // no-break: 検出されても止めない。evolve は detected=true で throw する契約なので、
    // エスカレート継続のため停止ポリシーとして {detected:false} を固定で渡す
    // （evolve 本体・閾値・prompt は不変。missedBy は本物の report 由来）。
    pattern = evolve(pattern, { detected: false, missedBy: report.missedBy?.[0] });
  }
  return writtenIds;
}

async function main(): Promise<number> {
  const threshold = getDetectionThreshold();
  console.log("=== PLAN-v2 T2-③: 暗記 vs 汎化（lever ベース決定論ホールドアウト）===");
  console.log(`threshold=${threshold}`);

  // 構築不変条件の自動チェック: 全 holdout の (authority×cta) が seed 系統に無い
  // （＝攻撃側 evolve が到達しない＝未到達担保）。evolve は authority/cta を変えないので
  // seed の (authority×cta) は系統固定。寄せ/逆算ではなくブラインド構築の唯一の制約を
  // コードで保証する。違反したら走らせる前に止める（観測を汚さないため）。
  const seedSigs = new Set(
    SEEDS.map(
      (s) =>
        `${s.pattern.levers.authority.impersonates}×${s.pattern.levers.callToAction.action}`,
    ),
  );
  for (const h of HOLDOUTS) {
    const sig = `${h.pattern.levers.authority.impersonates}×${h.pattern.levers.callToAction.action}`;
    if (seedSigs.has(sig)) {
      throw new Error(
        `holdout ${h.name} の (authority×cta)=${sig} が seed 系統に存在＝未到達担保が破れている`,
      );
    }
  }

  const startCorpus = (await listAttackPatterns()).length;
  console.log(`\n[PRE] attackPatterns 件数=${startCorpus}（0 でない場合は既存データ混入の警告）`);

  // BEFORE: 空コーパス（=既存状態）でホールドアウトを評価。
  const before = await Promise.all(HOLDOUTS.map((h) => evalHoldout(h, threshold)));
  printHoldoutTable("BEFORE", before);

  // in-loop 走でコーパスを育てる（診断と同条件・persist ON のみ）。
  console.log("\n========== in-loop 走（コーパス育成）==========");
  const maxRounds = Number(process.env.GEN_MAXROUNDS ?? "12");
  const allWritten: string[] = [];
  const t0 = Date.now();
  for (const seed of SEEDS) {
    const ids = await inLoopRun(seed, maxRounds, threshold);
    allWritten.push(...ids);
  }
  const grownCorpus = (await listAttackPatterns()).length;
  console.log(
    `\n  書き戻し合計 ${allWritten.length} 件 / attackPatterns 件数=${grownCorpus} / ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );

  // AFTER: 育ったコーパスで同じホールドアウトを再評価。
  const after = await Promise.all(HOLDOUTS.map((h) => evalHoldout(h, threshold)));
  printHoldoutTable("AFTER", after);

  // ── 判定（脚色しない・機械的に） ────────────────────────────────────────
  console.log("\n========== T2-③ 判定 ==========");
  const beforeRecall = before.filter((e) => e.detected).length / before.length;
  const afterRecall = after.filter((e) => e.detected).length / after.length;
  console.log(`  holdout recall: BEFORE ${beforeRecall.toFixed(2)} → AFTER ${afterRecall.toFixed(2)}`);

  console.log("\n  --- flip した holdout の3段階分類（厳格化した (a)/(b) 自己点検）---");
  console.log("    robust   = 能動レバーのみで閾値到達（coin-flip を抜いても flip が残る）→ 汎化に数える");
  console.log("    coinflip = 能動一致はあるが、閾値到達に artifact が load-bearing（抜くと flip 消失）→ 汎化に数えない");
  console.log("    artifact = flip したが能動一致なし（不在/coin-flip のみ）→ 汎化に数えない");
  let robust = 0;
  let coinflip = 0;
  let artifact = 0;
  for (let i = 0; i < HOLDOUTS.length; i++) {
    const b = before[i];
    const a = after[i];
    if (!b.detected && a.detected) {
      if (a.tier === "robust") robust += 1;
      else if (a.tier === "coinflip_dependent") coinflip += 1;
      else artifact += 1;
      const verdict =
        a.tier === "robust"
          ? "robust 汎化（能動のみで閾値到達）"
          : a.tier === "coinflip_dependent"
            ? "coin-flip 依存（artifact が load-bearing・汎化に数えない）"
            : "アーティファクト（能動一致なし・汎化に数えない）";
      console.log(
        `    [${a.name}] flip: total ${b.total}→${a.total} / leverScore+能動bonus=${a.leverScore}+${a.activeBonus}=${a.leverScore + a.activeBonus}(${a.activeOnlyDetected ? "≥" : "<"}${threshold}) / topMatch sim=${a.topMatchSimilarity?.toFixed(2)} / active一致=[${a.matchedActive.join(",") || "—"}] / artifact一致=[${a.matchedArtifact.join(",") || "—"}] ⇒ ${verdict}`,
      );
    }
  }
  if (robust === 0 && coinflip === 0 && artifact === 0) {
    console.log("    （flip した holdout なし＝汎化は観測されず）");
  }
  console.log(
    `\n  robust 汎化: ${robust} 件 / coin-flip 依存: ${coinflip} 件 / アーティファクト: ${artifact} 件`,
  );
  console.log(
    `  ⇒ 汎化として数えるのは robust のみ＝${robust} 件（coin-flip 依存・アーティファクトは load-bearing が (b) なので除外）。`,
  );

  // CLEANUP: in-loop 走で書いた doc を全削除しコーパスを空に戻す。
  console.log("\n[CLEANUP] in-loop 走で書いた doc を削除");
  const db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
  for (const id of allWritten) {
    await db.collection(ATTACK_PATTERN_COLLECTION).doc(id).delete();
  }
  const postCorpus = (await listAttackPatterns()).length;
  console.log(`  削除後 attackPatterns 件数=${postCorpus}`);

  const cleanupOk = postCorpus === startCorpus;
  console.log(`\n[DoD] BEFORE/AFTER 算出 + cleanup 復帰: ${cleanupOk ? "OK" : "WARN(コーパス未復帰)"}`);
  return cleanupOk ? 0 : 1;
}

main()
  .then((c) => process.exit(c))
  .catch((e) => {
    console.error("measure-generalization crashed:", e);
    process.exit(2);
  });
