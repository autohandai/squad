import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";

// A saved workspace locator can be an alias. Resolve its identity without
// changing the locator used by project assignments and permission overrides.
export async function canonicalWorkspaceRoot(workspace, homeDir) {
  let target, userRoot;
  try { [target, userRoot] = await Promise.all([realpath(workspace), realpath(homeDir)]); }
  catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code)) throw new Error("workspace folder does not exist");
    throw error;
  }
  const difference = relative(userRoot, target);
  if (!difference) throw new Error("the home directory is blocked by Autohand CLI; choose a project folder or git repo");
  if (difference === ".." || difference.startsWith("../") || difference.startsWith("..\\") || isAbsolute(difference)) {
    throw new Error("workspace must resolve to a folder inside the user directory");
  }
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("workspace folder does not exist");
  return target;
}
