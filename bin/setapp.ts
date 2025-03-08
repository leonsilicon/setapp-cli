#!/usr/bin/env bun
import fs from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import crypto from "node:crypto";

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];
let appIdentifiers: string[] = [];
let nameFlag = false;
let parallelFlag = false;

// Check for flags
const nameIndex = args.indexOf("--name");
if (nameIndex !== -1) {
  nameFlag = true;
  // Remove the --name flag from args
  args.splice(nameIndex, 1);
}

const parallelIndex = args.indexOf("--parallel");
if (parallelIndex !== -1) {
  parallelFlag = true;
  // Remove the --parallel flag from args
  args.splice(parallelIndex, 1);
}

// Get app identifiers (everything after the command except flags)
if (command) {
  appIdentifiers = args.slice(1);
}

// ANSI color codes for prettier output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

if (!command || (command === "install" && appIdentifiers.length === 0)) {
  console.log(`${colors.bright}${colors.cyan}Setapp CLI${colors.reset}`);
  console.log(`${colors.dim}A command-line tool for installing Setapp applications${colors.reset}\n`);
  console.log(`${colors.bright}Usage:${colors.reset}`);
  console.log(
    `  ${colors.green}setapp install <ids...>           ${colors.reset}- Install apps by their IDs`
  );
  console.log(
    `  ${colors.green}setapp install --name <names...>  ${colors.reset}- Install apps by their names`
  );
  console.log(
    `  ${colors.green}setapp install --parallel <ids...>${colors.reset}- Install apps concurrently`
  );
  console.log(`  ${colors.green}setapp list                       ${colors.reset}- List all available apps`);
  process.exit(1);
}

// Setup cache directory
const cacheDir = path.join(process.env.HOME || "~", ".cache", "setapp-cli");
const cacheFile = path.join(cacheDir, "store-api-cache.json");
let json;

// Ensure cache directory exists
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

// Check if we have a valid cache
let useCache = false;
if (fs.existsSync(cacheFile)) {
  try {
    const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    const now = Date.now();
    if (cacheData.expiry && cacheData.expiry > now) {
      console.log(`${colors.dim}Using cached API data...${colors.reset}`);
      json = cacheData.data;
      useCache = true;
    }
  } catch (error) {
    console.log(`${colors.dim}Cache file invalid, fetching fresh data...${colors.reset}`);
  }
}

// Fetch data from Setapp API if cache is invalid
if (!useCache) {
  console.log(`${colors.dim}Fetching data from Setapp API...${colors.reset}`);
  const response = await fetch("https://store.setapp.com/store/api/v8/en");
  json = await response.json();

  // Get cache expiry from headers
  let maxAge = 14400; // Default to 4 hours (from cache-control: public, max-age=14400)
  const cacheControl = response.headers.get('cache-control');
  const expires = response.headers.get('expires');

  if (cacheControl) {
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
    if (maxAgeMatch && maxAgeMatch[1]) {
      maxAge = parseInt(maxAgeMatch[1], 10);
    }
  }

  // Calculate expiry time
  let expiryTime = Date.now() + (maxAge * 1000);

  // If expires header is present, use it as a fallback
  if (expires) {
    const expiresDate = new Date(expires).getTime();
    if (!isNaN(expiresDate)) {
      // Use the earlier of the two expiry times
      expiryTime = Math.min(expiryTime, expiresDate);
    }
  }

  // Save to cache with expiry
  const cacheData = {
    data: json,
    expiry: expiryTime,
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified')
  };
  fs.writeFileSync(cacheFile, JSON.stringify(cacheData));
}

// Type assertion for the JSON data
const typedJson = json as {
  data: {
    id: string;
    type: string;
    relationships: {
      vendors: {
        data: Array<{
          id: string;
          type: string;
          attributes: {
            name: string;
          };
          relationships: {
            applications: {
              data: Array<{
                id: number;
                type: string;
                attributes: {
                  name: string;
                };
                relationships: {
                  versions: {
                    data: Array<{
                      id: number;
                      attributes: {
                        archive_url: string;
                      };
                    }>;
                  };
                };
              }>;
            };
          };
        }>;
      };
    };
  };
};

