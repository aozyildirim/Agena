#!/usr/bin/env node
import { Command } from 'commander';
import { loginCommand } from './commands/login';
import { daemonCommand } from './commands/daemon';
import { runtimeCommand } from './commands/runtime';
import { setupCommand } from './commands/setup';
import { whoamiCommand } from './commands/whoami';
import { orgCommand } from './commands/org';
import { taskCommand } from './commands/task';
import { skillCommand } from './commands/skill';
import { refinementCommand } from './commands/refinement';

// Import package.json for the version. Keep the require here dynamic so
// a simple `node dist/index.js` doesn't bundle it at build time.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../package.json') as { version: string };

const program = new Command();
program
  .name('agena')
  .description('Official command-line tool for AGENA')
  .version(pkg.version);

program.addCommand(loginCommand());
program.addCommand(setupCommand());
program.addCommand(whoamiCommand());
program.addCommand(orgCommand());
program.addCommand(daemonCommand());
program.addCommand(runtimeCommand());
program.addCommand(taskCommand());
program.addCommand(skillCommand());
program.addCommand(refinementCommand());

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
