// Foundation types for Task 6 investigation results. Per-tool result shapes
// are intentionally left as placeholders — they'll be flowed in by Chunk 2 as
// each tool lands.

export type BonusSource =
  | "webRisk"
  | "domainAge"
  | "senderAuth"
  | "knownScams"
  | "officialAlerts";

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
};
