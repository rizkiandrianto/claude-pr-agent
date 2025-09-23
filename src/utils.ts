import crypto from "crypto";
import { Request } from "express";

export function verifyWebhookSignature(req: Request, bodyRaw: Buffer, secret?: string) {
  // Bitbucket’s webhook can sign with X-Hub-Signature: "sha256=<hex>"
  if (!secret) return true;
  const header = req.header("X-Hub-Signature");
  if (!header || !header.startsWith("sha256=")) return false;
  const provided = header.slice("sha256=".length).trim().toLowerCase();
  const expected = crypto.createHmac("sha256", secret).update(bodyRaw).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export function parseWorkspaceRepo(full_name: string) {
  const [workspace, repo_slug] = (full_name || "").split("/");
  return { workspace, repo_slug };
}

