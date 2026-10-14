// Install one published toolbox image onto this machine.
// The image holds no Doppler token and no GitHub token.
import { spawn } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const IMAGE = "ghcr.io/awannaphasch2016/axi-toolbox";
export const DEFAULT_PIN = "/usr/local/share/ops-axi/pin";
export const DEFAULT_BIN = "/usr/local/bin";

export function dockerSpawn(args) {
  return new Promise((resolve) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({ status: 127, stdout, stderr: error.message });
    });
    child.on("close", (status) => {
      resolve({ status: status ?? 1, stdout, stderr });
    });
  });
}

export async function installDigest({
  digest,
  binDir = DEFAULT_BIN,
  pinPath = DEFAULT_PIN,
  docker = dockerSpawn,
  image = IMAGE,
}) {
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
    const error = new Error("digest must be sha256 and 64 hex characters");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  const created = await docker(["create", `${image}@${digest}`]);
  if (created.status !== 0) {
    const error = new Error(
      created.stderr.trim() || `docker create failed for ${image}@${digest}`,
    );
    error.code = "TOOLBOX";
    throw error;
  }
  const id = created.stdout.trim();
  try {
    await mkdir(binDir, { recursive: true });
    for (const name of ["ops-axi", "gh-axi"]) {
      const dest = join(binDir, name);
      const copied = await docker(["cp", `${id}:/opt/axi/bin/${name}`, dest]);
      if (copied.status !== 0) {
        const error = new Error(
          copied.stderr.trim() || `docker cp ${name} failed`,
        );
        error.code = "TOOLBOX";
        throw error;
      }
      await chmod(dest, 0o755);
    }
  } finally {
    await docker(["rm", id]);
  }
  await mkdir(dirname(pinPath), { recursive: true });
  await writeFile(pinPath, `${digest}\n`, { mode: 0o644 });
  return { digest, image: `${image}@${digest}`, binDir, pinPath };
}
