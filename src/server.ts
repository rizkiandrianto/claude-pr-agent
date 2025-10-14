import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import { verifyWebhookSignature, parseWorkspaceRepo } from "./utils.js";
import { getAccessToken, getPR, getPRDiff, postPRComment, postInlineComment, updatePRDescription } from "./bitbucket.js";
import { runClaudeDescribe, runClaudeReview, runClaudeInline } from "./claude.js";
import { RateLimiter } from "./retry.js";

const rateLimiter = new RateLimiter(3, 200); // Max 3 concurrent, 200ms between calls

const app = express();
// preserve raw body for signature verify
app.use(express.json({ verify: (req: any, _res, buf) => (req.rawBody = buf) }));

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.post("/webhook/bitbucket", async (req: Request & { rawBody?: Buffer }, res: Response) => {
  try {
    console.log("Webhook event received");

    const secret = process.env.WEBHOOK_SECRET;
    const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    if (!verifyWebhookSignature(req, raw, secret)) return res.status(401).json({ ok: false, error: "bad signature" });

    const event = req.header("X-Event-Key") || "";
    if (!event.startsWith("pullrequest:")) return res.json({ ok: true, skipped: event });

    const payload = req.body as any;
    const pr = payload.pullrequest || {};
    const repo = payload.repository || {};
    const prId = pr.id;
    if (!prId) return res.status(400).json({ ok: false, error: "no pr id" });

    const { workspace, repo_slug } = parseWorkspaceRepo(repo.full_name || "");
    if (!workspace || !repo_slug) return res.status(400).json({ ok: false, error: "no workspace/repo" });

    // Check query parameters for feature control (defaults to env vars)
    const enableDescribe = req.query.describe !== "false" && process.env.ENABLE_DESCRIBE === "1";
    const enableReview = req.query.review !== "false" && process.env.ENABLE_REVIEW === "1";
    const enableInline = req.query.inline !== "false" && process.env.ENABLE_INLINE === "1";

    // Send response immediately
    res.json({ ok: true, event, pr: prId, processing: "background" });

    // Process in background (don't await)
    (async () => {
      try {
        const token = await getAccessToken(process.env.BB_CLIENT_ID!, process.env.BB_CLIENT_SECRET!);
        console.log(token);

        // always fetch latest PR & diff
        const prObj = await getPR(token, workspace, repo_slug, prId) as { description?: string };
        const diffText = await getPRDiff(token, workspace, repo_slug, prId);

        const results: any = { event, pr: prId };

        // 1) Describe: append (idempotent-ish marker)
        if (enableDescribe) {
          const descAdd = await runClaudeDescribe(diffText);
          if (descAdd && !(prObj.description || "").includes("### 🤖 AI Summary")) {
            const clipped = descAdd.slice(0, Number(process.env.MAX_DESC_APPEND_CHARS || 2500));
            const newDesc = `${prObj.description || ""}\n\n### 🤖 AI Summary\n${clipped}`.trim();
            await updatePRDescription(token, workspace, repo_slug, prId, newDesc);
            results.describe = { appended: true };
          } else {
            results.describe = { appended: false };
          }
        }

        // 2) Review: post top-level
        if (enableReview) {
          const review = await runClaudeReview(diffText);
          if (review) {
            const created = await postPRComment(token, workspace, repo_slug, prId, review) as { id: string };
            results.review = { id: created.id };
          }
        }

        // 3) Inline: optional
        if (enableInline) {
          const inline = await runClaudeInline(diffText);
          const cap = Math.min(inline.length, Number(process.env.MAX_INLINE_COMMENTS || 10));
          const posted = [];
          console.log(`Posting ${cap} inline comments (high-signal findings only)...`);

          for (let i = 0; i < cap; i++) {
            const it = inline[i];
            try {
              // Use rate limiter to avoid overwhelming Bitbucket API
              const r = await rateLimiter.execute(() =>
                postInlineComment(token, workspace, repo_slug, prId, it.path, it.to, it.message)
              ) as { id: string };
              posted.push({ path: it.path, to: it.to, id: r.id });
            } catch (e: any) {
              console.error(`Failed to post inline comment at ${it.path}:${it.to}:`, e?.message || e);
              posted.push({ path: it.path, to: it.to, error: String(e?.message || e) });
            }
          }
          results.inline = { count: posted.length, items: posted };
        }

        console.log("Background processing complete:", results);
      } catch (e: any) {
        console.error("Background processing error:", String(e?.message || e));
      }
    })();

  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`bb-claude webhook listening on :${port}`));

