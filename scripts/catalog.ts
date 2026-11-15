import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCatalog } from "../src/catalog";

const root = new URL("../", import.meta.url);
const repository = process.env.GH_REPO ?? "TsingShui/myre";
const tag = "catalog-v1";
const catalog = parseCatalog(
  await Bun.file(new URL("catalog/tools.json", root)).json(),
);
async function gh(args: string[], allowFailure = false): Promise<string> {
  const child = Bun.spawn(["gh", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (status !== 0) {
    if (allowFailure && stderr.includes("HTTP 404")) return "";
    throw new Error(`GitHub catalog publication failed: ${stderr || stdout}`);
  }
  return stdout;
}
const existing = await gh(
  ["api", `repos/${repository}/releases/tags/${tag}`],
  true,
);
const release = existing ? JSON.parse(existing) : undefined;
if (release?.immutable)
  throw new Error(
    "The catalog Release must allow asset updates; immutable Releases cannot host this mutable catalog.",
  );
const temporary = await mkdtemp(join(tmpdir(), "myre-catalog-publish-"));
try {
  let unchanged = false;
  if (
    release?.assets?.some(
      (asset: { name: string }) => asset.name === "tools.json",
    )
  ) {
    await gh([
      "release",
      "download",
      tag,
      "--repo",
      repository,
      "--pattern",
      "tools.json",
      "--dir",
      temporary,
    ]);
    const previous = parseCatalog(
      await Bun.file(join(temporary, "tools.json")).json(),
    );
    if (catalog.revision < previous.revision)
      throw new Error("Refusing to publish an older catalog revision.");
    unchanged = JSON.stringify(previous) === JSON.stringify(catalog);
    if (!unchanged && catalog.revision === previous.revision)
      throw new Error(
        "Increase catalog revision before changing its contents.",
      );
  }
  if (!release) {
    const commit =
      process.env.GITHUB_SHA ??
      (
        await gh(["api", `repos/${repository}/commits/main`, "--jq", ".sha"])
      ).trim();
    await gh([
      "release",
      "create",
      tag,
      "--repo",
      repository,
      "--target",
      commit,
      "--draft",
      "--prerelease",
      "--latest=false",
      "--title",
      "Tool catalog (schema 1)",
      "--notes",
      "Mutable tool catalog for myre. Maintained independently of CLI releases.",
    ]);
  }
  if (!unchanged) {
    const path = join(temporary, "tools.json");
    await Bun.write(path, `${JSON.stringify(catalog, null, 2)}\n`);
    await gh([
      "release",
      "upload",
      tag,
      path,
      "--repo",
      repository,
      "--clobber",
    ]);
  }
  await gh([
    "release",
    "edit",
    tag,
    "--repo",
    repository,
    "--draft=false",
    "--prerelease",
    "--latest=false",
  ]);
  console.log(
    `Published catalog revision ${catalog.revision} (${catalog.tools.length} tools).`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
