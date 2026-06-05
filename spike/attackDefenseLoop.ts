/**
 * ADK マルチエージェント・スパイク（使い捨て / 本実装には統合しない）。
 *
 * 目的: 攻撃エージェントと防御エージェントが「1往復」だけ自律で対話するループを ADK で成立させ、
 *       ADK のエージェント間制御（LoopAgent / BaseAgent / InvocationContext.session.state /
 *       Event の yield / escalate による打ち切り）の書き味を確認する。
 *
 * 制約（スパイク要件）:
 *   - 外部 API は一切呼ばない。LlmAgent は使わず BaseAgent を継承したカスタムエージェントだけで組む。
 *   - 攻撃役: ハードコードのフェイク AttackPattern を 1 つ「出す」だけ（生成ロジックは仮）。
 *   - 防御役: 受け取って単純ルールで detected: true/false を返すだけ。
 *   - ループ: 1 往復したら必ず止まる。無限ループ防止のラウンド上限（LoopAgent.maxIterations）を必ず入れる。
 *   - 各ステップで「誰が何を渡したか」を console に構造化ログで出す。
 *
 * 実行: npx tsx spike/attackDefenseLoop.ts
 */

import {
  BaseAgent,
  InMemoryRunner,
  InvocationContext,
  LoopAgent,
  createEvent,
  createEventActions,
  type Event,
} from "@google/adk";

// ── 無限ループ防止のハード上限。スパイク要件の「1往復」= 1（既定）。 ──────────────────
// 検証用に SPIKE_ROUND_CAP で上書き可（例: SPIKE_ROUND_CAP=3 で escalate 早期停止を観察）。
const ROUND_CAP = Number(process.env.SPIKE_ROUND_CAP ?? "1");

// ── フェイクの AttackPattern（道Bの本物の型ではなく、制御確認用の最小ダミー） ─────────
type FakeAttackPattern = {
  id: string;
  generation: number;
  channel: "email" | "sms" | "line";
  urgency: number; // 0〜3
  hasLink: boolean;
};

const FAKE_PATTERNS: FakeAttackPattern[] = [
  { id: "fake-gen1", generation: 1, channel: "email", urgency: 1, hasLink: false },
  { id: "fake-gen2", generation: 2, channel: "sms", urgency: 3, hasLink: true },
  { id: "fake-gen3", generation: 3, channel: "line", urgency: 2, hasLink: true },
];

// ── 構造化ログ。誰が・何を・どの状態を渡したかを 1 行 JSON で出す。 ──────────────────
function log(actor: string, action: string, detail: Record<string, unknown>): void {
  console.log(JSON.stringify({ actor, action, ...detail }));
}

// session.state のキー（攻撃→防御→フィードバックの受け渡しはすべてここを通す）。
const KEY_ROUND = "round";
const KEY_PATTERN = "currentPattern";
const KEY_RESULT = "lastResult";
const KEY_FEEDBACK = "feedback";

/**
 * 攻撃エージェント（カスタム BaseAgent）。
 * フェイク AttackPattern を 1 つ選んで session.state に置き、Event を yield する。
 * 直前ラウンドの防御フィードバックがあれば「次はここを変える」程度の仮の進化だけ見せる。
 */
class FakeAttackAgent extends BaseAgent {
  constructor() {
    super({ name: "attacker", description: "フェイク攻撃パターンを1つ出すだけのスパイク攻撃役" });
  }

  protected async *runAsyncImpl(
    ctx: InvocationContext,
  ): AsyncGenerator<Event, void, void> {
    const state = ctx.session.state;
    const round = (state[KEY_ROUND] as number) ?? 0;
    const feedback = state[KEY_FEEDBACK] as string | undefined;

    // 仮の「進化」: ラウンドが進むごとに次のフェイク型へ。実生成ロジックは本実装で。
    const pattern = FAKE_PATTERNS[round % FAKE_PATTERNS.length];

    state[KEY_PATTERN] = pattern;

    log("attacker", "emit_pattern", {
      round,
      reactedToFeedback: feedback ?? null,
      pattern,
    });

    yield createEvent({
      invocationId: ctx.invocationId,
      author: this.name,
      content: { parts: [{ text: `攻撃型を提示: ${pattern.id}` }] },
      actions: createEventActions({ stateDelta: { [KEY_PATTERN]: pattern } }),
    });
  }

