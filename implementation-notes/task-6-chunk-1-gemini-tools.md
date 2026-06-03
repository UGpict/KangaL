# Task 6 — Chunk 1: 基盤(型 / generateWithTools / サンプル拡張)

実施日: 2026-06-03

## 何を
- `src/types/investigation.ts` 新設: `InvestigationReport` / `InvestigationBonus` / `BonusItem` / 各 tool finding 型(`DomainAgeFinding` 等のプレースホルダ)
- `src/lib/gemini.ts` 拡張: `generateWithTools` と関連型(`ToolDeclaration` / `ToolCall` / `ToolExecutor` / `GenerateWithToolsInput` / `GenerateWithToolsResult`)
- `src/lib/sampleMessages.ts` 拡張: `InboxMessage.authenticationResults?: string` 追加、3 サンプルに合成ヘッダを付与(msg-001/002 は all-pass、msg-003 BEC は all-fail)
- `.env.example` 拡張: `WEB_RISK_API_KEY` プレースホルダ
- `src/lib/__tests__/gemini.test.ts` 新設: 6 件のテスト(下記の (a)(b)(c)(d)(d')+ tool 呼び出しログ順序)
- `package.json` 拡張: `typecheck` スクリプト追加(`tsc --noEmit`)
- 結果: typecheck green / vitest 56 passed(50 既存 + 6 新規)/ 統合 3 件は引き続き skipped

## generateWithTools の契約

### 入出力

```ts
generateWithTools(input: {
  systemInstruction: string;
  userText: string;
  tools: ToolDeclaration[];                 // function declarations(name, description, parameters)
  executors: Record<string, ToolExecutor>;  // name → 非同期 fn(call → Record<string, unknown>)
  model?: string;        // 既定 gemini-2.5-flash、env GEMINI_MODEL で上書き
  temperature?: number;  // 既定 0.2
  maxTurns?: number;     // 既定 4
}): Promise<{
  text: string;          // 最終モデル応答テキスト(打ち切り時は "")
  turns: number;         // 実際に Gemini を叩いた回数
  truncated: boolean;    // maxTurns を超過したか
  toolCalls: ToolCall[]; // 呼ばれたツール呼び出しの時系列ログ
}>
```

### 設計の不変条件

- **gemini.ts は tool 非依存**。個別ツール実装を一切 import しない。`executors` map で **依存注入**。これにより Chunk 2 でツール実装が増えても gemini.ts は触らない。
- **executor 注入**: 呼び出し側が `{ toolName: async (call) => result }` の map を渡す。
  - 結果は `Record<string, unknown>`(Gemini に JSON serializable で送る前提)
  - 同じ executor を closure で包めば caller 側でツール結果を **外側のマップに蓄積**できる(Chunk 2 の investigate.ts がこのパターン)
- **maxTurns 強制終了は throw しない**。`{ truncated: true }` を返し、`toolCalls` ログは残す。caller は (a) 打ち切られたと知る (b) 蓄積済みの executor 副作用を使う、を選択できる。
- **executor 例外 / 未登録ツール名**: ループは止まらない。エラーは `functionResponse` の `response.error` に文字列化して次ターンに渡し、Gemini に復旧の機会を与える。
- **モデル turn の蓄積**: モデルが function call を返したターンは `{ role: "model", parts: 受信した parts そのまま }` を contents に push。次ターンの user content には `parts: functionResponse[]` を push。Vertex の会話フォーマットそのまま。

### ループの骨格

```
contents = [user(text)]
for turn in 0..maxTurns:
  response = generateContent(contents, tools)
  parts = response.candidates[0].content.parts
  calls = parts.filter(functionCall)
  if calls.length === 0:
    return { text: parts.join, turns: turn+1, truncated: false, toolCalls }
  toolCalls.push(...calls)
  responses = parallel executor for each call (error-trapped)
  contents.push({ role: "model", parts })
  contents.push({ role: "user", parts: responses.map → functionResponse })
return { text: "", turns: maxTurns, truncated: true, toolCalls }
```

### 検証ケース(`gemini.test.ts`)

| ケース | 検証点 |
|---|---|
| (a) tool_call → 結果 → 2周目テキスト | executor が正しい引数で呼ばれ、2周目に functionResponse が会話履歴に積まれ、最終テキストが返る |
| (b) 即テキスト確定(0 call) | executor 呼ばれず、turns=1 / truncated=false |
| (c) maxTurns 超過 | truncated=true / text="" / executor は maxTurns 回呼ばれる / Gemini も maxTurns 回叩かれる |
| (d) executor が throw | エラーが `functionResponse.response.error` に文字列化されて次ターンへ、ループ継続 |
| (d') 未知ツール名 | `unknown_tool: <name>` エラーで同様に継続 |
| 連続 tool call | toolCalls が時系列で正しく記録される |

### Chunk 2+ への申し送り

- 各ツール実装は `Promise<Record<string, unknown>>` を返す関数として書く(`InvestigationReport` 用の構造化型は別レイヤで投影)
- `investigate.ts` は executor を closure で包んで「Gemini に送る result」と「外側に蓄積する finding」を両立させる
- 全体 timeout(15s) は generateWithTools の外で `Promise.race` で被せる方針(中の loop は budget を知らない)
- `truncated: true` のとき、現状は `text: ""` を返すが、必要なら最終ターンで no-tool 再叩きで wrap-up を取らせる選択肢もある(MVP では不要)

## 確認した完了条件
- [x] `(a)(b)(c)(d)` の4ケースすべてテスト緑(さらに (d') 未知ツール、ツール呼び出しログ順の 2 件を追加)
- [x] `npm run typecheck` エラーゼロ
- [x] `npm test` 56 passed / 3 skipped
- [x] commit(別途実行)

## やらなかったこと(Chunk 1 のスコープ外)
- 個別ツール実装(checkDomainAge / checkUrlReputation / verifySenderAuth / matchKnownScams / checkOfficialAlerts)
- `investigate.ts`(オーケストレーション)
- `judge` 変更(投資ボーナス加味)
- UI(調査結果の表示)
- ネットワーク実走行(統合テスト)
- 全体 timeout / SSRF ガード / キャッシュ(Chunk 2 以降)
