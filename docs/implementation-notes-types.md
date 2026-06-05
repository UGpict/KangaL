# implementation-notes: AttackPattern 型 ＋ ToolName（プロンプト02-1）

## 判断: ToolName は5本のまま維持（3本に絞らない）

プロンプト02-1は「3本（knownScams/urlReputation/senderAuth）に絞る」指示だったが、リポジトリは既にその先にあり、**5本維持**を選択した。

- **AttackPattern（§5）は既に完全実装済み**（`src/types/attackPattern.ts`、6レバー＋channel＋`detectionResult.missedBy: ToolName[]`）。02-1の「型確定」は達成・超過状態で、変更不要。
- **`ToolName` は5本**（`urlReputation | senderAuth | officialAlerts | domainAge | knownScams`）。`domainAge`/`officialAlerts` はツール本体（`checkDomainAge.ts` / `checkOfficialAlerts.ts` / `reconPublicAlerts.ts`）が実装・テスト済みで、investigate・judge・weights・デモUI・InboxApp に全面配線済み（domainAge 14ファイル/78箇所、officialAlerts 20ファイル/83箇所）。
- **3本に絞る = 動作・テスト済みの2ツールを約30ファイルから削除する大規模破壊**。プロンプト自身の制約「型以外のロジックはまだ書かない」に反し、削除しない限りコンパイルも通らない。
- README の3本絞りは「5本実装すると Phase1 が週末を食う」という時間節約カットだったが、その5本は既に完成・コミット済み＝節約対象の時間は消費済み。今絞るのは純粋な後退。

→ 完了条件「型がコンパイルでき、ToolName が確定している」は、5本構成のまま満たされている。
