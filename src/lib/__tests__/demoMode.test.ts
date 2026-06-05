import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEMO_MODE_DISABLED_MESSAGE,
  assertDemoMode,
  isDemoMode,
} from "@/lib/demoMode";
import { runLoop } from "@/agents/loop";

// process.env.DEMO_MODE をテストごとに退避・復元する。
let savedDemoMode: string | undefined;

beforeEach(() => {
  savedDemoMode = process.env.DEMO_MODE;
});

afterEach(() => {
  if (savedDemoMode === undefined) {
    delete process.env.DEMO_MODE;
  } else {
    process.env.DEMO_MODE = savedDemoMode;
  }
});

describe("isDemoMode", () => {
  it('DEMO_MODE === "true" のときだけ有効', () => {
    process.env.DEMO_MODE = "true";
    expect(isDemoMode()).toBe(true);
  });

  it("未設定・他の値はすべて無効（フェイルセーフ）", () => {
    delete process.env.DEMO_MODE;
    expect(isDemoMode()).toBe(false);

    for (const v of ["", "false", "1", "yes", "TRUE"]) {
      process.env.DEMO_MODE = v;
      expect(isDemoMode()).toBe(false);
    }
  });
});

describe("assertDemoMode", () => {
  it("有効時は何もしない", () => {
    process.env.DEMO_MODE = "true";
    expect(() => assertDemoMode()).not.toThrow();
  });

  it("無効時は所定メッセージで例外", () => {
    delete process.env.DEMO_MODE;
    expect(() => assertDemoMode()).toThrow(DEMO_MODE_DISABLED_MESSAGE);
  });
});

describe("runLoop のモードガード", () => {
  it("DEMO_MODE 無効時は実行されず例外を投げる", async () => {
    delete process.env.DEMO_MODE;
    await expect(runLoop({ maxRounds: 1 })).rejects.toThrow(
      DEMO_MODE_DISABLED_MESSAGE,
    );
  });
});
