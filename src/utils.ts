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

export function parseClaudeArray(input: unknown): any[] {
  // 0) Sudah array?
  if (Array.isArray(input)) return input;

  if (typeof input !== "string") {
    throw new Error("Input is neither array nor string");
  }

  let s = input.trim();

  // 1) buang code fences / kutip pembungkus
  //    contoh: '```json\n[ ... ]\n```'
  s = s.replace(/^['"]?```json\s*/i, "");
  s = s.replace(/^['"]?```\s*/i, "");
  s = s.replace(/```['"]?$/i, "");
  s = s.replace(/^['"]|['"]$/g, ""); // kalau dibungkus single/double quote

  // 2) cek apakah string-escaped (banyak \n, \")
  const looksEscaped = /\\n|\\t|\\"|\\\\/.test(s);
  if (looksEscaped) {
    try {
      // decode escape sequences
      // Trik: bungkus ke dalam quotes lalu JSON.parse untuk unescape aman
      s = JSON.parse(`"${s.replace(/"/g, '\\"')}"`);
    } catch {
      // kalau gagal, lanjut tanpa unescape
    }
  }

  // 3) kalau seluruh s bukan JSON, coba ekstrak potongan [ ... ] yang paling valid
  //    cari index '[' pertama dan lakukan bracket matching
  const left = s.indexOf("[");
  const right = s.lastIndexOf("]");
  if (left !== -1 && right !== -1 && right > left) {
    let candidate = s.slice(left, right + 1).trim();

    // 3a) coba parse langsung
    try {
      const arr = JSON.parse(candidate);
      if (Array.isArray(arr)) return arr;
    } catch {
      // 3b) fallback: normalisasi single quote -> double quote dengan aman
      //     (sangat hati-hati: hanya kalau jelas JSON-like single-quoted)
      const looksSingleQuotedJson =
        /^[\[\{][\s\S]*['"][\s\S]*[\}\]]$/.test(candidate) &&
        !/":\s*'|'",\s*"/.test(candidate); // kasar, menghindari pecah kolom

      if (looksSingleQuotedJson) {
        const safe = candidate
          // ganti key 'key': -> "key":
          .replace(/'([A-Za-z0-9_]+)'\s*:/g, '"$1":')
          // ganti value: : 'text' -> : "text"
          .replace(/:\s*'([^']*)'/g, ': "$1"')
          // ganti sisa kutip tunggal yang jelas dalam array of strings
          .replace(/'\s*,/g, '",')
          .replace(/,\s*'/g, ',"')
          .replace(/^\[\s*'/, '["')
          .replace(/'\s*\]$/, '"]');

        try {
          const arr2 = JSON.parse(safe);
          if (Array.isArray(arr2)) return arr2;
        } catch {
          // continue
        }
      }
    }
  }

  // 4) last attempt: langsung parse seluruh string (kalau ternyata udah bersih)
  try {
    const maybe = JSON.parse(s);
    if (Array.isArray(maybe)) return maybe;
  } catch {}

  throw new Error("Failed to parse a valid JSON array from the given input");
}
