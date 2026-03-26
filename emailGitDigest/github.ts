export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  date: string;
  diff: string;
}

export async function getLatestCommitDiff(
  token: string,
  owner: string,
  repo: string,
): Promise<CommitInfo> {
  console.log(`[debug] owner=${owner} repo=${repo}`);
  console.log(`[debug] GITHUB_TOKEN: ${token.slice(0, 6)}...${token.slice(-4)} (len=${token.length})`);

  const headers: Record<string, string> = {
    "Accept": "application/vnd.github.v3+json",
    "Authorization": `Bearer ${token}`,
  };

  // Get the latest commit
  const url = `https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`;
  console.log(`[debug] Fetching: ${url}`);
  const commitsRes = await fetch(url, { headers });
  console.log(`[debug] Response status: ${commitsRes.status}`);
  console.log(`[debug] Rate limit remaining: ${commitsRes.headers.get("x-ratelimit-remaining")}`);
  console.log(`[debug] Rate limit reset: ${commitsRes.headers.get("x-ratelimit-reset")}`);
  if (!commitsRes.ok) {
    const body = await commitsRes.text();
    console.log(`[debug] Response body: ${body}`);
    throw new Error(
      `GitHub API error fetching commits: ${commitsRes.status} ${body}`,
    );
  }
  const commits = await commitsRes.json();
  if (!Array.isArray(commits) || commits.length === 0) {
    throw new Error(`No commits found for ${owner}/${repo}`);
  }
  const latest = commits[0];

  // Get the diff
  const commitRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${latest.sha}`,
    { headers: { ...headers, "Accept": "application/vnd.github.v3.diff" } },
  );
  if (!commitRes.ok) {
    throw new Error(
      `GitHub API error fetching diff: ${commitRes.status} ${await commitRes
        .text()}`,
    );
  }
  const diff = await commitRes.text();

  const maxDiffLength = 1_000;
  const truncatedDiff = diff.length > maxDiffLength
    ? diff.slice(0, maxDiffLength) + "\n\n... [diff truncated] ..."
    : diff;

  return {
    sha: latest.sha,
    message: latest.commit.message,
    author: latest.commit.author.name,
    date: latest.commit.author.date,
    diff: truncatedDiff,
  };
}
