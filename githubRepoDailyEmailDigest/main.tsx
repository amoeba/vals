import { email } from "https://esm.town/v/std/email";

// Configure which repositories to monitor
const REPOS: Repository[] = [
  { owner: "apache", repo: "arrow" },
  { owner: "apache", repo: "arrow-adbc" },
  { owner: "apache", repo: "arrow-go" },
  { owner: "apache", repo: "arrow-js" },
  { owner: "apache", repo: "arrow-dotnet" },
  // Add more repositories here:
  // { owner: "apache", repo: "arrow-adbc" },
];

// GitHub configuration and time setup
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN");
const today = new Date().toLocaleDateString();
const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

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
  activities: RepoActivity[];
  totalStats: {
    issues: { opened: number; updated: number; closed: number };
    prs: { opened: number; updated: number; closed: number };
  };
}

async function fetchRepoActivity(
  owner: string,
  repo: string,
  headers: Record<string, string>
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


  return {
    repository: { owner, repo },
    issues: categorizedIssues,
    prs: categorizedPRs,
  };
}

function formatActivityShorthand(opened: number, updated: number, closed: number): string {
  return `<div class="activity-grid">
    <span class="activity-item activity-opened">${opened > 0 ? `+${opened}` : '&nbsp;'}</span>
    <span class="activity-item activity-updated">${updated > 0 ? `~${updated}` : '&nbsp;'}</span>
    <span class="activity-item activity-closed">${closed > 0 ? `-${closed}` : '&nbsp;'}</span>
  </div>`;
}

