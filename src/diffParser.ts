/**
 * Parses unified diff format and extracts structured information
 * about file changes, hunks, and line numbers.
 */

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: string[];
}

export interface ParsedFile {
  path: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export interface ParsedDiff {
  files: ParsedFile[];
  totalAdditions: number;
  totalDeletions: number;
}

/**
 * Parse unified diff text into structured format
 */
export function parseDiff(diffText: string): ParsedDiff {
  const files: ParsedFile[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  const lines = diffText.split("\n");
  let currentFile: ParsedFile | null = null;
  let currentHunk: DiffHunk | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // New file: diff --git a/path b/path
    if (line.startsWith("diff --git")) {
      if (currentFile && currentHunk) {
        currentFile.hunks.push(currentHunk);
        currentHunk = null;
      }
      if (currentFile) {
        files.push(currentFile);
      }

      // Extract path from "diff --git a/path b/path"
      const match = line.match(/diff --git a\/(.+?) b\/(.+)/);
      const path = match ? match[2] : "";

      currentFile = {
        path,
        hunks: [],
        additions: 0,
        deletions: 0
      };
      continue;
    }

    // Hunk header: @@ -oldStart,oldLines +newStart,newLines @@
    if (line.startsWith("@@")) {
      if (currentFile && currentHunk) {
        currentFile.hunks.push(currentHunk);
      }

      const hunkMatch = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/);
      if (hunkMatch) {
        currentHunk = {
          oldStart: parseInt(hunkMatch[1], 10),
          oldLines: parseInt(hunkMatch[2] || "1", 10),
          newStart: parseInt(hunkMatch[3], 10),
          newLines: parseInt(hunkMatch[4] || "1", 10),
          header: hunkMatch[5]?.trim() || "",
          lines: []
        };
      }
      continue;
    }

    // Hunk content lines
    if (currentHunk && currentFile) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        currentFile.additions++;
        totalAdditions++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        currentFile.deletions++;
        totalDeletions++;
      }
      currentHunk.lines.push(line);
    }
  }

  // Push last hunk and file
  if (currentFile && currentHunk) {
    currentFile.hunks.push(currentHunk);
  }
  if (currentFile) {
    files.push(currentFile);
  }

  return {
    files,
    totalAdditions,
    totalDeletions
  };
}

/**
 * Get the new (destination) line numbers for added/modified lines in a file
 */
export function getModifiedLineNumbers(file: ParsedFile): number[] {
  const modifiedLines: number[] = [];

  for (const hunk of file.hunks) {
    let newLineNum = hunk.newStart;

    for (const line of hunk.lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        modifiedLines.push(newLineNum);
        newLineNum++;
      } else if (!line.startsWith("-")) {
        // Context line or unchanged
        newLineNum++;
      }
      // Deleted lines (starting with -) don't increment new line number
    }
  }

  return modifiedLines;
}

/**
 * Extract a specific line range from a hunk
 */
export function extractLineContext(file: ParsedFile, targetLine: number, contextLines = 3): {
  beforeContext: string[];
  targetContext: string[];
  afterContext: string[];
} | null {
  for (const hunk of file.hunks) {
    let newLineNum = hunk.newStart;
    const lineMap: Array<{ lineNum: number; content: string }> = [];

    for (const line of hunk.lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        lineMap.push({ lineNum: newLineNum, content: line.substring(1) });
        newLineNum++;
      } else if (!line.startsWith("-")) {
        lineMap.push({ lineNum: newLineNum, content: line.substring(1) });
        newLineNum++;
      }
    }

    // Find target line
    const targetIdx = lineMap.findIndex(l => l.lineNum === targetLine);
    if (targetIdx === -1) continue;

    const beforeStart = Math.max(0, targetIdx - contextLines);
    const afterEnd = Math.min(lineMap.length, targetIdx + contextLines + 1);

    return {
      beforeContext: lineMap.slice(beforeStart, targetIdx).map(l => l.content),
      targetContext: [lineMap[targetIdx].content],
      afterContext: lineMap.slice(targetIdx + 1, afterEnd).map(l => l.content)
    };
  }

  return null;
}

/**
 * Convert a unified diff into a formatted string with explicit line numbers.
 * Similar to pr-agent's decouple_and_convert_to_hunks_with_lines_numbers.
 *
 * This makes it much easier for LLMs to understand the diff and provide
 * accurate line-number-based suggestions.
 *
 * Example output:
 * ## File: 'src/file.ts'
 *
 * @@ -10,5 +10,6 @@ function example
 * __new hunk__
 * 10  function example() {
 * 11    console.log("hello");
 * 12 +  const x = 1;
 * 13    return true;
 * 14  }
 * __old hunk__
 *  function example() {
 *    console.log("hello");
 * -  return true;
 *  }
 */
export function formatDiffWithLineNumbers(diff: string): string {
  const parsedDiff = parseDiff(diff);
  const sections: string[] = [];

  for (const file of parsedDiff.files) {
    sections.push(`\n## File: '${file.path}'\n`);

    for (const hunk of file.hunks) {
      const newContentLines: Array<{ lineNum: number; content: string }> = [];
      const oldContentLines: string[] = [];
      let newLineNum = hunk.newStart;

      // Build the hunk header
      const hunkHeader = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@${hunk.header ? ' ' + hunk.header : ''}`;

      // Process each line in the hunk
      for (const line of hunk.lines) {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          // Added line
          newContentLines.push({ lineNum: newLineNum, content: line });
          newLineNum++;
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          // Deleted line
          oldContentLines.push(line);
        } else if (!line.startsWith("---") && !line.startsWith("+++")) {
          // Context line (unchanged)
          newContentLines.push({ lineNum: newLineNum, content: line });
          oldContentLines.push(line);
          newLineNum++;
        }
      }

      // Only add the hunk if it has additions or deletions
      const hasAdditions = newContentLines.some(l => l.content.startsWith("+"));
      const hasDeletions = oldContentLines.some(l => l.startsWith("-"));

      if (hasAdditions || hasDeletions) {
        sections.push(`\n${hunkHeader}`);

        // Add __new hunk__ section
        if (hasAdditions || hasDeletions) {
          sections.push('__new hunk__');
          for (const { lineNum, content } of newContentLines) {
            sections.push(`${lineNum} ${content}`);
          }
        }

        // Add __old hunk__ section if there are deletions
        if (hasDeletions) {
          sections.push('__old hunk__');
          for (const content of oldContentLines) {
            sections.push(content);
          }
        }
      }
    }
  }

  return sections.join('\n').trim();
}
