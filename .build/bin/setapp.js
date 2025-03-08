#!/usr/bin/env bun
// @bun

// bin/setapp.ts
var args = process.argv.slice(2);
var command = args[0];
var appIdentifiers = [];
var nameFlag = false;
var nameIndex = args.indexOf("--name");
if (nameIndex !== -1) {
  nameFlag = true;
  args.splice(nameIndex, 1);
  appIdentifiers = args.slice(1);
} else {
  appIdentifiers = args.slice(1);
}
if (!command || command === "install" && appIdentifiers.length === 0) {
  console.log("Usage:");
  console.log("  setapp install <ids...>           - Install apps by their IDs");
  console.log("  setapp install --name <names...>  - Install apps by their names");
  console.log("  setapp list                       - List all available apps");
  process.exit(1);
}
var response = await fetch("https://store.setapp.com/store/api/v8/en");
var json = await response.json();
var appArchiveMap = new Map;
var appNameMap = new Map;
for (const vendor of json.data.relationships.vendors.data) {
  for (const app of vendor.relationships.applications.data) {
    const appId = app.id;
    const appName = app.attributes.name;
    const versions = app.relationships.versions.data;
    if (versions.length > 0) {
      const archiveUrl = versions[0].attributes.archive_url;
      appArchiveMap.set(appId, { url: archiveUrl, name: appName });
      appNameMap.set(appName.toLowerCase(), appId);
    }
  }
}
if (command === "install") {
  console.log("Installing the following apps:");
  for (const identifier of appIdentifiers) {
    const appId = Number(identifier);
    let app;
    if (!isNaN(appId) && !nameFlag) {
      app = appArchiveMap.get(appId);
      if (!app) {
        console.log(`App with ID ${appId} not found.`);
        continue;
      }
    } else if (nameFlag) {
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
      const displayId = !isNaN(appId) && !nameFlag ? appId : appNameMap.get(identifier.toLowerCase());
      console.log(`- ${app.name} (ID: ${displayId})`);
      console.log(`  Download URL: ${app.url}`);
    }
  }
} else if (command === "list") {
  console.log("Available applications:");
  const sortedApps = Array.from(appArchiveMap.entries()).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, app]) => ({ id, name: app.name }));
  for (const app of sortedApps) {
    console.log(`- ${app.name} (ID: ${app.id})`);
  }
} else {
  console.log(`Unknown command: ${command}`);
  console.log("Available commands: install, list");
}
