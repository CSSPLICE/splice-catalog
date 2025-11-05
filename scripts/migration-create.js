#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { execSync } from 'child_process';

const argv = yargs(hideBin(process.argv)).argv;

// Parse the command-line arguments
const {
  _: [name],
  path,
} = argv;

// Construct the migration path
const migrationPath = `src/db/migrations/${name}`;

// Run the typeorm command
execSync(`typeorm migration:create ${migrationPath}`, { stdio: 'inherit' });
