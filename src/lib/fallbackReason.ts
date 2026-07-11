import type { AttackPattern } from "@/types/attackPattern";
import type { InvestigationReport } from "@/types/investigation";
import {
  BONUS_DOMAIN_AGE_DAYS_THRESHOLD,
  DANGER_SCORE_THRESHOLD,
  LEVER_WEIGHTS,
  strengthOf,
  type LeverKey,
} from "@/lib/weights";
import { LEVER_KEYS } from "@/lib/levers";

// Deterministic reason builder — used ONLY when Gemini reason generation
// fails (judge.ts catch path). A danger verdict must never reach the user as
// a red card with no explanation of WHY, even with the LLM down.
//
// Rules mirrored from the LLM instruction (judge.ts §7 tone block):
// - mention only ACTIVE levers (strengthOf > 0) — no fabrication;
// - danger band explains why it's dangerous; safe band never asserts danger
//   nor absolute safety;
// - suggest, never command; plain non-IT Japanese.
//
// 道B / injection hygiene: only NUMBERS are interpolated (ageDays, match
// count). Domain strings and official-alert titles are external text and are
// never embedded in the output.

type Levers = AttackPattern["levers"];

// Record<Union, string> keyed on the lever enums → a vocabulary change breaks
// compilation here instead of silently dropping a phrase.
const CTA_ACTION_PHRASES: Record<Levers["callToAction"]["action"], string> = {
  transfer_money: "送金を求めている",
  input_credentials: "パスワードなど大切な情報の入力を求めている",
  install_app: "アプリのインストールを求めている",
  scan_qr: "QRコードの読み取りを求めている",
  click_link: "リンク（URL）を開くよう求めている",
  call_number: "記載の電話番号へ連絡するよう求めている",
};

const IMPERSONATES_PHRASES: Record<
  Exclude<Levers["authority"]["impersonates"], "none">,
  string
> = {
  financial: "銀行やカード会社を名乗っている",
  government: "役所など公的機関を名乗っている",
  business_partner: "取引先を名乗っている",
  executive: "社長や上司など会社の上層部を名乗っている",
  delivery: "宅配業者を名乗っている",
  platform: "大手サービスの運営元を名乗っている",
};

const URGENCY_TACTIC_PHRASES: Record<
  Exclude<Levers["urgency"]["tactic"], "none">,
  string
> = {
  deadline: "期限を区切って急がせている",
  account_freeze: "アカウントの停止や凍結をちらつかせて急がせている",
  limited_offer: "期間限定・数量限定をうたって急がせている",
};

// hook (not type): the hook is what the user actually sees in the message,
// and levers.ts classifies incentive.type as a coin-flip artifact.
const INCENTIVE_HOOK_PHRASES: Record<Levers["incentive"]["hook"], string> = {
  prize: "当選や特典などのうまい話で誘っている",
  refund: "返金や払い戻しを持ちかけている",
  penalty: "応じないと不利益があるとほのめかしている",
  account_loss: "アカウントが使えなくなると不安をあおっている",
  legal_threat: "法的措置をちらつかせている",
};

// broadcast has strength via signals but no phrase — "mass-mailed" is not a
// suspicion the user can act on, so it is deliberately skipped.
const PERSONALIZATION_PHRASES: Record<
  Exclude<Levers["personalization"]["level"], "broadcast">,
  string
> = {
  segmented: "受け取る人の立場に合わせて文面が作り込まれている",
  targeted: "あなた個人に関する情報が文面に使われている",
};

const ISOLATION_TACTIC_PHRASES: Record<
  Exclude<Levers["isolation"]["tactic"], "none">,
  string
> = {
  secrecy: "このことを誰にも話さないよう求めている",
  bypass_approval: "通常の確認や承認を飛ばすよう求めている",
  direct_channel: "普段と違う連絡手段でのやり取りを求めている",
};

// Isolation is excluded from the normal clause pool: the UI already renders
// ISOLATION_CAVEAT as a separate red box (isolationNote), and the reason must
// not duplicate it. clauseFor returns null for it; see the floor-driven
// exception inside buildFallbackReason.
function clauseFor(key: LeverKey, levers: Levers): string | null {
  switch (key) {
    case "urgency":
      return levers.urgency.tactic === "none"
        ? null
        : URGENCY_TACTIC_PHRASES[levers.urgency.tactic];
    case "authority":
      return levers.authority.impersonates === "none"
        ? null
        : IMPERSONATES_PHRASES[levers.authority.impersonates];
    case "incentive":
      return INCENTIVE_HOOK_PHRASES[levers.incentive.hook];
    case "callToAction":
      return CTA_ACTION_PHRASES[levers.callToAction.action];
    case "personalization":
      return levers.personalization.level === "broadcast"
        ? null
        : PERSONALIZATION_PHRASES[levers.personalization.level];
    case "isolation":
      return null;
  }
}

