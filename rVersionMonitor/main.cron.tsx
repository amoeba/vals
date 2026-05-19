import { blob } from "https://esm.town/v/std/blob";
import { email } from "https://esm.town/v/std/email";

const API_URL = "https://api.r-hub.io/rversions/r-release-macos-arm64";
const BLOB_KEY = "r_release_macos_arm64_version";

interface RVersion {
  version: string;
  date: string;
  semver: string;
  nickname: string;
  URL: string;
}

export default async function () {
  const response = await fetch(API_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch R version: ${response.status} ${response.statusText}`);
  }
  const current: RVersion = await response.json();

  const previous: RVersion | null = await blob.getJSON(BLOB_KEY);

  if (previous && previous.version === current.version) {
    // No change — nothing to do
    return;
  }

  // Save new version
  await blob.setJSON(BLOB_KEY, current);

  // Don't email on first run (no previous value to compare against)
  if (!previous) {
    console.log(`Initialized R version tracking at ${current.version} ("${current.nickname}")`);
    return;
  }

  await email({
    subject: `R macOS ARM64 updated: ${previous.version} → ${current.version} ("${current.nickname}")`,
    text: `R for macOS (ARM64) has a new release.

Previous: ${previous.version} ("${previous.nickname}")
New:      ${current.version} ("${current.nickname}")
Released: ${current.date}
Download: ${current.URL}

Source: ${API_URL}`,
  });

  console.log(`Emailed: R version changed from ${previous.version} to ${current.version}`);
}
