import { spawn } from "child_process";

type InlineItem = { path: string; to: number; message: string };

export async function runClaudeDescribe(diff: string): Promise<string> {
  const prompt = [
    "You are an expert reviewer. Summarize this PR diff in 6-10 bullet points:",
    "• What changed (features/refactors/migrations)",
    "• Risks and breaking changes",
    "• Tests/validation status",
    "• Follow-ups / TODOs",
    "Output: clean markdown with each bullet point on a separate line, no code fences.",
    "",
    "After the bullet points, add:",
    "",
    "Human effort:",
    "10 days (this is just an example)",
    "",
    "Claude Code effort:",
    "2 days (this is just an example)",
    "",
    "Productivity increase:",
    "5x  (this is just an example)"
  ].join("\n");

  const out = await runClaudeHeadless(prompt, diff, "single-markdown");
  return out.trim();
}

export async function runClaudeReview(diff: string): Promise<string> {
  const prompt = [
    "Act as a senior staff engineer. Review the PR diff.",
    "Focus on: correctness, security, performance, readability, tests.",
    "Output: Markdown with sections: Overview, Strengths, Risks, Action Items.",
    "",
    "After the Action Items section, add:",
    "",
    "PR Review Effort: 1/5 (this is just an example, 1 is easy and not taking long time while 5 is the hardest)",
    "Estimating PR Review: 3 minutes (this is just an example)"
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

