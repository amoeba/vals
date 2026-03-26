import { email } from "https://esm.town/v/std/email";
import { getLatestCommitDiff } from "./github.ts";
import { summarizeCommit } from "./summarize.ts";

// Configuration — all env vars are required
function requireEnv(name: string): string {
  const val = Deno.env.get(name);
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

const GITHUB_TOKEN = requireEnv("GITHUB_TOKEN");
const GITHUB_REPO = requireEnv("GITHUB_REPO");
const CLAUDE_MODEL = requireEnv("CLAUDE_MODEL");

async function sendCommitSummaryEmail(owner: string, repo: string) {
  const commit = await getLatestCommitDiff(GITHUB_TOKEN, owner, repo);
  const summary = await summarizeCommit(CLAUDE_MODEL, commit, owner, repo);
  const today = new Date().toLocaleDateString();

  await email({
    subject: `[${owner}/${repo}] Commit Summary — ${today}`,
    text: `${owner}/${repo} — Latest Commit Summary

Commit:  ${commit.sha.slice(0, 8)}
Author:  ${commit.author}
Date:    ${commit.date}
Message: ${commit.message}
Link:    https://github.com/${owner}/${repo}/commit/${commit.sha}

--- AI Summary ---

${summary}`,
  });

  return { commit: commit.sha.slice(0, 8), author: commit.author, summary };
}

export default async function(req: Request) {
  const [owner, repo] = GITHUB_REPO.split("/");
  if (!owner || !repo) {
    throw new Error(`GITHUB_REPO must be in "owner/repo" format, got: "${GITHUB_REPO}"`);
  }
  return Response.json(await sendCommitSummaryEmail(owner, repo));
}
