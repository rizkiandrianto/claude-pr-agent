import fetch from "node-fetch";
import { retryWithBackoff, isRetryableError } from "./retry.js";

const API = "https://api.bitbucket.org/2.0";

export async function getAccessToken(clientId: string, clientSecret: string) {
  // OAuth2 client_credentials ➜ bearer token
  // POST https://bitbucket.org/site/oauth2/access_token
  const res = await fetch("https://bitbucket.org/site/oauth2/access_token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ grant_type: "client_credentials" })
  });
  if (!res.ok) throw new Error(`Token error: ${res.status} ${await res.text()}`);
  const json = await res.json() as { access_token: string; expires_in: number };
  return json.access_token;
}

export async function getPR(token: string, workspace: string, repo: string, prId: number) {
  const res = await fetch(`${API}/repositories/${workspace}/${repo}/pullrequests/${prId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`getPR: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function getPRDiff(token: string, workspace: string, repo: string, prId: number) {
  const res = await fetch(`${API}/repositories/${workspace}/${repo}/pullrequests/${prId}/diff`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`getDiff: ${res.status} ${await res.text()}`);
  return res.text();
}

export async function updatePRDescription(token: string, workspace: string, repo: string, prId: number, description: string) {
  const res = await fetch(`${API}/repositories/${workspace}/${repo}/pullrequests/${prId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ description })
  });
  if (!res.ok) throw new Error(`updatePRDescription: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function postPRComment(token: string, workspace: string, repo: string, prId: number, text: string) {
  const res = await fetch(`${API}/repositories/${workspace}/${repo}/pullrequests/${prId}/comments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content: { raw: text } })
  });
  if (!res.ok) throw new Error(`postPRComment: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function postInlineComment(
  token: string, workspace: string, repo: string, prId: number, path: string, toLine: number, text: string
) {
  return retryWithBackoff(async () => {
    const res = await fetch(`${API}/repositories/${workspace}/${repo}/pullrequests/${prId}/comments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: { raw: text }, inline: { path, to: toLine } })
    });
    if (!res.ok) {
      const errorText = await res.text();
      const error: any = new Error(`postInlineComment: ${res.status} ${errorText}`);
      error.status = res.status;
      throw error;
    }
    return res.json();
  }, {
    maxRetries: 3,
    retryableErrors: isRetryableError
  });
}

