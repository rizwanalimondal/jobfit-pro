import { describe, it, expect } from "vitest";
import {
  truncate,
  safeParseJSON,
  splitRationale,
  computeOverall,
  WEIGHTS,
  completeness,
  mergeProfile,
  emptyProfile,
  cleanGithubHandle,
} from "../src/lib/helpers.js";

describe("truncate", () => {
  it("returns short strings unchanged", () => {
    expect(truncate("hello", 100)).toBe("hello");
  });
  it("truncates long strings and appends a note", () => {
    const out = truncate("a".repeat(50), 10);
    expect(out.startsWith("a".repeat(10))).toBe(true);
    expect(out).toContain("truncated at 10 characters");
  });
  it("handles empty and null input", () => {
    expect(truncate("", 10)).toBe("");
    expect(truncate(null, 10)).toBe("");
  });
});

describe("safeParseJSON", () => {
  it("parses clean JSON", () => {
    expect(safeParseJSON('{"a":1}')).toEqual({ a: 1 });
  });
  it("strips markdown fences", () => {
    expect(safeParseJSON('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("extracts JSON surrounded by prose", () => {
    expect(safeParseJSON('Here is the data: {"a":1} hope that helps!')).toEqual({ a: 1 });
  });
  it("repairs trailing commas", () => {
    expect(safeParseJSON('{"a":1,"b":[1,2,],}')).toEqual({ a: 1, b: [1, 2] });
  });
  it("throws a readable error on unparseable input", () => {
    expect(() => safeParseJSON("not json at all")).toThrow();
  });
});

describe("splitRationale", () => {
  it("splits a rationale block with a divider", () => {
    const { rationale, body } = splitRationale("RATIONALE: did X\n---\nThe body text");
    expect(rationale).toBe("did X");
    expect(body).toBe("The body text");
  });
  it("tolerates a missing divider", () => {
    const { rationale, body } = splitRationale("RATIONALE: did Y\n\nBody here");
    expect(rationale).toBe("did Y");
    expect(body).toBe("Body here");
  });
  it("returns empty rationale when absent", () => {
    const { rationale, body } = splitRationale("Just a plain document");
    expect(rationale).toBe("");
    expect(body).toBe("Just a plain document");
  });
  it("handles empty input", () => {
    expect(splitRationale("")).toEqual({ rationale: "", body: "" });
  });
});

describe("computeOverall / WEIGHTS", () => {
  it("weights sum to 100", () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it("computes a correct weighted average", () => {
    const out = computeOverall({
      hardSkills: { score: 100 },
      experience: { score: 100 },
      qualifications: { score: 100 },
      keywords: { score: 100 },
    });
    expect(out).toBe(100);
  });
  it("clamps out-of-range model scores", () => {
    const out = computeOverall({
      hardSkills: { score: 200 },
      experience: { score: -50 },
      qualifications: { score: 50 },
      keywords: { score: 50 },
    });
    // hardSkills clamps to 100 (40), experience to 0, quals 7.5, keywords 7.5 = 55
    expect(out).toBe(55);
  });
  it("treats missing dimensions as zero", () => {
    expect(computeOverall({})).toBe(0);
    expect(computeOverall(null)).toBe(0);
  });
});

describe("completeness", () => {
  it("is zero for an empty profile", () => {
    const { score, missing } = completeness(emptyProfile);
    expect(score).toBe(0);
    expect(missing.length).toBe(7);
  });
  it("ignores trivially short entries", () => {
    const { score } = completeness({ ...emptyProfile, resume: "short" });
    expect(score).toBe(0);
  });
  it("scores a full profile at 100", () => {
    const full = Object.fromEntries(
      Object.keys(emptyProfile).map((k) => [k, "x".repeat(40)])
    );
    expect(completeness(full).score).toBe(100);
  });
  it("weights the resume highest (35 pts)", () => {
    const { score } = completeness({ ...emptyProfile, resume: "x".repeat(40) });
    expect(score).toBe(35);
  });
});

describe("mergeProfile", () => {
  it("includes only non-empty sources, with labeled sections", () => {
    const merged = mergeProfile({
      ...emptyProfile,
      resume: "My resume text",
      github: "noonkit — CII analyser",
    });
    expect(merged).toContain("=== RESUME ===");
    expect(merged).toContain("=== PROJECTS / GITHUB / PORTFOLIO ===");
    expect(merged).not.toContain("LINKEDIN ABOUT");
  });
  it("returns empty string for an empty profile", () => {
    expect(mergeProfile(emptyProfile)).toBe("");
  });
  it("caps oversized sources", () => {
    const merged = mergeProfile({ ...emptyProfile, resume: "r".repeat(20000) });
    expect(merged).toContain("truncated at 9000 characters");
  });
});

describe("cleanGithubHandle", () => {
  it("passes through a bare username", () => {
    expect(cleanGithubHandle("rizwanalimondal")).toBe("rizwanalimondal");
  });
  it("strips a full profile URL", () => {
    expect(cleanGithubHandle("https://github.com/rizwanalimondal")).toBe("rizwanalimondal");
  });
  it("strips www, trailing slashes, and repo paths", () => {
    expect(cleanGithubHandle("https://www.github.com/user/repo/")).toBe("user");
  });
  it("trims whitespace and handles empty input", () => {
    expect(cleanGithubHandle("  user  ")).toBe("user");
    expect(cleanGithubHandle("")).toBe("");
    expect(cleanGithubHandle(null)).toBe("");
  });
});
