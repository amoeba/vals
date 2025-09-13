import { email } from "https://esm.town/v/std/email";

interface Repository {
  owner: string;
  repo: string;
}

interface RepoActivity {
  repository: Repository;
  issues: {
    opened: any[];
    updated: any[];
    closed: any[];
  };
  prs: {
    opened: any[];
    updated: any[];
    closed: any[];
  };
}

interface DigestResult {
  repos: RepoActivity[];
  totalStats: {
    issues: { opened: number; updated: number; closed: number };
    prs: { opened: number; updated: number; closed: number };
  };
}

async function fetchRepoActivity(
  owner: string,
  repo: string,
  headers: Record<string, string>,
  twentyFourHoursAgo: string
): Promise<RepoActivity> {

  // Fetch issues
  const issuesResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues?since=${twentyFourHoursAgo}&state=all`,
    { headers },
  );
  const issues = await issuesResponse.json();
  // Fetch PRs
  const prsResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&since=${twentyFourHoursAgo}`,
    { headers },
  );
  const prs = await prsResponse.json();

  const categorizedIssues = {
    opened: issues.filter(issue => !issue.pull_request && new Date(issue.created_at) > new Date(twentyFourHoursAgo)),
    updated: issues.filter(issue =>
      !issue.pull_request
      && issue.updated_at !== issue.created_at
      && new Date(issue.updated_at) > new Date(twentyFourHoursAgo)
    ),
    closed: issues.filter(issue =>
      !issue.pull_request
      && issue.state === "closed"
      && new Date(issue.closed_at) > new Date(twentyFourHoursAgo)
    ),
  };

  const categorizedPRs = {
    opened: prs.filter(pr => new Date(pr.created_at) > new Date(twentyFourHoursAgo)),
    updated: prs.filter(pr =>
      pr.updated_at !== pr.created_at
      && new Date(pr.updated_at) > new Date(twentyFourHoursAgo)
    ),
    closed: prs.filter(pr =>
      pr.state === "closed"
      && new Date(pr.closed_at) > new Date(twentyFourHoursAgo)
    ),
  };

  const htmlDigest = `
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          }
          th, td {
            border: 1px solid #ddd;
            padding: 12px;
            text-align: left;
          }
          th {
            background-color: #f4f4f4;
            font-weight: bold;
          }
          .opened { color: green; }
          .updated { color: orange; }
          .closed { color: red; }
        </style>
      </head>
      <body>
        <h1>Daily GitHub Digest for ${repos.length} Repository${repos.length > 1 ? 'ies' : ''}</h1>
        <p>Generated on: ${today}</p>

        <h2>Summary</h2>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th class="opened">Opened</th>
              <th class="updated">Updated</th>
              <th class="closed">Closed</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Issues</td>
              <td class="opened">${totalStats.issues.opened}</td>
              <td class="updated">${totalStats.issues.updated}</td>
              <td class="closed">${totalStats.issues.closed}</td>
              <td>${totalStats.issues.opened + totalStats.issues.updated + totalStats.issues.closed}</td>
            </tr>
            <tr>
              <td>Pull Requests</td>
              <td class="opened">${totalStats.prs.opened}</td>
              <td class="updated">${totalStats.prs.updated}</td>
              <td class="closed">${totalStats.prs.closed}</td>
              <td>${totalStats.prs.opened + totalStats.prs.updated + totalStats.prs.closed}</td>
            </tr>
            <tr>
              <td><strong>Total</strong></td>
              <td class="opened"><strong>${totalStats.issues.opened + totalStats.prs.opened}</strong></td>
              <td class="updated"><strong>${totalStats.issues.updated + totalStats.prs.updated}</strong></td>
              <td class="closed"><strong>${totalStats.issues.closed + totalStats.prs.closed}</strong></td>
              <td><strong>${totalStats.issues.opened + totalStats.issues.updated + totalStats.issues.closed + totalStats.prs.opened + totalStats.prs.updated + totalStats.prs.closed}</strong></td>
            </tr>
          </tbody>
        </table>

        <h2>Repository Details</h2>
        ${repoActivities.map(repoActivity => `
          <h3>${repoActivity.repository.owner}/${repoActivity.repository.repo}</h3>
          <table style="margin-bottom: 30px;">
            <thead>
              <tr>
                <th>Type</th>
                <th class="opened">Opened</th>
                <th class="updated">Updated</th>
                <th class="closed">Closed</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Issues</td>
                <td class="opened">${repoActivity.issues.opened.length}</td>
                <td class="updated">${repoActivity.issues.updated.length}</td>
                <td class="closed">${repoActivity.issues.closed.length}</td>
                <td>${repoActivity.issues.opened.length + repoActivity.issues.updated.length + repoActivity.issues.closed.length}</td>
              </tr>
              <tr>
                <td>Pull Requests</td>
                <td class="opened">${repoActivity.prs.opened.length}</td>
                <td class="updated">${repoActivity.prs.updated.length}</td>
                <td class="closed">${repoActivity.prs.closed.length}</td>
                <td>${repoActivity.prs.opened.length + repoActivity.prs.updated.length + repoActivity.prs.closed.length}</td>
              </tr>
            </tbody>
          </table>
        `).join('')}

        ${repoActivities.filter(repo =>
    repo.issues.opened.length > 0 || repo.issues.updated.length > 0 || repo.issues.closed.length > 0 ||
    repo.prs.opened.length > 0 || repo.prs.updated.length > 0 || repo.prs.closed.length > 0
  ).map(repoActivity => `
          <h2>${repoActivity.repository.owner}/${repoActivity.repository.repo} - Detailed Activity</h2>

          ${repoActivity.issues.opened.length > 0 ? `
            <h3>Newly Opened Issues (${repoActivity.issues.opened.length})</h3>
            <ul>
              ${repoActivity.issues.opened.map(issue => `
                <li>
                  <a href="${issue.html_url}">#${issue.number} ${issue.title}</a>
                  by ${issue.user.login}
                </li>
              `).join('')}
            </ul>
          ` : ''}

          ${repoActivity.issues.updated.length > 0 ? `
            <h3>Updated Issues (${repoActivity.issues.updated.length})</h3>
            <ul>
              ${repoActivity.issues.updated.map(issue => `
                <li>
                  <a href="${issue.html_url}">#${issue.number} ${issue.title}</a>
                  last updated by ${issue.user.login}
                </li>
              `).join('')}
            </ul>
          ` : ''}

          ${repoActivity.issues.closed.length > 0 ? `
            <h3>Closed Issues (${repoActivity.issues.closed.length})</h3>
            <ul>
              ${repoActivity.issues.closed.map(issue => `
                <li>
                  <a href="${issue.html_url}">#${issue.number} ${issue.title}</a>
                  closed by ${issue.user.login}
                </li>
              `).join('')}
            </ul>
          ` : ''}

          ${repoActivity.prs.opened.length > 0 ? `
            <h3>Newly Opened PRs (${repoActivity.prs.opened.length})</h3>
            <ul>
              ${repoActivity.prs.opened.map(pr => `
                <li>
                  <a href="${pr.html_url}">#${pr.number} ${pr.title}</a>
                  by ${pr.user.login}
                </li>
              `).join('')}
            </ul>
          ` : ''}

          ${repoActivity.prs.updated.length > 0 ? `
            <h3>Updated PRs (${repoActivity.prs.updated.length})</h3>
            <ul>
              ${repoActivity.prs.updated.map(pr => `
                <li>
                  <a href="${pr.html_url}">#${pr.number} ${pr.title}</a>
                  last updated by ${pr.user.login}
                </li>
              `).join('')}
            </ul>
          ` : ''}

          ${repoActivity.prs.closed.length > 0 ? `
            <h3>Closed PRs (${repoActivity.prs.closed.length})</h3>
            <ul>
              ${repoActivity.prs.closed.map(pr => `
                <li>
                  <a href="${pr.html_url}">#${pr.number} ${pr.title}</a>
                  closed by ${pr.user.login}
                </li>
              `).join('')}
            </ul>
          ` : ''}
        `).join('')}

        <footer>
          <small>
            <a href="${import.meta.url.replace("esm.town", "val.town")}" target="_top">
              View Val Source
            </a>
          </small>
        </footer>
      </body>
    </html>
  `;

  const repoNames = repos.length === 1
    ? `${repos[0].owner}/${repos[0].repo}`
    : `${repos.length} repositories`;

  await email({
    subject: `Daily GitHub Digest for ${repoNames} - ${today}`,
    html: htmlDigest,
  });

  return {
    repos: repoActivities,
    totalStats,
  };

  return {
    repository: { owner, repo },
    issues: categorizedIssues,
    prs: categorizedPRs,
  };
}

