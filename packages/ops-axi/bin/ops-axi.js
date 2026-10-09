#!/usr/bin/env node
import { main } from "../lib/cli.js";

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`error: ${error?.message || error}\ncode: UNKNOWN\n`);
    process.exitCode = 3;
  },
);
