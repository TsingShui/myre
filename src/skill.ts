import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
} from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import skillTemplate from "../SKILL.md" with { type: "text" };
import type { LoadedCatalog } from "./catalog";

const toolsStart = "<!-- myre:tools:start -->";
const toolsEnd = "<!-- myre:tools:end -->";
const managedStamp =
  /\n<!-- myre:managed v1 revision=(\d+) sha256=([a-f0-9]{64}) -->\n$/;

function replaceTools(content: string, catalog: LoadedCatalog): string {
  const start = content.indexOf(toolsStart);
  const end = content.indexOf(toolsEnd);
  if (
    start < 0 ||
    end < start + toolsStart.length ||
    start !== content.lastIndexOf(toolsStart) ||
    end !== content.lastIndexOf(toolsEnd)
  )
    throw new Error("Invalid Skill tool index markers.");

  const rows = catalog.tools.map((tool) => {
    const scope = tool.description.replace(/[\\`*_[\]<>|]/g, "\\$&");
    const command = tool.command ?? tool.name;
    return `| ${scope} | \`${command}\` | \`${command} --help\` |`;
  });
  const table = rows.length
    ? [
        "| When you need to… | Use | Learn more |",
        "| --- | --- | --- |",
        ...rows,
      ].join("\n")
    : "No tools in the current catalog.";
  return `${content.slice(0, start + toolsStart.length)}\n\n${table}\n\n${content.slice(end)}`;
}

export function renderSkill(catalog: LoadedCatalog): string {
  return replaceTools(skillTemplate, catalog);
}

function digest(body: string, revision: number): string {
  return new Bun.CryptoHasher("sha256")
    .update(`${revision}\n${body}`)
    .digest("hex");
}

function stamp(body: string, revision: number): string {
  return `${body}\n<!-- myre:managed v1 revision=${revision} sha256=${digest(body, revision)} -->\n`;
}

function managed(content: string) {
  const match = managedStamp.exec(content);
  if (!match) return;
  const revision = Number(match[1]);
  const body = content.slice(0, match.index);
  if (
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    digest(body, revision) !== match[2]
  )
    return;
  return { body, revision };
}

function skillDirectory(): string {
  const home = homedir();
  if (!isAbsolute(home))
    throw new Error("Cannot determine an absolute home directory.");
  return join(home, ".agents", "skills", "myre");
}

async function inspect(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

async function readSkill(path: string): Promise<string | undefined> {
  const info = await inspect(path);
  if (!info) return;
  if (!info.isFile() || info.size > 2 * 1024 * 1024)
    throw new Error(`Not a regular Skill file within the 2 MiB limit: ${path}`);
  return Bun.file(path).text();
}

async function publishSkill(
  directory: string,
  content: string,
  previous: string | undefined,
): Promise<void> {
  const target = join(directory, "SKILL.md");
  const staging = await mkdtemp(join(directory, ".install-"));
  try {
    const source = join(staging, "SKILL.md");
    await Bun.write(source, content);
    if ((await readSkill(target)) !== previous)
      throw new Error(
        `Skill changed during publication; leaving it untouched: ${target}`,
      );
    // A new file must not replace anything; managed updates switch atomically.
    if (previous === undefined) await link(source, target);
    else await rename(source, target);
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

async function updateSkill(
  directory: string,
  catalog: LoadedCatalog,
  install: boolean,
): Promise<boolean> {
  const target = join(directory, "SKILL.md");
  const next = (current: string | undefined): string | undefined => {
    if (current === undefined)
      return install
        ? stamp(renderSkill(catalog), catalog.revision)
        : undefined;
    const record = managed(current);
    if (!record)
      throw new Error(
        `Refusing to modify an unmanaged or edited Skill: ${target}`,
      );
    if (record.revision > catalog.revision) return;
    // Automatic synchronization preserves the installed guide outside Tools.
    const body = install
      ? renderSkill(catalog)
      : replaceTools(record.body, catalog);
    if (body === record.body) return;
    return stamp(body, catalog.revision);
  };

  if (next(await readSkill(target)) === undefined) return false;
  const lockPath = join(directory, ".myre-skill.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        `Another operation is handling the Skill; inspect the lock: ${lockPath}`,
      );
    throw error;
  }
  try {
    await lock.writeFile(`${process.pid}\n`);
    const previous = await readSkill(target);
    const content = next(previous);
    if (content === undefined) return false;
    await publishSkill(directory, content, previous);
    return true;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

export async function installSkill(catalog: LoadedCatalog): Promise<string> {
  const directory = skillDirectory();
  await mkdir(directory, { recursive: true });
  if (!(await lstat(directory)).isDirectory())
    throw new Error(`Not a regular Skill directory: ${directory}`);
  await updateSkill(directory, catalog, true);
  return join(directory, "SKILL.md");
}

export async function syncSkill(catalog: LoadedCatalog): Promise<void> {
  try {
    const directory = skillDirectory();
    const info = await inspect(directory);
    if (!info) return;
    if (!info.isDirectory())
      throw new Error(`Not a regular Skill directory: ${directory}`);
    if (await updateSkill(directory, catalog, false))
      console.error(`Updated myre Skill: ${join(directory, "SKILL.md")}`);
  } catch (error) {
    console.warn(
      `Cannot synchronize myre Skill: ${error instanceof Error ? error.message : error}`,
    );
  }
}