export async function sendDailyEmail(
  repos: Repository[] = [{ owner: "apache", repo: "arrow" }]
): Promise<DigestResult> {
  const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN");
  const today = new Date().toLocaleDateString();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const headers = {
    "Authorization": `token ${GITHUB_TOKEN}`,
    "Accept": "application/vnd.github.v3+json",
  };

  // Fetch activity for all repos
  const repoActivities: RepoActivity[] = [];
  for (const repository of repos) {
    const activity = await fetchRepoActivity(
      repository.owner,
      repository.repo,
      headers,
      twentyFourHoursAgo
    );
    repoActivities.push(activity);
  }

  // Calculate total stats across all repos
  const totalStats = repoActivities.reduce(
    (acc, repo) => {
      acc.issues.opened += repo.issues.opened.length;
      acc.issues.updated += repo.issues.updated.length;
      acc.issues.closed += repo.issues.closed.length;
      acc.prs.opened += repo.prs.opened.length;
      acc.prs.updated += repo.prs.updated.length;
      acc.prs.closed += repo.prs.closed.length;
      return acc;
    },
    {
      issues: { opened: 0, updated: 0, closed: 0 },
      prs: { opened: 0, updated: 0, closed: 0 },
    }
  );
}

/**
 * Cron function that runs automatically
 */
export default async function (interval: Interval) {
  await sendDailyEmail([
    { owner: "apache", repo: "arrow" }
  ]);
}

/**
 * Manual trigger function
 * Can be called directly to test
 */
export async function manualTrigger(
  repos: Repository[] = [{ owner: "apache", repo: "arrow" }, { owner: "apache", repo: "arrow-adbc" }]
) {
  const result = await sendDailyEmail(repos);
  console.log("Daily email sent successfully");
  console.log(`Total across ${result.repos.length} repositories:`);
  console.log(
    `Issues: ${result.totalStats.issues.opened} opened, ${result.totalStats.issues.updated} updated, ${result.totalStats.issues.closed} closed`
  );
  console.log(
    `PRs: ${result.totalStats.prs.opened} opened, ${result.totalStats.prs.updated} updated, ${result.totalStats.prs.closed} closed`
  );
  return result;
}
