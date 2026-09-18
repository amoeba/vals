import { blob } from "https://esm.town/v/std/blob";
import { email } from "https://esm.town/v/std/email";

// Required environment variables:
//   CRAN_PACKAGES — comma-separated list of R package names to monitor, e.g. "arrow,dplyr,ggplot2"

const BLOB_KEY_PREFIX = "cran_package_history_";
const CRAN_BASE_URL = "https://cran.r-project.org/web/packages";

interface PageVersion {
  package: string;
  etag: string | null;
  lastModified: string | null;
  datetime: string;
  html: string;
  htmlLength: number;
}

interface PackageHistory {
  package: string;
  versions: PageVersion[];
}

interface CheckResult {
  packageName: string;
  url: string;
  changed: boolean;
  previousVersion: PageVersion | null;
  currentVersion: PageVersion;
  changeType: "new" | "etag_changed" | "etag_removed" | "no_change";
  htmlDiff?: string;
}

/**
 * Fetches the full HTML content of a package page.
 */
async function fetchPackagePage(packageName: string): Promise<{
  etag: string | null;
  lastModified: string | null;
  html: string;
  url: string;
}> {
  const url = `${CRAN_BASE_URL}/${packageName}/index.html`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
    );
  }

  const etag = response.headers.get("etag");
  const lastModified = response.headers.get("last-modified");
  const html = await response.text();

  return {
    etag,
    lastModified,
    html,
    url,
  };
}

/**
 * Generates a unified diff between two HTML strings.
 * Shows context around changes with proper diff formatting.
 */
function generateSimpleDiff(oldHtml: string, newHtml: string): string {
  const oldLines = oldHtml.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  const newLines = newHtml.split("\n").map(l => l.trim()).filter(l => l.length > 0);

  const changes: string[] = [];
  const contextLines = 2; // Lines of context to show around changes

  // Simple LCS-based diff
  const diffs = computeDiff(oldLines, newLines);

  let lastChangeIndex = -10;
  for (let i = 0; i < diffs.length; i++) {
    const diff = diffs[i];

    // Skip if it's unchanged and not near a change
    if (diff.type === "unchanged" && i - lastChangeIndex > contextLines + 1) {
      // Show ellipsis for skipped sections
      if (lastChangeIndex >= 0 && i - lastChangeIndex === contextLines + 2) {
        changes.push("...");
      }
      continue;
    }

    if (diff.type !== "unchanged") {
      lastChangeIndex = i;
    }

    switch (diff.type) {
      case "removed":
        changes.push(`- ${diff.line}`);
        break;
      case "added":
        changes.push(`+ ${diff.line}`);
        break;
      case "unchanged":
        changes.push(`  ${diff.line}`);
        break;
    }
  }

  // Limit diff output to avoid huge emails
  if (changes.length > 100) {
    return changes.slice(0, 100).join("\n") + `\n... (${changes.length - 100} more lines)`;
  }

  return changes.length > 0 ? changes.join("\n") : "No significant changes detected";
}

/**
 * Simple diff algorithm using longest common subsequence approach.
 */
function computeDiff(oldLines: string[], newLines: string[]): Array<{type: "added" | "removed" | "unchanged", line: string}> {
  const lcs = longestCommonSubsequence(oldLines, newLines);
  const result: Array<{type: "added" | "removed" | "unchanged", line: string}> = [];

  let oldIdx = 0;
  let newIdx = 0;
  let lcsIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (lcsIdx < lcs.length) {
      // Check if current old line matches LCS
      if (oldIdx < oldLines.length && oldLines[oldIdx] === lcs[lcsIdx]) {
        result.push({ type: "unchanged", line: oldLines[oldIdx] });
        oldIdx++;
        newIdx++;
        lcsIdx++;
        continue;
      }

      // Check if current new line matches LCS
      if (newIdx < newLines.length && newLines[newIdx] === lcs[lcsIdx]) {
        result.push({ type: "unchanged", line: newLines[newIdx] });
        oldIdx++;
        newIdx++;
        lcsIdx++;
        continue;
      }
    }

    // Handle removals and additions
    if (oldIdx < oldLines.length && (lcsIdx >= lcs.length || oldLines[oldIdx] !== lcs[lcsIdx])) {
      result.push({ type: "removed", line: oldLines[oldIdx] });
      oldIdx++;
    }

    if (newIdx < newLines.length && (lcsIdx >= lcs.length || newLines[newIdx] !== lcs[lcsIdx])) {
      result.push({ type: "added", line: newLines[newIdx] });
      newIdx++;
    }
  }

  return result;
}

/**
 * Computes longest common subsequence between two arrays of strings.
 */
