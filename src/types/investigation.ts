// Foundation types for Task 6 investigation results. Per-tool result shapes
// are intentionally left as placeholders — they'll be flowed in by Chunk 2 as
// each tool lands.

export type BonusSource =
  | "webRisk"
  | "domainAge"
  | "senderAuth"
  | "knownScams"
  | "officialAlerts";

// investigate が動的に呼ぶ 5 調査ツールの名前 union。InvestigationReport の
// finding キー（urlReputation / senderAuth / officialAlerts / domainAge /
// knownScams）と一致させる。missedBy（検知に寄与しなかったツール）の語彙はこの
// union に閉じることで、攻撃側へ渡る値が必ず実在ツール名になることを型で担保する。
// 注: BonusSource は加点ソースの語彙（"webRisk" を含む）で別物。
export type ToolName =
  | "urlReputation"
  | "senderAuth"
  | "officialAlerts"
  | "domainAge"
  | "knownScams";

export type BonusItem = {
  source: BonusSource;
  points: number;
};

// `capped: true` means raw item sum exceeded the configured ceiling and was
// clipped to `total`. UI can flag this so the user knows multiple strong
// signals collapsed into one ceiling-hit value.
export type InvestigationBonus = {
  items: BonusItem[];
  total: number;
  capped: boolean;
};

// "skipped" is currently unused — the dynamic router never emits skip
// findings (a tool the router elects not to call simply does not appear in
// the report). Kept as a reserved value for the case where we want to make
// "explicitly considered and skipped" visible in the UI (e.g., to render
// "URL check: skipped — no link in body" rather than nothing at all).
export type ToolStatus = "ok" | "error" | "skipped";

// Per-tool result shapes. Each is optional on InvestigationReport so the
// report carries only the tools the router actually called.
export type DomainAgeFinding = {
  status: ToolStatus;
  domain?: string;
  registeredAt?: string;
  ageDays?: number;
  errorMessage?: string;
};

export type UrlReputationFinding = {
  status: ToolStatus;
  url?: string;
  threats?: string[];
  errorMessage?: string;
};

export type SenderAuthFinding = {
  status: ToolStatus;
  spf?: string;
  dkim?: string;
  dmarc?: string;
  raw?: string;
  errorMessage?: string;
};

export type KnownScamMatch = {
  id: string;
  similarity: number;
};

export type KnownScamsFinding = {
  status: ToolStatus;
  matches?: KnownScamMatch[];
  errorMessage?: string;
};

export type OfficialAlertMatch = {
  title: string;
  url: string;
};

export type OfficialAlertsFinding = {
  status: ToolStatus;
  matches?: OfficialAlertMatch[];
  errorMessage?: string;
};

export type InvestigationReport = {
  domainAge?: DomainAgeFinding;
  urlReputation?: UrlReputationFinding;
  senderAuth?: SenderAuthFinding;
  knownScams?: KnownScamsFinding;
  officialAlerts?: OfficialAlertsFinding;
  // True when the tool-calling loop hit maxTurns before producing a final
  // model response. Downstream judges can still use the partial findings, but
  // they should know the model didn't get to summarize.
  truncated: boolean;
  // Why the investigation was truncated (or null when it finished cleanly).
  // - "max_turns": generateWithTools hit its maxTurns ceiling
  // - "budget":   the whole-investigation budget timer fired first
  // - "error":    generateWithTools rejected (SDK / network)
  // Surfaced in the UI so users can tell "still loading vs. real cap".
  truncatedReason: "max_turns" | "budget" | "error" | null;
  bonus: InvestigationBonus;
  // 検知に寄与しなかった調査ツール名の配列（生産: defender、消費: attacker）。
  // 攻撃側はこの「死角」を読んで次世代の変異方向を決める。算出ロジック本体は
  // 別タスク（判定ロジックは触らない）。ここは契約フィールドの定義のみ。
  missedBy?: ToolName[];
};
