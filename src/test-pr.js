#!/usr/bin/env node
'use strict';

const exec = require('child_process').exec;
const runCLI = require('jest-cli').runCLI;

const base = process.argv[2];
const branch = process.argv[3];
const jestOptions = {
  coverage: true,
  collectCoverage: true,
  silent: true,
  collectCoverageFrom: []
};

/*
Confirm that required arguments are provided.
*/
if (!base || !branch) handleExit('Must provide base and branch args.', true);

/*
Get base and feature branches from script arguments. If arguments are not
provided, exit script. Generate a diff of file names between the base and
feature branches, then run jest with a collectCoverageFrom flag for each
changedfile.
*/
exec(`git diff --name-only ${base}..${branch}`, (error, stdout, stderr) => {
  if (error) handleExit(error, true);
  if (stderr) handleExit(stderr, true);
  const files = stdout.split('\n').filter(i => i.length);
  if (!files.length) handleExit(`No diff between ${base} and ${branch}.`);
  files.forEach(file => jestOptions.collectCoverageFrom.push(file));
  runCLI(jestOptions, [__dirname]);
});

/*
Wrap the exit message in line breaks. If the message is an error, return exit
code 1; otherwise, return 0.
*/
function handleExit(message, error) {
  console.log(`\n${message}\n`);
  const exitCode = error ? 1 : 0;
  process.exit(exitCode);
}