function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));

  // Build LCS table
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Reconstruct LCS
  const lcs: string[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}

/**
 * Loads package history from blob storage.
 */
async function loadPackageHistory(packageName: string): Promise<PackageHistory> {
  const key = `${BLOB_KEY_PREFIX}${packageName}`;
  const history: PackageHistory | null = await blob.getJSON(key);

  if (!history) {
    return {
      package: packageName,
      versions: [],
    };
  }

  return history;
}

/**
 * Saves package history to blob storage.
 */
async function savePackageHistory(history: PackageHistory): Promise<void> {
  const key = `${BLOB_KEY_PREFIX}${history.package}`;
  await blob.setJSON(key, history);
}

/**
 * Compares current state with stored history and determines if a change occurred.
 */
function analyzeChange(
  packageName: string,
  url: string,
  history: PackageHistory,
  current: { etag: string | null; lastModified: string | null; html: string },
): CheckResult {
  const previousVersion = history.versions.length > 0
    ? history.versions[history.versions.length - 1]
    : null;

  const currentVersion: PageVersion = {
    package: packageName,
    etag: current.etag,
    lastModified: current.lastModified,
    datetime: new Date().toISOString(),
    html: current.html,
    htmlLength: current.html.length,
  };

  // Case 1: First time checking this package
  if (!previousVersion) {
    return {
      packageName,
      url,
      changed: true, // Always notify on first run
      previousVersion: null,
      currentVersion,
      changeType: "new",
    };
  }

  // Case 2: Previously had ETag, now doesn't
  if (previousVersion.etag !== null && current.etag === null) {
    return {
      packageName,
      url,
      changed: true,
      previousVersion,
      currentVersion,
      changeType: "etag_removed",
      htmlDiff: generateSimpleDiff(previousVersion.html, current.html),
    };
  }

  // Case 3: ETag changed
  if (previousVersion.etag !== current.etag) {
    return {
      packageName,
      url,
      changed: true,
      previousVersion,
      currentVersion,
      changeType: "etag_changed",
      htmlDiff: generateSimpleDiff(previousVersion.html, current.html),
    };
  }

  // Case 4: No change
  return {
    packageName,
    url,
    changed: false,
    previousVersion,
    currentVersion,
    changeType: "no_change",
  };
}

/**
 * Builds HTML email for package changes.
 */
