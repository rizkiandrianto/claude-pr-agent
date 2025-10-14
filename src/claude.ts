import { spawn } from "child_process";
import { parseDiff, getModifiedLineNumbers } from "./diffParser.js";

type InlineItem = { path: string; to: number; message: string };

export interface InlineSuggestion {
  relevant_file: string;
  relevant_lines_start: number;
  relevant_lines_end: number;
  suggestion_content: string;
  improved_code?: string;
  existing_code?: string;
  label: "bug_risk" | "security" | "performance" | "code_smell" | "best_practice" | "todo_cleanup";
  score: number; // 1-10, higher = more important
}

/**
 * Validate that a suggestion has all required fields
 */
function isValidSuggestion(obj: any): obj is InlineSuggestion {
  return (
    typeof obj === "object" &&
    typeof obj.relevant_file === "string" &&
    typeof obj.relevant_lines_start === "number" &&
    typeof obj.relevant_lines_end === "number" &&
    typeof obj.suggestion_content === "string" &&
    typeof obj.label === "string" &&
    typeof obj.score === "number" &&
    obj.score >= 1 &&
    obj.score <= 10
  );
}

/**
 * Format a rich inline comment with labels, code diffs, and importance
 */
function formatInlineComment(suggestion: InlineSuggestion): string {
  const labelEmojis: Record<InlineSuggestion["label"], string> = {
    bug_risk: "🐛",
    security: "🔒",
    performance: "⚡",
    code_smell: "👃",
    best_practice: "✨",
    todo_cleanup: "🧹"
  };

  const emoji = labelEmojis[suggestion.label] || "💡";
  const labelText = suggestion.label.replace(/_/g, " ").toUpperCase();
  const importance = "⭐".repeat(Math.min(Math.ceil(suggestion.score / 2), 5));

  let message = `${emoji} **${labelText}** ${importance}\n\n${suggestion.suggestion_content}`;

  // Add code diff if both existing and improved code are provided
  if (suggestion.existing_code && suggestion.improved_code) {
    message += "\n\n**Existing code:**\n```\n" + suggestion.existing_code.trim() + "\n```";
    message += "\n\n**Suggested improvement:**\n```\n" + suggestion.improved_code.trim() + "\n```";
  } else if (suggestion.improved_code) {
    message += "\n\n**Suggested code:**\n```\n" + suggestion.improved_code.trim() + "\n```";
  }

  return message;
}

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
    "From the unified diff, propose specific inline code suggestions.",
    "Return a JSON array of objects with the following structure:",
    "",
    "{",
    '  "relevant_file": "path/to/file.ts",',
    '  "relevant_lines_start": 42,',
    '  "relevant_lines_end": 45,',
    '  "suggestion_content": "Detailed explanation of the issue",',
    '  "existing_code": "current code snippet (optional)",',
    '  "improved_code": "suggested improvement (optional)",',
    '  "label": "bug_risk|security|performance|code_smell|best_practice|todo_cleanup",',
    '  "score": 8',
    "}",
    "",
    "IMPORTANT RULES:",
    "1. Target DESTINATION line numbers only (the + side from @@ -x,y +DEST,d @@)",
    "2. Only include HIGH-SIGNAL findings:",
    "   - bug_risk: Potential bugs, null checks, race conditions, logic errors",
    "   - security: SQL injection, XSS, auth issues, exposed secrets",
    "   - performance: N+1 queries, memory leaks, inefficient algorithms",
    "   - code_smell: TODO/FIXME, console.log, commented code, dead code",
    "   - best_practice: Missing error handling, unclear naming",
    "   - todo_cleanup: Leftover debug code, temporary hacks",
    "3. Score 1-10 (only include findings with score >= 6)",
    "4. Include existing_code and improved_code when suggesting fixes",
    "5. If no high-signal findings, return [] only",
    "",
    "Output only valid JSON array, no markdown formatting."
  ].join("\n");

  const out = await runClaudeHeadless(prompt, diff, "json");
  try {
    const parsed = JSON.parse(out);
    if (!Array.isArray(parsed)) return [];

    // Parse diff to validate line numbers
    const parsedDiff = parseDiff(diff);
    const fileMap = new Map<string, Set<number>>();

    parsedDiff.files.forEach(file => {
      const validLines = new Set(getModifiedLineNumbers(file));
      fileMap.set(file.path, validLines);
    });

    // Validate and filter suggestions
    const validated: InlineItem[] = [];
    for (const suggestion of parsed.slice(0, 25)) {
      if (!isValidSuggestion(suggestion)) continue;

      // Filter by score threshold (only high-priority findings)
      if (suggestion.score < 6) continue;

      const validLines = fileMap.get(suggestion.relevant_file);
      if (!validLines) continue;

      // Use the end line as the target (where comment will appear)
      const targetLine = suggestion.relevant_lines_end;
      if (!validLines.has(targetLine)) continue;

      // Format rich message
      const message = formatInlineComment(suggestion);
      validated.push({
        path: suggestion.relevant_file,
        to: targetLine,
        message
      });
    }

    return validated;
  } catch (e) {
    console.error("Failed to parse inline suggestions:", e);
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

