import { blob } from "https://esm.town/v/std/blob";
import { email } from "https://esm.town/v/std/email";

// Required environment variables:
//   CRAN_PACKAGES — comma-separated list of R package names to monitor, e.g. "arrow,dplyr,ggplot2"

const BLOB_KEY = "cran_package_etags";
const CRAN_BASE_URL = "https://cran.r-project.org/web/packages";

interface PackageETag {
  packageName: string;
  url: string;
  etag: string | null;
  lastModified: string | null;
}

interface CheckResult {
  packageName: string;
  url: string;
  changed: boolean;
  previousETag: string | null;
  currentETag: string | null;
  currentLastModified: string | null;
  changeType: "new" | "etag_changed" | "etag_removed" | "no_change";
}

/**
 * Performs a HEAD request to get ETag and Last-Modified headers.
 */
async function checkPackagePage(packageName: string): Promise<{
  etag: string | null;
  lastModified: string | null;
  url: string;
}> {
  const url = `${CRAN_BASE_URL}/${packageName}/index.html`;

  const response = await fetch(url, { method: "HEAD" });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
    );
  }

  const etag = response.headers.get("etag");
  const lastModified = response.headers.get("last-modified");

  return {
    etag,
    lastModified,
    url,
  };
}

/**
 * Compares current state with stored state and determines if a change occurred.
 */
function analyzeChange(
  packageName: string,
  url: string,
  stored: PackageETag | undefined,
  current: { etag: string | null; lastModified: string | null },
): CheckResult {
  // Case 1: First time checking this package
  if (!stored) {
    return {
      packageName,
      url,
      changed: current.etag !== null, // Only notify if there's an ETag to store
      previousETag: null,
      currentETag: current.etag,
      currentLastModified: current.lastModified,
      changeType: "new",
    };
  }

  // Case 2: Previously had ETag, now doesn't
  if (stored.etag !== null && current.etag === null) {
    return {
      packageName,
      url,
      changed: true,
      previousETag: stored.etag,
      currentETag: null,
      currentLastModified: current.lastModified,
      changeType: "etag_removed",
    };
  }

  // Case 3: ETag changed
  if (stored.etag !== current.etag) {
    return {
      packageName,
      url,
      changed: true,
      previousETag: stored.etag,
      currentETag: current.etag,
      currentLastModified: current.lastModified,
      changeType: "etag_changed",
    };
  }

  // Case 4: No change
  return {
    packageName,
    url,
    changed: false,
    previousETag: stored.etag,
    currentETag: current.etag,
    currentLastModified: current.lastModified,
    changeType: "no_change",
  };
}

/**
 * Builds HTML email for package changes.
 */
function buildEmailHtml(changes: CheckResult[]): string {
  const today = new Date().toLocaleString();

  const rows = changes.map((change) => {
    let statusEmoji = "";
    let changeDescription = "";

    switch (change.changeType) {
      case "new":
        statusEmoji = "🆕";
        changeDescription = "New package being monitored";
        break;
      case "etag_changed":
        statusEmoji = "🔄";
        changeDescription = `ETag changed<br><small>Previous: ${change.previousETag || "none"}<br>Current: ${change.currentETag || "none"}</small>`;
        break;
      case "etag_removed":
        statusEmoji = "⚠️";
        changeDescription = "ETag header removed from response";
        break;
    }

    return `
      <tr>
        <td>${statusEmoji}</td>
        <td><strong>${change.packageName}</strong></td>
        <td><a href="${change.url}">${change.url}</a></td>
        <td>${changeDescription}</td>
        <td><small>${change.currentLastModified || "N/A"}</small></td>
      </tr>`;
  }).join("");

  return `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h1>CRAN Package Monitor — ${changes.length} ${changes.length === 1 ? "change" : "changes"} detected</h1>
        <p>Generated on: ${today}</p>
        <table style="border-collapse: collapse; width: 100%;">
          <thead>
            <tr style="background-color: #f0f0f0;">
              <th style="padding: 8px; text-align: left; border: 1px solid #ddd;"></th>
              <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Package</th>
              <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">URL</th>
              <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Change</th>
              <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Last-Modified</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
        <footer style="margin-top: 20px;">
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
  const packagesEnv = Deno.env.get("CRAN_PACKAGES");

  if (!packagesEnv) {
    const errorMsg = "CRAN_PACKAGES environment variable is not set. Please configure it with a comma-separated list of R package names.";
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
    const errorMsg = "CRAN_PACKAGES environment variable is empty. Please configure it with a comma-separated list of R package names.";
    console.error(errorMsg);
    await email({
      subject: "CRAN Package Monitor — Configuration Error",
      text: errorMsg,
    });
    throw new Error(errorMsg);
  }

  console.log(`Monitoring ${packages.length} packages: ${packages.join(", ")}`);

  // Load stored ETags from blob storage
  const storedData: Record<string, PackageETag> =
    (await blob.getJSON(BLOB_KEY)) || {};

  const results: CheckResult[] = [];
  const updatedData: Record<string, PackageETag> = {};

  // Check each package
  for (const packageName of packages) {
    try {
      const current = await checkPackagePage(packageName);
      const stored = storedData[packageName];

      const result = analyzeChange(packageName, current.url, stored, current);

      // Store updated state (even if ETag is null, we clear the entry)
      if (current.etag === null && stored?.etag !== null) {
        // ETag was removed - don't store anything for this package
        console.log(`${packageName}: ETag removed, clearing database entry`);
      } else if (current.etag !== null) {
        // Store the new ETag
        updatedData[packageName] = {
          packageName,
          url: current.url,
          etag: current.etag,
          lastModified: current.lastModified,
        };
      }

      if (result.changed) {
        results.push(result);
        console.log(`${packageName}: Change detected (${result.changeType})`);
      } else {
        console.log(`${packageName}: No change`);
      }
    } catch (error) {
      console.error(`Error checking ${packageName}:`, error);
      // Keep the stored data for packages that fail
      if (storedData[packageName]) {
        updatedData[packageName] = storedData[packageName];
      }
    }
  }

  // Save updated ETags to blob storage
  await blob.setJSON(BLOB_KEY, updatedData);

  // Send email if there were changes
  if (results.length > 0) {
    await email({
      subject: `CRAN Package Monitor — ${results.length} ${results.length === 1 ? "change" : "changes"} detected`,
      html: buildEmailHtml(results),
    });
    console.log(`Email sent for ${results.length} ${results.length === 1 ? "change" : "changes"}`);
  } else {
    console.log("No changes detected across all packages");
  }
}
