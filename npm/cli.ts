#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { commandName, packageName, platformKey } from "./platforms";

declare const MYRE_VERSION: string;

try {
  const platform = platformKey();
  const name = packageName(platform);
  let executable: string;
  try {
    const metadata = require(`${name}/package.json`);
    if (metadata.version !== MYRE_VERSION) {
      throw new Error(`Expected ${MYRE_VERSION}, found ${metadata.version}.`);
    }
    executable = require.resolve(`${name}/bin/${commandName(platform)}`);
  } catch (error) {
    throw new Error(
      `Cannot load ${name}@${MYRE_VERSION}. Reinstall myre without --omit=optional. Linux requires glibc. ${error instanceof Error ? error.message : error}`,
    );
  }
  const result = spawnSync(executable, process.argv.slice(2), {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.signal) process.kill(process.pid, result.signal);
  else process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(`myre: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
