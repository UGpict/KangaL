// Authentication-Results parser. NOT a general-purpose parser:
// real headers carry comments and quoting like
//   spf=pass (gmail.com: domain of foo@bar designates 1.2.3.4)
// which this regex does not handle. Designed for the simplified
// `key=value` format produced by KangaL inbox samples — i.e. the input
// is in our control on the boundary side. Wire to a proper header
// extractor when accepting real-world mail.

export type AuthVerdict = "pass" | "fail" | "none";

export type VerifySenderAuthResult =
  | {
      ok: true;
      spf: AuthVerdict;
      dkim: AuthVerdict;
      dmarc: AuthVerdict;
      raw: string;
    }
  | { ok: false; reason: string };

// RFC 8601 result keywords per method. SPF additionally has `softfail`;
// DKIM/DMARC don't define `softfail` but accept temp/permerror.
const SPF_REGEX =
  /\bspf\s*=\s*(pass|fail|softfail|neutral|none|temperror|permerror)\b/i;
const DKIM_REGEX =
  /\bdkim\s*=\s*(pass|fail|neutral|none|temperror|permerror|policy)\b/i;
const DMARC_REGEX =
  /\bdmarc\s*=\s*(pass|fail|none|temperror|permerror)\b/i;

function normalize(raw: string | undefined): AuthVerdict {
  if (!raw) return "none";
  const v = raw.toLowerCase();
  if (v === "pass") return "pass";
  if (v === "fail" || v === "softfail" || v === "temperror" || v === "permerror") {
    return "fail";
  }
  return "none";
}

export async function verifySenderAuth(args: {
  authenticationResults: string;
}): Promise<VerifySenderAuthResult> {
  const raw = args.authenticationResults?.trim() ?? "";
  if (!raw) {
    return { ok: false, reason: "empty_input" };
  }
  const spf = raw.match(SPF_REGEX);
  const dkim = raw.match(DKIM_REGEX);
  const dmarc = raw.match(DMARC_REGEX);
  if (!spf && !dkim && !dmarc) {
    return { ok: false, reason: "no_auth_tokens" };
  }
  return {
    ok: true,
    spf: normalize(spf?.[1]),
    dkim: normalize(dkim?.[1]),
    dmarc: normalize(dmarc?.[1]),
    raw,
  };
}