// At most ONE investigation clause, in bonus-point priority order
// (15/10/8/5/8 in weights.ts), with the SAME trigger conditions as
// computeInvestigationBonus so the reason never cites a signal that didn't
// score.
function investigationClause(report: InvestigationReport): string | null {
  if (
    report.urlReputation?.status === "ok" &&
    (report.urlReputation.threats?.length ?? 0) > 0
  ) {
    return "本文中のリンクは安全でない可能性があると外部の調査で報告されています";
  }
  if (
    report.domainAge?.status === "ok" &&
    typeof report.domainAge.ageDays === "number" &&
    report.domainAge.ageDays < BONUS_DOMAIN_AGE_DAYS_THRESHOLD
  ) {
    return `リンク先のサイトは作られてから${report.domainAge.ageDays}日しか経っていません`;
  }
  if (report.senderAuth?.status === "ok") {
    const { spf, dkim, dmarc } = report.senderAuth;
    if (spf === "fail" || dkim === "fail" || dmarc === "fail") {
      return "送信元が本物かどうかを確かめる仕組みの確認に通っていません";
    }
  }
  if (
    report.knownScams?.status === "ok" &&
    (report.knownScams.matches?.length ?? 0) > 0
  ) {
    return `過去に確認された詐欺の手口と似た点が${report.knownScams.matches!.length}件見つかっています`;
  }
  if (
    report.officialAlerts?.status === "ok" &&
    (report.officialAlerts.matches?.length ?? 0) > 0
  ) {
    return "公的機関などが注意を呼びかけている手口に近い情報が見つかっています";
  }
  return null;
}

export function buildFallbackReason(
  levers: Levers,
  score: number,
  investigation?: InvestigationReport | null,
): string {
  const danger = score >= DANGER_SCORE_THRESHOLD;
  const strength = strengthOf(levers);

  const candidates = LEVER_KEYS.filter(
    (key) => key !== "isolation" && strength[key] > 0,
  )
    .map((key) => ({
      clause: clauseFor(key, levers),
      rank: strength[key] * LEVER_WEIGHTS[key],
    }))
    .filter((c): c is { clause: string; rank: number } => c.clause !== null);
  // Stable sort: candidates were built in LEVER_KEYS order, so ties keep it.
  candidates.sort((a, b) => b.rank - a.rank);

  // 3 clauses read as "here is why" without becoming a wall of text; the safe
  // band mentions less because it is describing an absence, not a case.
  const clauses = candidates
    .slice(0, danger ? 3 : 2)
    .map((c) => c.clause);

  // Floor-driven exception: isolation intensity 2-3 alone can push the score
  // into the danger band (ISOLATION_FLOORS). With an otherwise empty pool the
  // red card would explain nothing — only then does isolation enter the reason.
  if (
    danger &&
    clauses.length === 0 &&
    levers.isolation.tactic !== "none" &&
    strength.isolation > 0
  ) {
    clauses.push(ISOLATION_TACTIC_PHRASES[levers.isolation.tactic]);
  }

  const inv = investigation ? investigationClause(investigation) : null;
  const quoted = clauses.map((c) => `「${c}」`).join("");
  const sentences: string[] = [];

  if (danger) {
    sentences.push(
      clauses.length > 0
        ? `この文面には、${quoted}といった特徴があり、詐欺の手口と重なる点に注意が必要です。`
        : // Bonus-driven edge: danger score with no active lever (investigation
          // signals alone). The clause below still explains the band honestly.
          "この文面には注意が必要な兆候が確認されました。",
    );
    if (inv) sentences.push(`さらに、${inv}。`);
    sentences.push("すぐに応じず、いったん立ち止まって確認してみましょう。");
  } else {
    sentences.push(
      clauses.length > 0
        ? `${quoted}といった気になる点はありますが、危険と言い切れるほどの強い特徴は見つかりませんでした。`
        : "この文面からは、急かし・なりすまし・送金や情報入力の要求といった、詐欺でよく見られるはっきりした特徴は見つかりませんでした。",
    );
    if (inv) sentences.push(`さらに、${inv}。`);
    sentences.push(
      "絶対に安全とは言い切れないため、心当たりがなければ確認してみましょう。",
    );
  }

  return sentences.join("");
}
