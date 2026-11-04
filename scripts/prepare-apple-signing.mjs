import { execFile } from "node:child_process";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execute = promisify(execFile);
const API_FIELDS = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"];
export function appleSigningConfiguration(env) {
  const value = name => String(env[name] || "").trim();
  const missing = ["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_TEAM_ID"].filter(name => !value(name));
  if (missing.length) throw new Error(`Apple release credentials are missing: ${missing.join(", ")}. Publication is blocked.`);
  if (!/^[A-Z0-9]{10}$/.test(value("APPLE_TEAM_ID"))) throw new Error("APPLE_TEAM_ID must identify the expected Apple team.");
  const api = API_FIELDS.filter(name => value(name));
  if (api.length && api.length !== API_FIELDS.length) throw new Error(`Apple notarization credentials are incomplete: ${API_FIELDS.filter(name => !value(name)).join(", ")}. Publication is blocked.`);
  if (api.length) {
    if (!/^[A-Z0-9]{10}$/.test(value("APPLE_API_KEY_ID"))) throw new Error("APPLE_API_KEY_ID is invalid.");
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value("APPLE_API_ISSUER"))) throw new Error("APPLE_API_ISSUER is invalid.");
    if (!value("APPLE_API_KEY").includes("-----BEGIN PRIVATE KEY-----")) throw new Error("APPLE_API_KEY must contain the notarization private key.");
    return { team: value("APPLE_TEAM_ID"), mode: "api" };
  }
  if (!value("APPLE_ID") || !value("APPLE_PASSWORD")) throw new Error("Apple notarization credentials are missing. Configure the API key and issuer, or APPLE_ID and APPLE_PASSWORD. Publication is blocked.");
  if (/[\r\n]/.test(env.APPLE_ID + env.APPLE_PASSWORD)) throw new Error("Apple ID notarization credentials cannot contain line breaks.");
  return { team: value("APPLE_TEAM_ID"), mode: "apple-id" };
}

function redact(message, env) {
  let text = String(message);
  for (const name of ["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_API_KEY", "APPLE_PASSWORD"]) {
    if (env[name]) text = text.split(env[name]).join("[redacted]");
  }
  return text;
}

export async function prepareAppleSigning(env = process.env) {
  const configuration = appleSigningConfiguration(env);
  if (process.platform !== "darwin") throw new Error("Import Apple release credentials on a macOS runner.");
  if (!env.RUNNER_TEMP || !env.GITHUB_ENV) throw new Error("Use the runner's temporary directory and environment file for Apple signing.");
  const directory = await mkdtemp(join(env.RUNNER_TEMP, "squad-apple-signing-"));
  const keychain = join(directory, "signing.keychain-db");
  const certificate = join(directory, "identity.p12");
  const keychainPassword = randomBytes(32).toString("hex");
  const run = async (command, args) => {
    try { return (await execute(command, args, { maxBuffer: 2 * 1024 * 1024 })).stdout; }
    catch (error) {
      const detail = redact(error.stderr || `${command} failed`, env).split(keychainPassword).join("[redacted]");
      throw new Error(detail.trim());
    }
  };
  let imported = false;
  try {
    const encoded = env.APPLE_CERTIFICATE.replace(/\s/g, "");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("APPLE_CERTIFICATE is not a base64 PKCS12 archive.");
    await writeFile(certificate, Buffer.from(encoded, "base64"), { mode: 0o600, flag: "wx" });
    await run("security", ["create-keychain", "-p", keychainPassword, keychain]);
    imported = true;
    await run("security", ["set-keychain-settings", "-lut", "21600", keychain]);
    await run("security", ["unlock-keychain", "-p", keychainPassword, keychain]);
    await run("security", ["import", certificate, "-k", keychain, "-P", env.APPLE_CERTIFICATE_PASSWORD, "-T", "/usr/bin/codesign", "-T", "/usr/bin/security"]);
    await run("security", ["set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", keychainPassword, keychain]);
    const existing = (await run("security", ["list-keychains", "-d", "user"])).split("\n").map(line => line.trim()).filter(Boolean).map(line => JSON.parse(line));
    await run("security", ["list-keychains", "-d", "user", "-s", ...new Set([keychain, ...existing])]);
    const listing = await run("security", ["find-identity", "-v", "-p", "codesigning", keychain]);
    const identities = [...listing.matchAll(/"(Developer ID Application: [^"\r\n]+)"/g)].map(match => match[1]).filter(identity => identity.endsWith(`(${configuration.team})`));
    if (identities.length !== 1) throw new Error("The archive must provide one valid Developer ID Application identity for APPLE_TEAM_ID. Publication is blocked.");
    const settings = { APPLE_SIGNING_IDENTITY: identities[0], APPLE_TEAM_ID: configuration.team, SQUAD_APPLE_SIGNING_DIR: directory, SQUAD_APPLE_KEYCHAIN_PATH: keychain };
    if (configuration.mode === "api") {
      const path = join(directory, `AuthKey_${env.APPLE_API_KEY_ID}.p8`);
      await writeFile(path, env.APPLE_API_KEY, { mode: 0o600, flag: "wx" });
      await run("xcrun", ["notarytool", "history", "--key", path, "--key-id", env.APPLE_API_KEY_ID, "--issuer", env.APPLE_API_ISSUER, "--output-format", "json"]);
      Object.assign(settings, { APPLE_API_KEY: env.APPLE_API_KEY_ID, APPLE_API_KEY_PATH: path, APPLE_API_ISSUER: env.APPLE_API_ISSUER });
    } else {
      await run("xcrun", ["notarytool", "history", "--apple-id", env.APPLE_ID, "--password", env.APPLE_PASSWORD, "--team-id", configuration.team, "--output-format", "json"]);
      Object.assign(settings, { APPLE_ID: env.APPLE_ID, APPLE_PASSWORD: env.APPLE_PASSWORD, APPLE_TEAM_ID: configuration.team });
    }
    await appendFile(env.GITHUB_ENV, Object.entries(settings).map(([name, value]) => `${name}=${value}\n`).join(""), { mode: 0o600 });
    console.log(`Verified Developer ID identity for team ${configuration.team} and Apple notarization authentication.`);
    return configuration;
  } catch (error) {
    if (imported) await run("security", ["delete-keychain", keychain]).catch(() => {});
    await rm(directory, { recursive: true, force: true });
    throw error;
  } finally { await rm(certificate, { force: true }); }
}

export async function cleanupAppleSigning(env = process.env) {
  if (!env.SQUAD_APPLE_SIGNING_DIR) return;
  const directory = resolve(env.SQUAD_APPLE_SIGNING_DIR);
  if (!env.RUNNER_TEMP || !directory.startsWith(resolve(env.RUNNER_TEMP) + sep) || !directory.split(sep).at(-1).startsWith("squad-apple-signing-")) throw new Error("Refusing to clean an unrelated signing directory.");
  await execute("security", ["delete-keychain", join(directory, "signing.keychain-db")]);
  await rm(directory, { recursive: true, force: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.includes("--cleanup")) await cleanupAppleSigning();
    else if (process.argv.includes("--check-env")) { appleSigningConfiguration(process.env); console.log("Apple release credential configuration is complete."); }
    else await prepareAppleSigning();
  } catch (error) { console.error(`::error::${redact(error.message, process.env)}`); process.exitCode = 1; }
}
