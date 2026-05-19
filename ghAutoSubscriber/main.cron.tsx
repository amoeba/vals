import { email } from "https://esm.town/v/std/email";

// Required environment variables:
//   GITHUB_TOKEN  — personal access token with repo + notifications scopes
//   GITHUB_ORGS   — comma-separated list of org logins, e.g. "my-org,another-org"

function requireEnv(name: string): string {
  const val = Deno.env.get(name);
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

const GITHUB_TOKEN = requireEnv("GITHUB_TOKEN");
const GITHUB_ORGS = requireEnv("GITHUB_ORGS")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const BASE = "https://api.github.com";

function headers(): Record<string, string> {
  return {
    Authorization: `token ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github.v3+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

interface Repo {
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
}

/** Fetches all repos for an org, handling pagination. */
async function listOrgRepos(org: string): Promise<Repo[]> {
  const repos: Repo[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${BASE}/orgs/${org}/repos?per_page=100&page=${page}&type=all`,
      { headers: headers() },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to list repos for org "${org}": ${res.status} ${body}`);
    }
    const batch: Repo[] = await res.json();
    if (batch.length === 0) break;
    repos.push(...batch);
    page++;
  }
  return repos;
}

/**
 * Returns the set of repo full_names the authenticated user is watching.
 * Uses GET /user/subscriptions which returns all repos the user has explicitly
 * subscribed to OR is watching via org membership — unlike the per-repo
 * endpoint which returns 404 for implicit (org-level) subscriptions.
 */
async function fetchWatchedRepos(): Promise<Set<string>> {
  const watched = new Set<string>();
  let page = 1;
  while (true) {
    const res = await fetch(
      `${BASE}/user/subscriptions?per_page=100&page=${page}`,
      { headers: headers() },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to fetch watched repos: ${res.status} ${body}`);
    }
    const batch: { full_name: string }[] = await res.json();
    if (batch.length === 0) break;
    for (const r of batch) watched.add(r.full_name);
    page++;
  }
  return watched;
}

/** Subscribes the authenticated user to a repo. */
async function subscribe(fullName: string): Promise<void> {
  const res = await fetch(`${BASE}/repos/${fullName}/subscription`, {
    method: "PUT",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ subscribed: true, ignored: false }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to subscribe to "${fullName}": ${res.status} ${body}`);
  }
}

function buildEmailHtml(
  newSubs: { org: string; repo: Repo }[],
  orgs: string[],
): string {
  const today = new Date().toLocaleDateString();
  const byOrg: Record<string, Repo[]> = {};
  for (const { org, repo } of newSubs) {
    (byOrg[org] ??= []).push(repo);
  }

  const orgSections = Object.entries(byOrg)
    .map(([org, repos]) => `
      <h2>${org} (${repos.length})</h2>
      <ul>
        ${repos
          .map(
            (r) => `<li>
              <a href="${r.html_url}">${r.full_name}</a>${r.private ? " 🔒" : ""}
              ${r.description ? `<br><small>${r.description}</small>` : ""}
            </li>`,
          )
          .join("")}
      </ul>`)
    .join("");

  return `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h1>GitHub Auto-Subscriber — ${newSubs.length} new ${newSubs.length === 1 ? "subscription" : "subscriptions"}</h1>
        <p>Generated on: ${today}<br>
           Orgs monitored: ${orgs.join(", ")}</p>
        ${orgSections}
        <footer>
          <small>
            <a href="${import.meta.url.replace("esm.town", "val.town")}" target="_top">
              View Val Source
            </a>
          </small>
        </footer>
      </body>
    </html>`;
}

export default async function (_interval: unknown): Promise<void> {
  const newSubs: { org: string; repo: Repo }[] = [];
  const watched = await fetchWatchedRepos();

  for (const org of GITHUB_ORGS) {
    const repos = await listOrgRepos(org);

    for (const repo of repos) {
      if (watched.has(repo.full_name)) continue;
      await subscribe(repo.full_name);
      newSubs.push({ org, repo });
      console.log(`Subscribed to ${repo.full_name}`);
    }
  }

  console.log(
    `Done. Subscribed to ${newSubs.length} new ${newSubs.length === 1 ? "repo" : "repos"}.`,
  );

  if (newSubs.length === 0) return; // nothing to report

  await email({
    subject: `GitHub Auto-Subscriber — ${newSubs.length} new ${newSubs.length === 1 ? "subscription" : "subscriptions"}`,
    html: buildEmailHtml(newSubs, GITHUB_ORGS),
  });
}
