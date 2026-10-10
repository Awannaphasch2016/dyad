// Manual apex publish. The canary deploy does not call this file.
// It refuses to write DNS until the expected image is the only running task.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { imageDecision } from "./confirm-running-image.mjs";
import { run as allowClerkOrigin } from "./clerk-origins.mjs";
import { removeProjectDatabaseEnv } from "./vercel.mjs";
import { promoteApex } from "../canary/promote-apex.mjs";
import { cloudflareConfig } from "../canary/tunnel.mjs";

function awsJson(args) {
  return JSON.parse(execFileSync("aws", args, { encoding: "utf8" }));
}

async function describeRunningTasks() {
  const listed = awsJson([
    "ecs",
    "list-tasks",
    "--cluster",
    "wewebplus",
    "--service-name",
    "wewebplus-canary",
    "--desired-status",
    "RUNNING",
    "--output",
    "json",
  ]);
  const arns = listed.taskArns || [];
  if (arns.length === 0) return { tasks: [] };
  return awsJson([
    "ecs",
    "describe-tasks",
    "--cluster",
    "wewebplus",
    "--tasks",
    ...arns,
    "--output",
    "json",
  ]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForImage() {
  let last = { ready: false, reason: "none" };
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    last = imageDecision(await describeRunningTasks());
    if (last.ready) {
      console.log(`dyad_image=${last.tag}`);
      return last.tag;
    }
    const tag = last.tag ? ` tag=${last.tag}` : "";
    console.log(`dyad_image_wait=${last.reason}${tag} attempt=${attempt}`);
    if (last.reason === "unexpected") process.exit(2);
    await sleep(15_000);
  }
  console.error(`dyad_image_timeout=${last.reason}`);
  process.exit(1);
}

async function waitForPage(url) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      const text = await response.text();
      if (
        response.status === 200 &&
        text.includes("data-dyad-browser-bridge")
      ) {
        console.log(`page_ok status=200 host=${new URL(url).hostname}`);
        return;
      }
      console.log(
        `page_wait status=${response.status} host=${new URL(url).hostname} attempt=${attempt}`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.log(
        `page_wait host=${new URL(url).hostname} attempt=${attempt} error=${reason.split("\n")[0]}`,
      );
    }
    await sleep(15_000);
  }
  throw new Error(`${new URL(url).hostname} did not serve the Dyad page`);
}

async function main() {
  if (existsSync("hitl-web/app/api/questions")) {
    throw new Error("HITL question routes are still present");
  }
  process.env.AWS_DEFAULT_REGION =
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    "ap-southeast-1";
  await waitForImage();
  try {
    const removed = await removeProjectDatabaseEnv({
      token: process.env.VERCEL_TOKEN,
      teamId: process.env.VERCEL_TEAM_ID || process.env.VERCEL_ORG_ID || "",
    });
    console.log(
      `vercel_database_env_removed=${removed.removed} targets=${removed.targets.join(",") || "none"}`,
    );
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (!text.includes(" 403 ")) throw error;
    console.log("vercel_database_env=unreadable");
  }
  process.env.PREVIEW_ORIGIN = "https://anakwannaphaschaiyong.com";
  await allowClerkOrigin();
  if (process.exitCode) process.exit(process.exitCode);
  const published = await promoteApex(cloudflareConfig(process.env));
  console.log(`apex_hostname=${published.hostname}`);
  console.log(`tunnel_id=${published.tunnelId}`);
  await waitForPage("https://pre.anakwannaphaschaiyong.com");
  await waitForPage("https://anakwannaphaschaiyong.com");
  const www = await fetch("https://www.anakwannaphaschaiyong.com", {
    redirect: "manual",
  });
  if (www.status !== 404) {
    throw new Error(`www status ${www.status}`);
  }
  console.log("www_status=404");
}

main().catch((error) => {
  const text = error instanceof Error ? error.message : String(error);
  console.error(
    text.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://redacted"),
  );
  process.exit(1);
});