// Create a map from application ID to archive URL and name
const appArchiveMap = new Map<number, { url: string; name: string }>();
// Create a map from lowercase app name to ID for case-insensitive lookup
const appNameMap = new Map<string, number>();

// Iterate through vendors
for (const vendor of typedJson.data.relationships.vendors.data) {
  // Iterate through applications for each vendor
  for (const app of vendor.relationships.applications.data) {
    // Get the app ID
    const appId = app.id;
    const appName = app.attributes.name;

    // Get the latest version's archive URL (assuming the first one is the latest)
    const versions = app.relationships.versions.data;
    if (versions.length > 0) {
      const archiveUrl = versions[0].attributes.archive_url;
      appArchiveMap.set(appId, { url: archiveUrl, name: appName });
      appNameMap.set(appName.toLowerCase(), appId);
    }
  }
}

// Ensure Setapp directory exists
const setappDir = "/Applications/Setapp";

// Check if we have permission to write to /Applications
try {
  if (!fs.existsSync(setappDir)) {
    console.log(`${colors.yellow}Creating Setapp directory at ${setappDir}${colors.reset}`);
    try {
      execSync(`sudo mkdir -p "${setappDir}"`);
    } catch (error) {
      console.error(`${colors.red}Error creating directory: ${error}${colors.reset}`);
      process.exit(1);
    }
  }
} catch (error) {
  console.error(`${colors.red}Error checking directory: ${error}${colors.reset}`);
  console.error(`${colors.red}This script requires permission to access /Applications${colors.reset}`);
  process.exit(1);
}

