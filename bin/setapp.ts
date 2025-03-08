#!/usr/bin/env bun
export {};

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];
let appIdentifiers: string[] = [];
let nameFlag = false;

// Check for --name flag
const nameIndex = args.indexOf("--name");
if (nameIndex !== -1) {
  nameFlag = true;
  // Remove the --name flag from args
  args.splice(nameIndex, 1);
  appIdentifiers = args.slice(1);
} else {
  appIdentifiers = args.slice(1);
}

if (!command || (command === "install" && appIdentifiers.length === 0)) {
  console.log("Usage:");
  console.log(
    "  setapp install <ids...>           - Install apps by their IDs"
  );
  console.log(
    "  setapp install --name <names...>  - Install apps by their names"
  );
  console.log("  setapp list                       - List all available apps");
  process.exit(1);
}

// Fetch data from Setapp API
const response = await fetch("https://store.setapp.com/store/api/v8/en");
const json = (await response.json()) as {
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
for (const vendor of json.data.relationships.vendors.data) {
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

// Handle different commands
if (command === "install") {
  console.log("Installing the following apps:");

  for (const identifier of appIdentifiers) {
    // Check if the identifier is a number (ID) or a string (name)
    const appId = Number(identifier);
    let app;

    if (!isNaN(appId) && !nameFlag) {
      // If it's a valid number and not using --name flag, look up by ID
      app = appArchiveMap.get(appId);
      if (!app) {
        console.log(`App with ID ${appId} not found.`);
        continue;
      }
    } else if (nameFlag) {
      // If using --name flag, look up by name (case-insensitive)
      const id = appNameMap.get(identifier.toLowerCase());
      if (!id) {
        console.log(`App with name "${identifier}" not found.`);
        continue;
      }
      app = appArchiveMap.get(id);
    } else {
      console.log(`Invalid app ID: ${identifier}. Use --name flag to search by name.`);
      continue;
    }

    if (app) {
      const displayId = !isNaN(appId) && !nameFlag
        ? appId
        : appNameMap.get(identifier.toLowerCase());
      console.log(`- ${app.name} (ID: ${displayId})`);
      console.log(`  Download URL: ${app.url}`);
      // Here you would add the actual download and installation logic
    }
  }
} else if (command === "list") {
  console.log("Available applications:");

  // Convert map to array, sort by name, and display
  const sortedApps = Array.from(appArchiveMap.entries())
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([id, app]) => ({ id, name: app.name }));

  for (const app of sortedApps) {
    console.log(`- ${app.name} (ID: ${app.id})`);
  }
} else {
  console.log(`Unknown command: ${command}`);
  console.log("Available commands: install, list");
}