function buildEmailHtml(changes: CheckResult[]): string {
  const today = new Date().toLocaleString();

  const sections = changes.map((change) => {
    let statusEmoji = "";
    let changeDescription = "";

    switch (change.changeType) {
      case "new":
        statusEmoji = "🆕";
        changeDescription = "New package being monitored";
        break;
      case "etag_changed":
        statusEmoji = "🔄";
        changeDescription = `ETag changed<br><small>Previous: ${change.previousVersion?.etag || "none"}<br>Current: ${change.currentVersion.etag || "none"}</small>`;
        break;
      case "etag_removed":
        statusEmoji = "⚠️";
        changeDescription = "ETag header removed from response";
        break;
    }

    // Build metadata section
    const metadataRows: string[] = [];

    if (change.previousVersion) {
      const sizeDiff = change.currentVersion.htmlLength - change.previousVersion.htmlLength;
      const sizeDiffStr = sizeDiff > 0 ? `+${sizeDiff}` : `${sizeDiff}`;
      const sizeDiffColor = sizeDiff > 0 ? "#28a745" : sizeDiff < 0 ? "#dc3545" : "#6c757d";

      metadataRows.push(`
        <tr>
          <td style="padding: 4px 8px; border-bottom: 1px solid #eee;"><strong>HTML Size:</strong></td>
          <td style="padding: 4px 8px; border-bottom: 1px solid #eee;">
            ${change.previousVersion.htmlLength.toLocaleString()} → ${change.currentVersion.htmlLength.toLocaleString()} bytes
            <span style="color: ${sizeDiffColor}; margin-left: 8px;">(${sizeDiffStr})</span>
          </td>
        </tr>
      `);
    } else {
      metadataRows.push(`
        <tr>
          <td style="padding: 4px 8px; border-bottom: 1px solid #eee;"><strong>HTML Size:</strong></td>
          <td style="padding: 4px 8px; border-bottom: 1px solid #eee;">${change.currentVersion.htmlLength.toLocaleString()} bytes</td>
        </tr>
      `);
    }

    if (change.currentVersion.lastModified) {
      metadataRows.push(`
        <tr>
          <td style="padding: 4px 8px; border-bottom: 1px solid #eee;"><strong>Last-Modified:</strong></td>
          <td style="padding: 4px 8px; border-bottom: 1px solid #eee;">${change.currentVersion.lastModified}</td>
        </tr>
      `);
    }

    if (change.previousVersion?.lastModified) {
      metadataRows.push(`
        <tr>
          <td style="padding: 4px 8px; border-bottom: 1px solid #eee;"><strong>Previous Last-Modified:</strong></td>
          <td style="padding: 4px 8px; border-bottom: 1px solid #eee;">${change.previousVersion.lastModified}</td>
        </tr>
      `);
    }

    metadataRows.push(`
      <tr>
        <td style="padding: 4px 8px; border-bottom: 1px solid #eee;"><strong>Check Time:</strong></td>
        <td style="padding: 4px 8px; border-bottom: 1px solid #eee;">${change.currentVersion.datetime}</td>
      </tr>
    `);

    if (change.previousVersion) {
      metadataRows.push(`
        <tr>
          <td style="padding: 4px 8px;"><strong>Previous Check:</strong></td>
          <td style="padding: 4px 8px;">${change.previousVersion.datetime}</td>
        </tr>
      `);
    }

    const metadataSection = `
      <table style="width: 100%; margin-top: 10px; border-collapse: collapse; font-size: 13px;">
        ${metadataRows.join("")}
      </table>
    `;

    const diffSection = change.htmlDiff
      ? `
      <div style="margin-top: 15px;">
        <h3 style="margin-bottom: 5px; font-size: 14px;">HTML Changes:</h3>
        <pre style="background-color: #f8f8f8; border: 1px solid #ddd; padding: 12px; overflow-x: auto; font-size: 11px; line-height: 1.4; font-family: 'Courier New', monospace; white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(change.htmlDiff)}</pre>
      </div>`
      : "";

    return `
      <div style="border: 1px solid #ddd; margin-bottom: 20px; padding: 15px; border-radius: 5px; background-color: #fefefe;">
        <h2 style="margin-top: 0;">${statusEmoji} ${change.packageName}</h2>
        <p><strong>URL:</strong> <a href="${change.url}">${change.url}</a></p>
        <p><strong>Status:</strong> ${changeDescription}</p>
        ${metadataSection}
        ${diffSection}
      </div>`;
  }).join("");

  return `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 900px; margin: 0 auto; padding: 20px;">
        <h1>CRAN Package Monitor — ${changes.length} ${changes.length === 1 ? "change" : "changes"} detected</h1>
        <p>Generated on: ${today}</p>
        ${sections}
        <footer style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
          <small>
            <a href="${import.meta.url.replace("esm.town", "val.town")}" target="_top">
              View Val Source
            </a>
          </small>
        </footer>
      </body>
    </html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export default async function (_interval: unknown): Promise<void> {
  const packagesEnv = Deno.env.get("CRAN_PACKAGES");

  if (!packagesEnv) {
    const errorMsg =
      "CRAN_PACKAGES environment variable is not set. Please configure it with a comma-separated list of R package names.";
    console.error(errorMsg);
    await email({
      subject: "CRAN Package Monitor — Configuration Error",
      text: errorMsg,
    });
    throw new Error(errorMsg);
  }

  const packages = packagesEnv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (packages.length === 0) {
    const errorMsg =
      "CRAN_PACKAGES environment variable is empty. Please configure it with a comma-separated list of R package names.";
    console.error(errorMsg);
    await email({
      subject: "CRAN Package Monitor — Configuration Error",
      text: errorMsg,
    });
    throw new Error(errorMsg);
  }

  console.log(`Monitoring ${packages.length} packages: ${packages.join(", ")}`);

  const results: CheckResult[] = [];

  // Check each package
  for (const packageName of packages) {
    try {
      const current = await fetchPackagePage(packageName);
      const history = await loadPackageHistory(packageName);

      const result = analyzeChange(
        packageName,
        current.url,
        history,
        current,
      );

      // Always store new version if changed
      if (result.changed) {
        history.versions.push(result.currentVersion);
        await savePackageHistory(history);
        results.push(result);
        console.log(`${packageName}: Change detected (${result.changeType})`);
      } else {
        console.log(`${packageName}: No change`);
      }
    } catch (error) {
      console.error(`Error checking ${packageName}:`, error);
    }
  }

  // Send email if there were changes
  if (results.length > 0) {
    await email({
      subject: `CRAN Package Monitor — ${results.length} ${
        results.length === 1 ? "change" : "changes"
      } detected`,
      html: buildEmailHtml(results),
    });
    console.log(
      `Email sent for ${results.length} ${
        results.length === 1 ? "change" : "changes"
      }`,
    );
  } else {
    console.log("No changes detected across all packages");
  }
}
