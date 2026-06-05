import type { ToolName } from "@/types/investigation";

// 防御エージェントの「自律調査でどのツールを選んだ／選ばなかったか」をラウンド別に
// 見せる純表示コンポーネント（"use client" 不要）。
// 色は役割トークンのみ: called=true=action、グレーアウト=foreground 中立。

// 1 行 = あるラウンドで 1 ツールを呼んだ / 呼ばなかった記録。
export interface ToolLogEntry {
  round: number;
  toolName: ToolName;
  called: boolean;
  reason?: string;
}

export interface ToolSelectionLogProps {
  logs: ToolLogEntry[];
}

// ツール名の表示ラベル（非IT層にも分かる日本語）。union を漏れなく網羅。
const TOOL_LABELS: Record<ToolName, string> = {
  urlReputation: "URL評価 (Web Risk)",
  senderAuth: "送信者認証 (SPF/DKIM/DMARC)",
  officialAlerts: "公式注意喚起の照合",
  domainAge: "ドメイン年齢 (RDAP)",
  knownScams: "既知手口の照合",
};

function toolLabel(name: ToolName): string {
  // union 外の値が万一来ても素のキー名で落とさず表示する。
  return TOOL_LABELS[name] ?? name;
}

function LogRow({ entry }: { entry: ToolLogEntry }) {
  return (
    <li
      className={`flex items-start gap-2 py-1 ${
        entry.called ? "text-foreground" : "text-foreground/40"
      }`}
    >
      <span
        className={`mt-0.5 select-none ${
          entry.called ? "text-action" : "text-foreground/40"
        }`}
        aria-hidden
      >
        {entry.called ? "✓" : "—"}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-medium break-words">
          {toolLabel(entry.toolName)}
          <span className="ml-2 align-middle text-xs text-foreground/50">
            {entry.called ? "呼び出し" : "非選択"}
          </span>
        </div>
        {entry.reason ? (
          <div className="text-xs text-foreground/60 break-words">
            {entry.reason}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export default function ToolSelectionLog({ logs }: ToolSelectionLogProps) {
  if (logs.length === 0) {
    return (
      <div className="text-sm text-foreground/50">調査ログがありません。</div>
    );
  }

  // ラウンド昇順にグルーピング。round が飛んでいても安全に並べる。
  const rounds = Array.from(new Set(logs.map((l) => l.round))).sort(
    (a, b) => a - b,
  );

  return (
    <div className="space-y-4">
      {rounds.map((round) => {
        const entries = logs.filter((l) => l.round === round);
        return (
          <section key={round}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-foreground/60">
              Round {round}
            </h3>
            <ul className="divide-y divide-foreground/10">
              {entries.map((entry, i) => (
                <LogRow key={`${entry.toolName}-${i}`} entry={entry} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// 単独確認用モック（実データ接続は Task 8-C3）。選択・非選択が混ざる様子を見せる。
export const MOCK_TOOL_LOGS: ToolLogEntry[] = [
  { round: 1, toolName: "knownScams", called: true, reason: "anchor: 最初に必ず照合" },
  { round: 1, toolName: "urlReputation", called: true, reason: "本文に http(s) URL を検出" },
  { round: 1, toolName: "senderAuth", called: false, reason: "Authentication-Results ヘッダ無し" },
  { round: 1, toolName: "domainAge", called: false },
  { round: 1, toolName: "officialAlerts", called: true, reason: "金融機関を装っているため照合" },
  { round: 2, toolName: "knownScams", called: true, reason: "anchor: 最初に必ず照合" },
  { round: 2, toolName: "urlReputation", called: false, reason: "URL なし（SMS 経路）" },
  { round: 2, toolName: "domainAge", called: true, reason: "未知ドメインのため登録日を確認" },
];
