import { blob } from "https://esm.town/v/std/blob";
import { email } from "https://esm.town/v/std/email";

// Required environment variables:
//   CRAN_PACKAGES — comma-separated list of R package names to monitor, e.g. "arrow,dplyr,ggplot2"

const BLOB_KEY_PREFIX = "cran_package_history_";
const CRAN_BASE_URL = "https://cran.r-project.org/web/packages";

interface PageVersion {
  package: string;
  etag: string | null;
  datetime: string;
  html: string;
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
 * Generates a simple text diff between two HTML strings.
 * Shows lines that changed between versions.
 */
function generateSimpleDiff(oldHtml: string, newHtml: string): string {
  const oldLines = oldHtml.split("\n");
  const newLines = newHtml.split("\n");

  const changes: string[] = [];
  const maxLines = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i] || "";
    const newLine = newLines[i] || "";

    if (oldLine !== newLine) {
      if (oldLine && !newLine) {
        changes.push(`- ${oldLine.trim()}`);
      } else if (!oldLine && newLine) {
        changes.push(`+ ${newLine.trim()}`);
      } else {
        changes.push(`- ${oldLine.trim()}`);
        changes.push(`+ ${newLine.trim()}`);
      }
    }
  }

  // Limit diff output to avoid huge emails
  if (changes.length > 50) {
    return changes.slice(0, 50).join("\n") + `\n... (${changes.length - 50} more changes)`;
  }

  return changes.join("\n");
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
    datetime: new Date().toISOString(),
    html: current.html,
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

    const diffSection = change.htmlDiff
      ? `
      <details style="margin-top: 10px;">
        <summary style="cursor: pointer; font-weight: bold;">View HTML Diff</summary>
        <pre style="background-color: #f5f5f5; padding: 10px; overflow-x: auto; font-size: 12px;">${escapeHtml(change.htmlDiff)}</pre>
      </details>`
      : "";

    return `
      <div style="border: 1px solid #ddd; margin-bottom: 20px; padding: 15px; border-radius: 5px;">
        <h2>${statusEmoji} ${change.packageName}</h2>
        <p><strong>URL:</strong> <a href="${change.url}">${change.url}</a></p>
        <p><strong>Status:</strong> ${changeDescription}</p>
        <p><strong>Checked:</strong> ${change.currentVersion.datetime}</p>
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
