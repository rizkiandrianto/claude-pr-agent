import { spawn } from "child_process";

type InlineItem = { path: string; to: number; message: string };

export async function runClaudeDescribe(diff: string): Promise<string> {
  const prompt = [
    "You are an expert PR reviewer. Analyze this PR diff and provide:",
    "",
    "## Summary",
    "Provide 6-10 concise bullet points covering:",
    "- What changed (features, refactors, migrations, bug fixes)",
    "- Risks and breaking changes",
    "- Test coverage and validation status",
    "- Follow-ups, TODOs, or recommended improvements",
    "",
    "Output clean markdown with each bullet point on a separate line, no code fences.",
    "",
    "## Effort Analysis",
    "Based on the scale and complexity of the changes, estimate:",
    "",
    "- **Estimated human effort:** [X hours/days]",
    "- **Estimated Claude Code effort:** [Y hours/days]",
    "- **Productivity multiplier:** [Z]x",
    "",
    "Guidelines for effort estimation:",
    "- Small changes (< 50 lines, simple logic): Use minutes or hours (e.g., \"2 hours\" → \"30 minutes\")",
    "- Medium changes (50-300 lines, moderate complexity): Use hours or days (e.g., \"1-2 days\" → \"4-6 hours\")",
    "- Large changes (300+ lines, high complexity): Use days (e.g., \"5 days\" → \"1 day\")",
    "- Consider: code complexity, testing requirements, refactoring scope, and domain knowledge needed",
    "- Be realistic: if a change is trivial, acknowledge it (e.g., \"30 min\" → \"5 min\", 6x faster)"
  ].join("\n");

  const out = await runClaudeHeadless(prompt, diff, "single-markdown");
  return out.trim();
}

export async function runClaudeReview(diff: string): Promise<string> {
  const prompt = [
    "You're a senior engineer reviewing this PR. Keep it straightforward and actionable.",
    "",
    "Focus on:",
    "- Correctness: Does it work? Any bugs or edge cases?",
    "- Security: Any vulnerabilities or data exposure?",
    "- Performance: Any obvious inefficiencies?",
    "- Readability: Is it clear what the code does?",
    "- Tests: Are critical paths covered?",
    "",
    "Format your review as:",
    "",
    "## What This PR Does",
    "Brief summary in plain English.",
    "",
    "## What Works Well",
    "2-3 specific things done right. Be concrete.",
    "",
    "## Issues to Address",
    "**Blocking:** Must fix before merge (bugs, security, breaking changes)",
    "**Should Fix:** Important but not blocking (performance, clarity, tech debt)",
    "**Nice to Have:** Optional improvements (style, refactoring)",
    "",
    "## Bottom Line",
    "Clear approve/request changes/needs discussion.",
    "",
    "---",
    "- **Review Complexity:** [1-5]/5 (1=trivial, 5=requires deep domain knowledge)",
    "- **Time Spent:** ~[X] minutes"
  ].join("\n");
  const out = await runClaudeHeadless(prompt, diff, "single-markdown");
  return out.trim();
}

export async function runClaudeInline(diff: string): Promise<InlineItem[]> {
  const prompt = [
    "From the unified diff, propose specific inline comments.",
    "Return JSON array of objects with keys: path (string), to (number), message (string).",
    "Target DESTINATION line numbers only (the + side from @@ -x,y +DEST,d @@).",
    "Only include findings that are high-signal (bugs, obvious smells, TODO/console.log, security).",
    "If none, return [] only."
  ].join("\n");

  const out = await runClaudeHeadless(prompt, diff, "json");
  try {
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed.slice(0, 25) : [];
  } catch {
    return [];
  }
}

/**
 * Runs 'claude' headlessly. Assumes user already did magic-link login once.
 * We pass prompt via -p and diff via stdin. For structured output,
 * many builds support --output-format json|markdown. Adjust as needed.
 */
function runClaudeHeadless(prompt: string, stdinPayload: string, mode: "json"|"single-markdown"): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["-p", prompt];
    // if your version supports output formats, add it; else just parse plain text
    if (mode === "json") args.push("--output-format", "json");
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "", stderr = "";
    child.stdout.on("data", d => stdout += d.toString());
    child.stderr.on("data", d => stderr += d.toString());
    child.on("close", code => code === 0 ? resolve(stdout) : reject(new Error(stderr || `claude exit ${code}`)));

    child.stdin.write(stdinPayload);
    child.stdin.end();
  });
}

