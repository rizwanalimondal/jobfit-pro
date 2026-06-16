import React, { useState, useRef, useCallback } from "react";
import mammoth from "mammoth";
import {
  MAX_JD_CHARS,
  truncate,
  safeParseJSON,
  splitRationale,
  computeOverall,
  WEIGHTS,
  emptyProfile,
  SOURCE_WEIGHTS,
  completeness,
  mergeProfile,
  cleanGithubHandle,
} from "./lib/helpers.js";

/* ============================================================
   JobFit Pro — Resume & Cover Letter Optimization
   AI-powered, no-fabrication, transparent match scoring.

   Dual-mode API client:
   - Inside a Claude artifact, fetch() to the keyless completion
     endpoint works with no key.
   - Run locally with your own key in .env (VITE_ANTHROPIC_API_KEY).
     NEVER deploy a build that embeds a key — see README.
   ============================================================ */

const MODEL = "claude-sonnet-4-6";
const LOCAL_KEY =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_ANTHROPIC_API_KEY) ||
  "";

// Keyless ambient auth only works inside a Claude artifact (sandboxed iframe
// with a null origin, or served from a claude.ai/claude.site domain).
const IS_ARTIFACT =
  typeof window !== "undefined" &&
  (window.location.origin === "null" ||
    /claude\.(ai|site)/.test(window.location.origin));

async function callClaude(prompt, { signal, tools } = {}) {
  const headers = { "Content-Type": "application/json" };
  // Local mode: caller supplied their own key via .env.
  if (LOCAL_KEY) {
    headers["x-api-key"] = LOCAL_KEY;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }
  const body = {
    model: MODEL,
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  };
  if (tools) body.tools = tools;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      "The AI service returned an error (" + response.status + "). Please retry."
    );
  }
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "AI request failed.");
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  if (!text.trim()) throw new Error("The AI returned an empty response. Please retry.");
  return text;
}

/* ============================================================
   Prompt builders
   ============================================================ */

const NO_FABRICATION = `ABSOLUTE RULE — NO FABRICATION:
You must never invent, embellish, or assume any fact about the candidate that
is not present in the supplied profile. Do not add employers, dates, metrics,
tools, certifications, or achievements that were not given. If a desirable
qualification is missing, leave it out and surface it in the gap analysis
instead. Rephrasing and reordering true facts is allowed; inventing facts is not.`;

function analysisPrompt(profileText, jd) {
  return `You are an expert technical recruiter and ATS analyst.
${NO_FABRICATION}

Compare the CANDIDATE PROFILE against the JOB DESCRIPTION and score the match.

Use this exact weighted rubric (each dimension scored 0-100):
- hardSkills: 40%   (specific tools, technologies, domain skills the JD requires)
- experience: 30%   (years, seniority, relevance of past roles)
- qualifications: 15% (degrees, certifications, licences the JD asks for)
- keywords: 15%     (exact terminology / phrasing an ATS would screen on)

Respond with ONLY a JSON object, no prose, no markdown fences:
{
  "company": "string",
  "jobTitle": "string",
  "breakdown": {
    "hardSkills": { "score": 0, "rationale": "one sentence" },
    "experience": { "score": 0, "rationale": "one sentence" },
    "qualifications": { "score": 0, "rationale": "one sentence" },
    "keywords": { "score": 0, "rationale": "one sentence" }
  },
  "strengths": ["..."],
  "gaps": [
    { "item": "string", "severity": "critical|moderate|minor", "evidence": "why this is a gap" }
  ],
  "roadmap": [
    { "action": "string", "effort": "low|medium|high", "impact": "low|medium|high" }
  ]
}

=== CANDIDATE PROFILE ===
${profileText}

=== JOB DESCRIPTION ===
${truncate(jd, MAX_JD_CHARS)}`;
}