// Handle different commands
if (command === "install") {
  // Resolve all app identifiers to actual apps first
  const appsToInstall = [];

  for (const identifier of appIdentifiers) {
    const appId = Number(identifier);
    let app;

    if (!isNaN(appId) && !nameFlag) {
      app = appArchiveMap.get(appId);
      if (!app) {
        console.log(`${colors.red}App with ID ${appId} not found.${colors.reset}`);
        continue;
      }
      appsToInstall.push({ ...app, id: appId });
    } else if (nameFlag) {
      const id = appNameMap.get(identifier.toLowerCase());
      if (!id) {
        console.log(`${colors.red}App with name "${identifier}" not found.${colors.reset}`);
        continue;
      }
      app = appArchiveMap.get(id);
      if (app) {
        appsToInstall.push({ ...app, id });
      }
    } else {
      console.log(
        `${colors.red}Invalid app ID: ${identifier}. Use --name flag to search by name.${colors.reset}`
      );
    }
  }

  if (appsToInstall.length === 0) {
    console.log(`${colors.red}No valid apps to install.${colors.reset}`);
    process.exit(1);
  }

  // Log all apps that will be installed
  console.log(`\n${colors.bright}${colors.cyan}Installing the following Setapp applications:${colors.reset}`);
  console.log(`${colors.dim}${"─".repeat(50)}${colors.reset}`);

  for (const app of appsToInstall) {
    console.log(`${colors.bright}${colors.cyan}${app.name}${colors.reset} ${colors.dim}(ID: ${app.id})${colors.reset}`);
  }
  console.log(`${colors.dim}${"─".repeat(50)}${colors.reset}\n`);

  // Function to install a single app
  async function installApp(app: { url: string; name: string; id: number }) {
    try {
      // Check if any app with this name already exists in the Setapp directory
      const appNamePattern = `${setappDir}/${app.name}*.app`;
      const existingApps = execSync(`find "${setappDir}" -maxdepth 1 -name "${app.name}*.app" 2>/dev/null || true`)
        .toString()
        .trim();

      if (existingApps) {
        console.log(`${colors.yellow}⚠️  ${app.name} already exists in ${setappDir}, skipping...${colors.reset}`);
        return { success: true, name: app.name, skipped: true };
      }

      // Generate random directory and file names to avoid conflicts
      const randomId = crypto.randomBytes(8).toString('hex');
      const tempDir = `/tmp/setapp_${randomId}_${app.id}`;
      const tempFile = `${tempDir}.zip`;

      console.log(`${colors.yellow}⬇️  Downloading ${app.name}...${colors.reset}`);

      // Download with progress bar only when installing sequentially
      await new Promise<void>((resolve, reject) => {
        const progressFlag = parallelFlag ? "" : "--progress-bar";
        const curl = execSync(
          `curl -L "${app.url}" -o "${tempFile}" ${progressFlag}`,
          { stdio: 'inherit' }
        );
        resolve();
      });

      // Create a temporary directory for extraction
      execSync(`mkdir -p "${tempDir}"`);
      execSync(`unzip -q "${tempFile}" -d "${tempDir}"`);

      // Find the .app folder in the extracted contents
      const appFiles = execSync(`find "${tempDir}" -name "*.app" -maxdepth 1`)
        .toString()
        .trim()
        .split("\n");

      if (appFiles.length === 0) {
        throw new Error("No .app package found in the downloaded archive");
      }

      // Move the .app folder to the Setapp directory
      for (const appFile of appFiles) {
        if (appFile) {
          const appName = appFile.split("/").pop();
          const destPath = `${setappDir}/${appName}`;

          // Check if the app already exists
          if (fs.existsSync(destPath)) {
            console.log(`${colors.yellow}⚠️  ${appName} already exists in ${setappDir}, skipping...${colors.reset}`);
          } else {
            execSync(`sudo mv "${appFile}" "${destPath}"`);
            console.log(`${colors.green}✅ Installed ${appName} to ${setappDir}${colors.reset}`);
          }
        }
      }

      execSync(`rm -rf "${tempDir}" "${tempFile}"`);

      return { success: true, name: app.name };
    } catch (error) {
      console.error(`${colors.red}❌ Error installing ${app.name}: ${error}${colors.reset}`);
      console.log(`${colors.dim}${"─".repeat(50)}${colors.reset}`);
      return { success: false, name: app.name, error };
    }
  }

  let results;

  if (parallelFlag) {
    // Install all apps concurrently if --parallel flag is used
    const installPromises = appsToInstall.map(app => installApp(app));
    results = await Promise.all(installPromises);
  } else {
    // Install apps sequentially
    results = [];
    for (const app of appsToInstall) {
      const result = await installApp(app);
      results.push(result);
    }
  }

  const successful = results.filter(r => r.success).length;
  const skipped = results.filter(r => r.skipped).length;

  console.log(`\n${colors.bright}${colors.cyan}Installation summary:${colors.reset}`);
  console.log(`${colors.green}✅ Successfully installed: ${successful - skipped}/${appsToInstall.length}${colors.reset}`);

  if (skipped > 0) {
    console.log(`${colors.yellow}⚠️  Skipped (already installed): ${skipped}${colors.reset}`);
  }

  if (successful < appsToInstall.length) {
    console.log(`${colors.red}❌ Failed: ${appsToInstall.length - successful}${colors.reset}`);
  }
} else if (command === "list") {
  console.log(`\n${colors.bright}${colors.cyan}Available applications:${colors.reset}`);
  console.log(`${colors.dim}${"─".repeat(50)}${colors.reset}`);

  // Convert map to array, sort by name, and display
  const sortedApps = Array.from(appArchiveMap.entries())
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([id, app]) => ({ id, name: app.name }));

  for (const app of sortedApps) {
    console.log(`${colors.green}•${colors.reset} ${colors.bright}${app.name}${colors.reset} ${colors.dim}(ID: ${app.id})${colors.reset}`);
  }
  console.log(`\n${colors.dim}Total: ${sortedApps.length} applications${colors.reset}`);
} else {
  console.log(`${colors.red}Unknown command: ${command}${colors.reset}`);
  console.log(`${colors.yellow}Available commands: install, list${colors.reset}`);
}
