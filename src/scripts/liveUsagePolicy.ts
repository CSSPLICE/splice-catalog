import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { AppDataSource } from '../db/data-source.js';
import {
  provisionalUsageService,
  MySqlProvisionalUsageStore,
  usageConfigurationId,
  UsagePolicyConfiguration,
} from '../services/ProvisionalUsageService.js';

// No worker, migrations, cleanup or automatic switch is started by this command.
async function main() {
  const service = provisionalUsageService;
  if (!service || !(service.store instanceof MySqlProvisionalUsageStore))
    throw new Error('Enable LIVE_USAGE_PROVISIONAL_ENABLED with the intended settings and stable secret');
  const [command, ...args] = process.argv.slice(2);
  if (command === 'manifest') {
    console.log(JSON.stringify(service.configuration, null, 2));
    return;
  }
  if (!['status', 'transition'].includes(command))
    throw new Error('Usage: usage:policy -- status|manifest|transition --from legacy|FILE [--to legacy|FILE]');
  const load = async (value: string | undefined): Promise<UsagePolicyConfiguration> => {
    if (!value) throw new Error('Explicit --from policy manifest required');
    return value === 'legacy'
      ? { ...service.configuration, policy: 'phase2-v1' }
      : JSON.parse(await readFile(value, 'utf8'));
  };
  const argument = (name: string) => args[args.indexOf(name) + 1];
  let from: UsagePolicyConfiguration | undefined, target: UsagePolicyConfiguration | undefined;
  if (command === 'transition') {
    if (args[0] !== '--from' || ![2, 4].includes(args.length) || (args.length === 4 && args[2] !== '--to'))
      throw new Error('Usage: transition --from legacy|FILE [--to legacy|FILE]');
    from = await load(argument('--from'));
    target = args.includes('--to') ? await load(argument('--to')) : service.configuration;
  }
  await AppDataSource.initialize();
  try {
    if (command === 'status')
      console.log(
        JSON.stringify(
          {
            ...(await service.store.policyStatus()),
            legacySameSettings: usageConfigurationId(process.env.LIVE_USAGE_STATE_SECRET || '', {
              ...service.configuration,
              policy: 'phase2-v1',
            }),
          },
          null,
          2,
        ),
      );
    else console.log(JSON.stringify(await service.transitionPolicy(from!, target)));
  } finally {
    await AppDataSource.destroy();
  }
}
main().catch((error) => {
  // Configuration messages contain no request identifiers or database credentials.
  console.error(
    error instanceof Error && /^(PROVISIONAL_|Usage:|Explicit |Enable )/.test(error.message)
      ? error.message
      : 'Policy command failed; check intended database and configuration',
  );
  process.exitCode = 1;
});
