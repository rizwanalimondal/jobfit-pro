/* ============================================================
   JobFit Pro — pure logic (no React, no DOM, no network)
   Everything in this file is unit-tested in tests/helpers.test.js
   ============================================================ */

export const MAX_FIELD_CHARS = 9000; // per-source cap before merging
export const MAX_JD_CHARS = 12000;

export const truncate = (str, max) => {
  if (!str) return "";
  if (str.length <= max) return str;
  return (
    str.slice(0, max) +
    "\n\n[NOTE: input truncated at " + max + " characters for length]"
  );
};

export function safeParseJSON(raw) {
  let t = (raw || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) t = t.slice(first, last + 1);
  try {
    return JSON.parse(t);
  } catch (e) {
    // last-ditch: remove trailing commas
    try {
      return JSON.parse(t.replace(/,\s*([}\]])/g, "$1"));
    } catch (e2) {
      throw new Error(
        "Could not read structured data from the AI response. Please retry."
      );
    }
  }
}

export function splitRationale(text) {
  const m = (text || "").match(/^\s*RATIONALE:\s*(.+?)\s*\n+-{3,}\s*\n/s);
  if (m) {
    return { rationale: m[1].trim(), body: text.slice(m[0].length).trim() };
  }
  // tolerate model skipping the divider
  const m2 = (text || "").match(/^\s*RATIONALE:\s*(.+?)\n\n/s);
  if (m2) {
    return { rationale: m2[1].trim(), body: text.slice(m2[0].length).trim() };
  }
  return { rationale: "", body: (text || "").trim() };
}

/* ---------- Match scoring rubric ---------- */

export const WEIGHTS = {
  hardSkills: 40,
  experience: 30,
  qualifications: 15,
  keywords: 15,
};

/**
 * Weighted overall score from a per-dimension breakdown.
 * Each dimension score is clamped to 0..100 before weighting.
 * Returns a 0..100 integer.
 */
export function computeOverall(breakdown) {
  let total = 0;
  for (const k of Object.keys(WEIGHTS)) {
    const s = Math.max(0, Math.min(100, Number(breakdown?.[k]?.score) || 0));
    total += (s * WEIGHTS[k]) / 100;
  }
  return Math.round(total);
}

/* ---------- Candidate profile ---------- */

export const emptyProfile = {
  resume: "",
  coverLetter: "",
  liAbout: "",
  liExperience: "",
  liRecommendations: "",
  github: "",
  extra: "",
};

export const SOURCE_WEIGHTS = [
  { key: "resume", label: "Resume", pts: 35 },
  { key: "coverLetter", label: "Cover letter", pts: 15 },
  { key: "liAbout", label: "LinkedIn About", pts: 10 },
  { key: "liExperience", label: "LinkedIn Experience", pts: 10 },
  { key: "liRecommendations", label: "LinkedIn Recommendations", pts: 5 },
  { key: "github", label: "Projects / GitHub", pts: 15 },
  { key: "extra", label: "Certifications & extras", pts: 10 },
];

export function completeness(profile) {
  let score = 0;
  const missing = [];
  for (const s of SOURCE_WEIGHTS) {
    if ((profile[s.key] || "").trim().length > 30) score += s.pts;
    else missing.push(s);
  }
  return { score: Math.min(100, score), missing };
}

export function mergeProfile(p) {
  const parts = [];
  if (p.resume.trim()) parts.push("=== RESUME ===\n" + truncate(p.resume.trim(), MAX_FIELD_CHARS));
  if (p.coverLetter.trim())
    parts.push("=== EXISTING COVER LETTER ===\n" + truncate(p.coverLetter.trim(), 4000));
  if (p.liAbout.trim()) parts.push("=== LINKEDIN ABOUT ===\n" + truncate(p.liAbout.trim(), 3000));
  if (p.liExperience.trim())
    parts.push("=== LINKEDIN EXPERIENCE ===\n" + truncate(p.liExperience.trim(), 5000));
  if (p.liRecommendations.trim())
    parts.push("=== LINKEDIN RECOMMENDATIONS ===\n" + truncate(p.liRecommendations.trim(), 3000));
  if (p.github.trim())
    parts.push("=== PROJECTS / GITHUB / PORTFOLIO ===\n" + truncate(p.github.trim(), 5000));
  if (p.extra.trim())
    parts.push(
      "=== CERTIFICATIONS, PUBLICATIONS, VOLUNTEERING, AWARDS, OTHER ===\n" +
        truncate(p.extra.trim(), 3000)
    );
  return parts.join("\n\n");
}

/* ---------- GitHub handle normalisation ---------- */

export function cleanGithubHandle(input) {
  return (input || "")
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/\/+$/, "")
    .split("/")[0];
}