function generateHtmlDigest(
  repos: Repository[],
  repoActivities: RepoActivity[],
  totalStats: { issues: { opened: number; updated: number; closed: number }; prs: { opened: number; updated: number; closed: number } }
): string {
  // Pre-calculate shorthand strings for each repo
  const repoShorthands = repoActivities.map(repoActivity => ({
    repo: repoActivity,
    issuesShorthand: formatActivityShorthand(
      repoActivity.issues.opened.length,
      repoActivity.issues.updated.length,
      repoActivity.issues.closed.length
    ),
    prsShorthand: formatActivityShorthand(
      repoActivity.prs.opened.length,
      repoActivity.prs.updated.length,
      repoActivity.prs.closed.length
    )
  }));

  // Pre-calculate total shorthand strings
  const totalIssuesShorthand = formatActivityShorthand(
    totalStats.issues.opened,
    totalStats.issues.updated,
    totalStats.issues.closed
  );
  const totalPrsShorthand = formatActivityShorthand(
    totalStats.prs.opened,
    totalStats.prs.updated,
    totalStats.prs.closed
  );

  return `
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; }
          table {
            width: auto;
            border-collapse: collapse;
            margin-bottom: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          }
          th, td {
            border: 1px solid #ddd;
            padding: 4px 8px;
            text-align: left;
          }
          th {
            background-color: #f4f4f4;
            font-weight: bold;
          }
          .opened { color: green; }
          .updated { color: orange; }
          .closed { color: red; }
          .activity-opened { color: green; font-weight: bold; }
          .activity-updated { color: #ff8800; font-weight: bold; }
          .activity-closed { color: red; font-weight: bold; }
          .activity-none { color: #999; }
          h4 { margin-top: 15px; margin-bottom: 8px; }
          a { color: #0366d6; text-decoration: underline; }
        </style>
      </head>
      <body>
        <h1>Daily GitHub Digest for ${repos.length} ${repos.length === 1 ? 'Repository' : 'Repositories'}</h1>
        <p>Generated on: ${today}</p>

        <h2>Summary</h2>
        <table>
          <thead>
            <tr>
              <th>Repo</th>
              <th>Issues</th>
              <th>PRs</th>
            </tr>
          </thead>
          <tbody>
            ${repoShorthands.map(({ repo, issuesShorthand, prsShorthand }) => `
              <tr>
                <td><strong><a href="https://github.com/${repo.repository.owner}/${repo.repository.repo}" target="_blank">${repo.repository.owner}/${repo.repository.repo}</a></strong></td>
                <td>${issuesShorthand}</td>
                <td>${prsShorthand}</td>
              </tr>
            `).join('')}
            <tr style="font-weight: bold;">
              <td><strong>Total</strong></td>
              <td><strong>${totalIssuesShorthand}</strong></td>
              <td><strong>${totalPrsShorthand}</strong></td>
            </tr>
          </tbody>
        </table>

        <p style="font-size: 0.9em; color: #666; margin-top: 10px;">
          <strong>Legend:</strong> +created ~updated -closed
        </p>

        ${repoActivities.map(repoActivity => {
    const hasIssues = repoActivity.issues.opened.length > 0 || repoActivity.issues.updated.length > 0 || repoActivity.issues.closed.length > 0;
    const hasPRs = repoActivity.prs.opened.length > 0 || repoActivity.prs.updated.length > 0 || repoActivity.prs.closed.length > 0;

    return `
            <h2><a href="https://github.com/${repoActivity.repository.owner}/${repoActivity.repository.repo}" target="_blank">${repoActivity.repository.owner}/${repoActivity.repository.repo}</a></h2>

            <h3>Issues</h3>
            ${hasIssues ? '' : '<p style="color: #666; font-style: italic;">No issue activity in the last 24 hours.</p>'}
            ${repoActivity.issues.opened.length > 0 ? `
              <h4><span class="activity-opened">Newly Opened</span> (${repoActivity.issues.opened.length})</h4>
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
              <h4><span class="activity-updated">Updated</span> (${repoActivity.issues.updated.length})</h4>
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
              <h4><span class="activity-closed">Closed</span> (${repoActivity.issues.closed.length})</h4>
              <ul>
                ${repoActivity.issues.closed.map(issue => `
                  <li>
                    <a href="${issue.html_url}">#${issue.number} ${issue.title}</a>
                    closed by ${issue.user.login}
                  </li>
                `).join('')}
              </ul>
            ` : ''}

            <h3>Pull Requests</h3>
            ${hasPRs ? '' : '<p style="color: #666; font-style: italic;">No pull request activity in the last 24 hours.</p>'}
            ${repoActivity.prs.opened.length > 0 ? `
              <h4><span class="activity-opened">Newly Opened</span> (${repoActivity.prs.opened.length})</h4>
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
              <h4><span class="activity-updated">Updated</span> (${repoActivity.prs.updated.length})</h4>
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
              <h4><span class="activity-closed">Closed</span> (${repoActivity.prs.closed.length})</h4>
              <ul>
                ${repoActivity.prs.closed.map(pr => `
                  <li>
                    <a href="${pr.html_url}">#${pr.number} ${pr.title}</a>
                    closed by ${pr.user.login}
                  </li>
                `).join('')}
              </ul>
            ` : ''}
          `;
  }).join('')}

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
}

export async function sendDailyEmail(
  repos: Repository[] = REPOS
): Promise<DigestResult> {
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
      headers
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

  // Generate HTML digest
  const htmlDigest = generateHtmlDigest(repos, repoActivities, totalStats);

  // Send email
  const repoNames = repos.length === 1
    ? `${repos[0].owner}/${repos[0].repo}`
    : `${repos.length} repositories`;

  await email({
    subject: `Daily GitHub Digest for ${repoNames} - ${today}`,
    html: htmlDigest,
  });

  return {
    activities: repoActivities,
    totalStats,
  };
}

/**
 * Cron function that runs automatically
 */
export default async function (interval: Interval) {
  await sendDailyEmail();
}

/**
 * Manual trigger function
 * Can be called directly to test
 */
export async function manualTrigger(
  repos: Repository[] = REPOS
) {
  const result = await sendDailyEmail(repos);
  console.log("Daily email sent successfully");
  console.log(`Total across ${result.activities.length} repositories:`);
  console.log(
    `Issues: ${result.totalStats.issues.opened} opened, ${result.totalStats.issues.updated} updated, ${result.totalStats.issues.closed} closed`
  );
  console.log(
    `PRs: ${result.totalStats.prs.opened} opened, ${result.totalStats.prs.updated} updated, ${result.totalStats.prs.closed} closed`
  );
  return result;
}