function resumePrompt(profileText, jd, jdData, style, feedback) {
  const styleNote =
    style === "redesign"
      ? `Produce a REDESIGNED resume: reorder and reframe the candidate's TRUE
experience to lead with what this JD values most. Begin your output with a single
line "RATIONALE: <one sentence on what you changed and why>", then a line of
three dashes "---", then the resume body.`
      : `Produce a lightly optimized version of the candidate's existing resume —
ATS-safe formatting, JD keywords surfaced where TRUE, no structural redesign.`;
  return `You are an expert resume writer optimizing for ATS and human readers.
${NO_FABRICATION}

${styleNote}
${feedback ? "\nIncorporate this reviewer feedback: " + feedback : ""}

Target role: ${jdData?.jobTitle || "the role"} at ${jdData?.company || "the company"}.

=== CANDIDATE PROFILE ===
${profileText}

=== JOB DESCRIPTION ===
${truncate(jd, MAX_JD_CHARS)}`;
}

function coverLetterPrompt(profileText, jd, jdData, style, feedback) {
  const styleNote =
    style === "redesign"
      ? `Write a distinctive cover letter that opens with the candidate's single
strongest differentiator for THIS role. Begin output with "RATIONALE: <one
sentence>", then "---", then the letter.`
      : `Write a clean, professional cover letter in a standard structure.`;
  return `You are an expert cover-letter writer. Write in a natural, human voice.
Avoid AI-tell phrases and generic filler. Do not use the rhetorical structure
"it was not just X, it was Y".
${NO_FABRICATION}

${styleNote}
${feedback ? "\nIncorporate this reviewer feedback: " + feedback : ""}

Target role: ${jdData?.jobTitle || "the role"} at ${jdData?.company || "the company"}.

=== CANDIDATE PROFILE ===
${profileText}

=== JOB DESCRIPTION ===
${truncate(jd, MAX_JD_CHARS)}`;
}

/* ============================================================
   Small UI atoms
   ============================================================ */

function Spinner() {
  return (
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
  );
}