  // 本スパイクでは音声/動画ループは使わない。
  protected async *runLiveImpl(): AsyncGenerator<Event, void, void> {
    throw new Error("runLiveImpl はスパイク対象外です");
  }
}

/**
 * 防御エージェント（カスタム BaseAgent）。
 * session.state の攻撃型を読み、単純ルールで detected を判定。
 * 判定結果とフィードバック（次ラウンドへの示唆）を state に書き戻す。
 * 検知できたら actions.escalate=true で LoopAgent を早期打ち切りできることを示す。
 */
class FakeDefenseAgent extends BaseAgent {
  constructor() {
    super({ name: "defender", description: "単純ルールで詐欺判定するだけのスパイク防御役" });
  }

  protected async *runAsyncImpl(
    ctx: InvocationContext,
  ): AsyncGenerator<Event, void, void> {
    const state = ctx.session.state;
    const round = (state[KEY_ROUND] as number) ?? 0;
    const pattern = state[KEY_PATTERN] as FakeAttackPattern | undefined;

    // 単純ルール: 緊急性が高く（>=2）かつリンクありなら詐欺とみなす（仮）。
    const detected = !!pattern && pattern.urgency >= 2 && pattern.hasLink;
    const reason = detected
      ? "urgency>=2 かつ hasLink=true のため詐欺判定"
      : "決め手不足（urgency/link が閾値未満）でスルー";

    // フィードバック: すり抜けたら攻撃側に「ここを下げろ」という示唆を返す（攻防ループの折り返し）。
    const feedback = detected
      ? "検知済み。攻撃側は別レバーへ"
      : "すり抜け。防御側は緊急性×リンクの相関を学習対象に";

    state[KEY_RESULT] = { detected, reason };
    state[KEY_FEEDBACK] = feedback;
    state[KEY_ROUND] = round + 1;

    log("defender", "judge", { round, patternId: pattern?.id ?? null, detected, reason });
    log("defender", "feedback", { round, feedback });

    yield createEvent({
      invocationId: ctx.invocationId,
      author: this.name,
      content: { parts: [{ text: `判定: detected=${detected} / ${reason}` }] },
      actions: createEventActions({
        stateDelta: {
          [KEY_RESULT]: { detected, reason },
          [KEY_FEEDBACK]: feedback,
          [KEY_ROUND]: round + 1,
        },
        // 検知できたら攻防ループを早期に打ち切る（ハード上限とは別の停止経路）。
        escalate: detected ? true : undefined,
      }),
    });
  }

  protected async *runLiveImpl(): AsyncGenerator<Event, void, void> {
    throw new Error("runLiveImpl はスパイク対象外です");
  }
}

async function main(): Promise<void> {
  // LoopAgent が [攻撃 → 防御] を 1 イテレーション実行 = 1 往復。
  // maxIterations が無限ループ防止のハード上限。escalate でも早期停止する。
  const loop = new LoopAgent({
    name: "attack_defense_loop",
    description: "攻撃→防御を回す攻防ループ（スパイク）",
    subAgents: [new FakeAttackAgent(), new FakeDefenseAgent()],
    maxIterations: ROUND_CAP,
  });

  const runner = new InMemoryRunner({ agent: loop, appName: "kangal-adk-spike" });

  log("runner", "start", { roundCap: ROUND_CAP });

  // runEphemeral: その場限りのセッションでループを起動。yield されてくる Event を上位で観測。
  for await (const event of runner.runEphemeral({
    userId: "spike-user",
    newMessage: { parts: [{ text: "攻防ループ開始" }] },
  })) {
    log("runner", "observed_event", {
      author: event.author ?? null,
      text: event.content?.parts?.map((p) => p.text ?? "").join("") ?? "",
      escalate: event.actions?.escalate ?? false,
    });
  }

  log("runner", "done", {});
}

main().catch((e) => {
  console.error("spike failed:", e);
  process.exit(1);
});
