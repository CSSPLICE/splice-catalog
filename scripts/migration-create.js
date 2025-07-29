#!/usr/bin/env node

import { argv } from 'yargs';
import { execSync } from 'child_process';

// Parse the command-line arguments
const {
  _: [name],
  path,
} = argv;

// Construct the migration path
const migrationPath = `src/db/migrations/${name}`;

// Run the typeorm command
execSync(`typeorm migration:create ${migrationPath}`, { stdio: 'inherit' });
