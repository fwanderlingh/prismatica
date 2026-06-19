import fs from "fs";
import path from "path";

const apiRoot = path.join(process.cwd(), "app", "api");
const publicRoutes = new Map([
  ["app/api/auth/config/route.ts", "public auth/captcha config"],
  ["app/api/auth/login/route.ts", "public login endpoint"],
  ["app/api/auth/logout/route.ts", "session cookie clearing endpoint"],
  ["app/api/auth/register/route.ts", "public registration endpoint"]
]);

function walkRouteFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkRouteFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name === "route.ts") {
      files.push(entryPath);
    }
  }

  return files;
}

function toProjectPath(filePath) {
  return path.relative(process.cwd(), filePath).split(path.sep).join("/");
}

const routeFiles = walkRouteFiles(apiRoot).map(toProjectPath).sort();
const missingSessionGuard = [];

for (const routeFile of routeFiles) {
  if (publicRoutes.has(routeFile)) {
    continue;
  }

  const source = fs.readFileSync(path.join(process.cwd(), routeFile), "utf8");
  if (!/\brequireSessionUserId\s*\(/.test(source)) {
    missingSessionGuard.push(routeFile);
  }
}

if (missingSessionGuard.length > 0) {
  console.error("Sensitive API routes must call requireSessionUserId() or be explicitly allowlisted as public.");
  console.error("");
  for (const routeFile of missingSessionGuard) {
    console.error(`- ${routeFile}`);
  }
  process.exit(1);
}

console.log(`API route auth guard check passed for ${routeFiles.length} routes (${publicRoutes.size} public allowlisted).`);