function Toast({ msg }) {
  if (!msg) return null;
  return (
    <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
      {msg}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, rows = 4, hint }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      <textarea
        className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

/* ============================================================
   GitHub import — three-level cascade
   1) direct GitHub public API via the model's fetch tool
   2) web search fallback
   3) manual paste fallback
   ============================================================ */

function GitHubImport({ onImport, showToast }) {
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const fetchProfile = async () => {
    const cleaned = cleanGithubHandle(handle);
    if (!cleaned) {
      setErr("Enter a GitHub username or profile URL.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      // Level 1: direct public API (no auth needed for public data)
      const apiPrompt = `Fetch https://api.github.com/users/${cleaned}/repos?sort=updated&per_page=20
and https://api.github.com/users/${cleaned}. Summarize the user's public
repositories as a plain-text portfolio: for each notable repo give name, language,
a one-line description, and star count. No preamble.`;
      let text = "";
      try {
        text = await callClaude(apiPrompt, {
          tools: [{ type: "web_search_20250305", name: "web_search" }],
        });
      } catch (e) {
        text = "";
      }
      if (text && text.trim().length > 40) {
        onImport(text.trim());
        showToast("Imported GitHub projects");
      } else {
        setErr(
          "Couldn't fetch that profile automatically — it may be very new and not yet indexed. Paste your project list below instead."
        );
      }
    } catch (e) {
      setErr(e.message || "GitHub import failed. Paste your projects manually.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="github.com/username or just username"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
        />
        <button
          onClick={fetchProfile}
          disabled={busy}
          className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? <Spinner /> : null} Import
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-amber-700">{err}</p>}
    </div>
  );
}

/* ============================================================
   Step 1 — Profile intake
   ============================================================ */

function ProfileStep({ profile, setProfile, onNext, showToast }) {
  const fileRef = useRef(null);
  const set = (k) => (v) => setProfile((p) => ({ ...p, [k]: v }));
  const { score, missing } = completeness(profile);

  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
      setProfile((p) => ({ ...p, resume: value.trim() }));
      showToast("Resume text extracted");
    } catch {
      showToast("Couldn't read that file — paste the text instead");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Your profile</h2>
        <p className="text-sm text-slate-600">
          The more true material you give, the better the match. Nothing is invented for you.
        </p>
      </div>

      <div className="rounded-lg bg-teal-50 p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-teal-900">Profile completeness</span>
          <span className="text-sm font-bold text-teal-900">{score}%</span>
        </div>
        <div className="mt-1.5 h-2 rounded-full bg-teal-100">
          <div className="h-2 rounded-full bg-teal-600" style={{ width: score + "%" }} />
        </div>
        {missing.length > 0 && (
          <p className="mt-1.5 text-xs text-teal-800">
            Add for a stronger result: {missing.map((m) => m.label).join(", ")}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Upload resume (.docx)
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".docx"
          onChange={onUpload}
          className="hidden"
        />
        <span className="text-xs text-slate-400">or paste below</span>
      </div>

      <Field label="Resume" value={profile.resume} onChange={set("resume")} rows={6}
        placeholder="Paste your full resume text" />
      <Field label="Existing cover letter (optional)" value={profile.coverLetter}
        onChange={set("coverLetter")} placeholder="Any cover letter you've used before" />

      <div className="rounded-lg border border-slate-200 p-3">
        <p className="text-sm font-medium text-slate-700">LinkedIn sections</p>
        <p className="text-xs text-slate-400">
          LinkedIn can't be fetched automatically — it requires login and actively blocks
          scraping. Copy these sections from your profile and paste them.
        </p>
        <div className="mt-2 space-y-2">
          <Field label="About" value={profile.liAbout} onChange={set("liAbout")} rows={3} />
          <Field label="Experience" value={profile.liExperience} onChange={set("liExperience")} rows={4} />
          <Field label="Recommendations" value={profile.liRecommendations}
            onChange={set("liRecommendations")} rows={3} />
        </div>
      </div>

      <div>
        <p className="text-sm font-medium text-slate-700">Projects / GitHub</p>
        <GitHubImport onImport={(t) => set("github")(t)} showToast={showToast} />
        <Field label="" value={profile.github} onChange={set("github")} rows={4}
          placeholder="Imported or pasted project list" />
      </div>

      <Field label="Certifications, publications, volunteering, awards" value={profile.extra}
        onChange={set("extra")} rows={3} />

      <div className="flex justify-end">
        <button
          onClick={onNext}
          disabled={!profile.resume.trim()}
          className="rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          Next: job description →
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   Step 2 — Job description
   ============================================================ */

function JDStep({ jd, setJd, onBack, onAnalyze, busy }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-slate-900">Target job description</h2>
      <textarea
        className="w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
        rows={14}
        value={jd}
        onChange={(e) => setJd(e.target.value)}
        placeholder="Paste the full job description"
      />
      <div className="flex justify-between">
        <button onClick={onBack} className="text-sm font-medium text-slate-600 hover:underline">
          ← Back
        </button>
        <button
          onClick={onAnalyze}
          disabled={busy || jd.trim().length < 50}
          className="flex items-center gap-2 rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? <Spinner /> : null} Analyze & generate
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   Match gauge — semicircular, transparent weighting
   ============================================================ */

function MatchGauge({ score }) {
  const r = 80;
  const circ = Math.PI * r;
  const off = circ * (1 - score / 100);
  const color = score >= 70 ? "#0f766e" : score >= 45 ? "#b45309" : "#b91c1c";
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 110" className="w-56">
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#e2e8f0" strokeWidth="14"
          strokeLinecap="round" />
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke={color} strokeWidth="14"
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={off} />
        <text x="100" y="92" textAnchor="middle" className="fill-slate-900"
          style={{ fontSize: 32, fontWeight: 700 }}>{score}</text>
      </svg>
      <span className="text-sm text-slate-500">overall match</span>
    </div>
  );
}

function AnalysisPanel({ analysis }) {
  if (!analysis) return <p className="text-sm text-slate-500">No analysis yet.</p>;
  const overall = computeOverall(analysis.breakdown);
  const sevColor = {
    critical: "bg-red-50 text-red-800 border-red-200",
    moderate: "bg-amber-50 text-amber-800 border-amber-200",
    minor: "bg-slate-50 text-slate-700 border-slate-200",
  };
  return (
    <div className="space-y-5">
      <MatchGauge score={overall} />
      <div>
        <h3 className="text-sm font-semibold text-slate-700">How this score is built</h3>
        <div className="mt-2 space-y-2">
          {Object.keys(WEIGHTS).map((k) => {
            const d = analysis.breakdown?.[k] || {};
            return (
              <div key={k} className="rounded-lg border border-slate-200 p-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium capitalize text-slate-800">
                    {k.replace(/([A-Z])/g, " $1")} <span className="text-slate-400">({WEIGHTS[k]}%)</span>
                  </span>
                  <span className="font-semibold text-slate-900">{d.score ?? 0}</span>
                </div>
                {d.rationale && <p className="mt-1 text-xs text-slate-500">{d.rationale}</p>}
              </div>
            );
          })}
        </div>
      </div>
      {analysis.gaps?.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Gap analysis</h3>
          <div className="mt-2 space-y-2">
            {analysis.gaps.map((g, i) => (
              <div key={i} className={"rounded-lg border p-2.5 text-sm " + (sevColor[g.severity] || sevColor.minor)}>
                <span className="font-medium">{g.item}</span>
                <span className="ml-2 text-xs uppercase opacity-70">{g.severity}</span>
                {g.evidence && <p className="mt-0.5 text-xs opacity-80">{g.evidence}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RoadmapPanel({ analysis }) {
  if (!analysis?.roadmap?.length)
    return <p className="text-sm text-slate-500">No roadmap items.</p>;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-700">Development roadmap</h3>
      {analysis.roadmap.map((r, i) => (
        <div key={i} className="rounded-lg border border-slate-200 p-2.5 text-sm">
          <p className="font-medium text-slate-800">{r.action}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            effort: {r.effort} · impact: {r.impact}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   Document panel — original / redesign, edit, regenerate, copy
   ============================================================ */

function DocumentPanel({ title, original, redesign, onEdit, onRegenerate, filenameBase, showToast }) {
  const [variant, setVariant] = useState("redesign");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const doc = variant === "redesign" ? redesign : original;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(doc?.text || "");
      showToast("Copied to clipboard");
    } catch {
      showToast("Copy failed — select and copy manually");
    }
  };

  const download = () => {
    const blob = new Blob([doc?.text || ""], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filenameBase + "-" + variant + ".txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const regen = async () => {
    setBusy(true);
    try {
      await onRegenerate(variant, feedback);
      setFeedback("");
      showToast("Regenerated");
    } catch (e) {
      showToast(e.message || "Regeneration failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
          {["redesign", "original"].map((v) => (
            <button key={v} onClick={() => setVariant(v)}
              className={"rounded-md px-3 py-1 text-xs font-medium capitalize " +
                (variant === v ? "bg-teal-700 text-white" : "text-slate-600")}>
              {v}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={copy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium">Copy</button>
          <button onClick={download} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium">Download</button>
        </div>
      </div>

      {doc?.rationale && (
        <p className="rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-800">
          <span className="font-semibold">Why this version: </span>{doc.rationale}
        </p>
      )}

      <textarea
        className="w-full rounded-lg border border-slate-300 p-3 font-mono text-xs leading-relaxed"
        rows={18}
        value={doc?.text || ""}
        onChange={(e) => onEdit(variant, e.target.value)}
      />

      <div className="flex gap-2">
        <input
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Feedback to regenerate (e.g. 'shorter, lead with offshore experience')"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
        <button onClick={regen} disabled={busy}
          className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? <Spinner /> : null} Regenerate
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   Step 3 — Results
   ============================================================ */

const TABS = ["Resume", "Cover Letter", "Match Analysis", "Roadmap"];

function ResultsStep({ results, setResults, profileText, jd, jdData, onBack, showToast }) {
  const [tab, setTab] = useState("Resume");

  const editDoc = (baseKey) => (style, text) => {
    const key = baseKey + (style === "redesign" ? "Redesign" : "Original");
    setResults((r) => ({ ...r, [key]: { ...(r[key] || {}), text } }));
  };

  const regenDoc = (baseKey) => async (style, feedback) => {
    const key = baseKey + (style === "redesign" ? "Redesign" : "Original");
    const promptFn = baseKey === "resume" ? resumePrompt : coverLetterPrompt;
    const raw = await callClaude(promptFn(profileText, jd, jdData, style, feedback));
    if (style === "redesign") {
      const { rationale, body } = splitRationale(raw);
      setResults((r) => ({
        ...r,
        [key]: { text: body, rationale: rationale || r[key]?.rationale || "" },
      }));
    } else {
      setResults((r) => ({ ...r, [key]: { text: raw.trim(), rationale: "" } }));
    }
  };

  const company = (jdData?.company || "company").replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Your deliverables</h2>
          <p className="text-sm text-slate-600">
            {jdData?.jobTitle} · {jdData?.company}
          </p>
        </div>
        <button onClick={onBack} className="text-sm font-medium text-teal-800 hover:underline">
          ← Back to generation
        </button>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={"whitespace-nowrap px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition " +
              (tab === t ? "border-teal-700 text-teal-800" : "border-transparent text-slate-500 hover:text-slate-700")}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Resume" && (
        <DocumentPanel title="Resume" original={results.resumeOriginal} redesign={results.resumeRedesign}
          onEdit={editDoc("resume")} onRegenerate={regenDoc("resume")}
          filenameBase={"resume-" + company} showToast={showToast} />
      )}
      {tab === "Cover Letter" && (
        <DocumentPanel title="Cover Letter" original={results.coverOriginal} redesign={results.coverRedesign}
          onEdit={editDoc("cover")} onRegenerate={regenDoc("cover")}
          filenameBase={"cover-letter-" + company} showToast={showToast} />
      )}
      {tab === "Match Analysis" && <AnalysisPanel analysis={results.analysis} />}
      {tab === "Roadmap" && <RoadmapPanel analysis={results.analysis} />}
    </div>
  );
}

/* ============================================================
   Root
   ============================================================ */

export default function App() {
  const [step, setStep] = useState(1);
  const [profile, setProfile] = useState(emptyProfile);
  const [jd, setJd] = useState("");
  const [results, setResults] = useState(null);
  const [jdData, setJdData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const profileTextRef = useRef("");

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }, []);

  const runGeneration = async () => {
    if (!LOCAL_KEY && !IS_ARTIFACT) {
      setError(
        "API key required — JobFit Pro is a portfolio demo that uses your own Anthropic API key " +
        "to generate documents. Add your key to a .env file as VITE_ANTHROPIC_API_KEY=sk-ant-... " +
        "and restart the dev server. See the README for setup instructions, or get a key at console.anthropic.com."
      );
      return;
    }
    setBusy(true);
    setError("");
    const profileText = mergeProfile(profile);
    profileTextRef.current = profileText;
    try {
      const analysisRaw = await callClaude(analysisPrompt(profileText, jd));
      const analysis = safeParseJSON(analysisRaw);
      setJdData({ company: analysis.company, jobTitle: analysis.jobTitle });

      const [resumeRedesignRaw, resumeOriginalRaw, coverRedesignRaw, coverOriginalRaw] =
        await Promise.all([
          callClaude(resumePrompt(profileText, jd, analysis, "redesign")),
          callClaude(resumePrompt(profileText, jd, analysis, "original")),
          callClaude(coverLetterPrompt(profileText, jd, analysis, "redesign")),
          callClaude(coverLetterPrompt(profileText, jd, analysis, "original")),
        ]);

      const rr = splitRationale(resumeRedesignRaw);
      const cr = splitRationale(coverRedesignRaw);
      setResults({
        analysis,
        resumeRedesign: { text: rr.body, rationale: rr.rationale },
        resumeOriginal: { text: resumeOriginalRaw.trim(), rationale: "" },
        coverRedesign: { text: cr.body, rationale: cr.rationale },
        coverOriginal: { text: coverOriginalRaw.trim(), rationale: "" },
      });
      setStep(3);
    } catch (e) {
      setError(e.message || "Generation failed. Please retry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">JobFit Pro</h1>
        <p className="text-sm text-slate-600">
          No-fabrication resume & cover letter optimizer with transparent match scoring.
        </p>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {step === 1 && (
        <ProfileStep profile={profile} setProfile={setProfile}
          onNext={() => setStep(2)} showToast={showToast} />
      )}
      {step === 2 && (
        <JDStep jd={jd} setJd={setJd} onBack={() => setStep(1)}
          onAnalyze={runGeneration} busy={busy} />
      )}
      {step === 3 && results && (
        <ResultsStep results={results} setResults={setResults}
          profileText={profileTextRef.current} jd={jd} jdData={jdData}
          onBack={() => setStep(2)} showToast={showToast} />
      )}

      <Toast msg={toast} />
    </div>
  );
}
