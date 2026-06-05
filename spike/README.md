# ADK 攻防ループ・スパイク（使い捨て）

ADK（`@google/adk` v1.2.0・Google 純正 TypeScript 版）でマルチエージェントのループ制御の書き味を確かめるための使い捨てコード。**本実装には統合しない**（`tsconfig.json` で `spike/` は exclude 済み）。

## 実行
```bash
npx tsx spike/attackDefenseLoop.ts                 # 1往復（既定）
SPIKE_ROUND_CAP=3 npx tsx spike/attackDefenseLoop.ts  # 複数ラウンド＋escalate早期停止を観察
```
外部 API（Gemini/Vertex）は一切呼ばない。攻撃役・防御役はフェイクのハードコード・ルールのみ。

## ADK でループを書くときの勘所・ハマりどころ

1. **停止条件は2系統。** `LoopAgent` は「`maxIterations` 到達」**または**「sub-agent が `actions.escalate=true` の Event を yield」のどちらかで止まる。`maxIterations` は省略すると**無限**なので、暴走防止のハード上限として必ず明示する（設計 §9 のラウンド上限はここに乗る）。
2. **状態の受け渡しは `ctx.session.state` の直接読み書き。** 1 つの invocation 内では sub-agent 間で同じ session オブジェクトを共有するので直接代入で次のエージェントに渡る。あわせて `Event.actions.stateDelta` にも書くと Runner/セッション側の正史として残る（永続化・再開はこちら）。攻撃→防御→フィードバックの折り返しはこの state を通すのが素直。
3. **カスタムエージェントは `BaseAgent` 継承で `runAsyncImpl` と `runLiveImpl` の両方を実装必須**（どちらも abstract）。音声/動画を使わないなら `runLiveImpl` は throw で可。`runAsyncImpl` は `AsyncGenerator<Event>`。
4. **Event は手組みせず `createEvent()` / `createEventActions()` を使う。** id・timestamp・各 dict 既定値を埋めてくれる。`author` に `this.name` を入れると Runner 側のイベント観測で「誰が喋ったか」が追える。
5. **LLM 非依存で全オーケストレーションがオフラインで回る。** カスタム `BaseAgent` ＋ `InMemoryRunner.runEphemeral` なら認証も課金も不要。`LlmAgent` を使う段になって初めて model（Gemini）＋ Vertex/API クレデンシャルが要る＝攻防ループの「制御部」と「頭脳部」を分けて開発・テストできる。

## go/no-go 判定材料

- ✅ 2エージェントの自律ループが ADK で 1往復成立。`escalate` による早期打ち切りと `maxIterations` のハード上限が両方効くことを実機確認。
- ✅ `session.state` 経由で防御→攻撃のフィードバックが次ラウンドに届く（`reactedToFeedback` ログで確認）＝攻防の折り返しが ADK のプリミティブだけで書ける。
- ✅ TypeScript 型整合（`tsc --noEmit` グリーン）。書き味は素直。**loop自律性は「ADK ネイティブで実装」を維持できる見込み**。
