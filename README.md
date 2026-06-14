# JobFit Pro

AI-powered resume and cover letter optimizer with a hard **no-fabrication rule**, **transparent match scoring**, and an **honest gap analysis**.

Feed it everything true about a candidate — resume, LinkedIn sections, GitHub projects, certifications — plus a target job description, and it produces ATS-optimized, human-readable application documents. Then it tells you, candidly, where the candidate falls short and what to do about it. It will not invent an employer, a metric, or a skill to close a gap; it surfaces the gap instead.

---

## Why this exists

Most "AI resume" tools optimize for a high score by quietly padding. That gets candidates into interviews they then fail, and it puts false claims in writing. JobFit Pro takes the opposite stance:

- **No fabrication, enforced at the prompt level.** Every generation prompt carries an absolute rule against inventing facts. Rephrasing and reordering true material is fine; inventing is not.
- **Transparent scoring you can audit.** The overall match number is a weighted average of four dimensions — hard skills (40%), experience (30%), qualifications (15%), keywords (15%) — and the app shows each dimension's sub-score and the model's one-line reason for it. No black box.
- **Gaps are a feature.** Missing qualifications are classified by severity (critical / moderate / minor) with evidence, and paired with a development roadmap (effort vs. impact) so the candidate knows what to fix.

This mirrors the methodology behind my other open-source tools (e.g. [noonkit](https://github.com/rizwanalimondal)) — primary logic extracted and unit-tested, scope limits stated honestly, decision-support framing rather than guarantees.

---

## Features

- Four-step wizard: profile intake -> job description -> analysis + generation -> editable results
- `.docx` resume upload (text extracted client-side via `mammoth`)
- LinkedIn sections pasted manually (LinkedIn can't be fetched — it requires login and blocks scraping; the UI says so plainly rather than pretending)
- GitHub project import via a three-level cascade: public API fetch -> web-search fallback -> manual paste
- Six deliverables per run: resume and cover letter, each in an "original" (lightly optimized) and "redesign" (reframed to lead with what the JD values) style, plus a structured match analysis
- Semicircular match gauge with the full weighted breakdown shown beneath it
- Inline editing, copy, plain-text download, and feedback-driven regeneration of any document

---

## Running locally

```bash
git clone https://github.com/rizwanalimondal/jobfit-pro.git
cd jobfit-pro
npm install
cp .env.example .env      # then add your Anthropic API key
npm run dev
```

Get a key at [console.anthropic.com](https://console.anthropic.com).

### Tests

```bash
npm test
```

The pure logic (scoring math, JSON repair, profile merging, rationale parsing, GitHub handle normalization) lives in `src/lib/helpers.js` and is covered by a vitest suite in `tests/`.

---

## A note on deploying publicly

This project runs locally with **your own** API key, or keyless inside a Claude artifact. **Do not deploy a public build that embeds an API key** — anyone visiting the page could extract it from the bundle and run up your bill.

For real public hosting you need a server-side proxy that holds the key and forwards requests (Vercel / Cloudflare Workers serverless function), ideally behind rate limiting and a spend cap. The client never sees the key. That backend is intentionally out of scope for this repo, which is a portfolio and local-use tool.

---

## Known limitations

- LinkedIn import is manual by design — automated fetching isn't possible within terms of service.
- GitHub auto-import depends on the profile being publicly reachable; very new profiles may not be indexed yet, hence the paste fallback.
- The match score is a model-assisted estimate, not a guarantee of ATS behavior — different ATS systems parse differently.
- Output quality depends entirely on how much true material you provide. Thin input, thin result.

---

## Tech

React 18 · Vite · Tailwind (Play CDN) · mammoth · vitest · Anthropic Messages API

## License

MIT — see [LICENSE](LICENSE).

Built by [Rizwan Ali Mondal](https://www.linkedin.com/in/rizwanalimondal) · [navallogic.com](https://www.navallogic.com)
