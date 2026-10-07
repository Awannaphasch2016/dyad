import { readFileSync, writeFileSync } from "node:fs";
import { canaryService, canaryTaskDefinition } from "./task_definition.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const secrets = JSON.parse(readFileSync(args.get("--secrets"), "utf8"));
const task = canaryTaskDefinition({
  dyadImage: args.get("--dyad"),
  supervisorImage: args.get("--supervisor"),
  secrets,
});
const service = canaryService({
  taskDefinition: args.get("--task-definition"),
});
writeFileSync(args.get("--task-out"), `${JSON.stringify(task)}\n`);
writeFileSync(args.get("--service-out"), `${JSON.stringify(service)}\n`);
console.log("task_json=written");
