import Anthropic from "npm:@anthropic-ai/sdk";
import type { CommitInfo } from "./github.ts";

const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
console.log(`[debug] ANTHROPIC_API_KEY: ${apiKey ? `${apiKey.slice(0, 10)}...${apiKey.slice(-4)} (len=${apiKey.length})` : "NOT SET"}`);
const client = new Anthropic();

export async function summarizeCommit(
  model: string,
  commit: CommitInfo,
  owner: string,
  repo: string,
): Promise<string> {
  const message = await client.messages.create({
    model,
    max_tokens: 1024,
    messages: [{
      role: "user",
      content:
        `Summarize this git commit from ${owner}/${repo} in a few concise paragraphs.
Focus on: what changed, why it likely changed, and any notable implications.

Commit: ${commit.sha.slice(0, 8)}
Author: ${commit.author}
Date: ${commit.date}
Message: ${commit.message}

Diff:
${commit.diff}`,
    }],
  });

  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
