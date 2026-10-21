// Migrates a v1 state.json to the version-2 ledger.
//
//   ts-node scripts/migrate-state-v2.ts [--state <file>] [--openai-account-scope <scope>]
//   ts-node scripts/migrate-state-v2.ts [--state <file>] [--openai-account-scope <scope>] --apply
//
// Without --apply it prints the conversion report and writes nothing. With
// --apply it takes the state lock, backs up the original bytes under a unique
// name, validates the converted state and replaces the file atomically. Stop
// every old-build writer first. A corrupt, absent or already-versioned state
// exits non-zero and is left untouched.
import fs from 'fs';
import path from 'path';
import { migrateStateV1, type MigrationReport } from '../src/state-migration';
import {
  DEFAULT_LOCK_WAIT_MS, replaceFileAtomically, serialiseStateV2, validateStateV2, withStateLock, writeNewFileDurably,
} from '../src/state-v2';

interface Options {
  stateFile: string;
  apply: boolean;
  openaiAccountScope?: string;
  lockWaitMs: number;
}

function usage(message: string): never {
  console.error(`migrate-state-v2: ${message}`);
  console.error('usage: migrate-state-v2.ts [--state <file>] [--openai-account-scope <scope>] [--lock-wait-ms <n>] [--apply]');
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    stateFile: process.env.EXPLAINER_STATE_FILE
      ? path.resolve(process.env.EXPLAINER_STATE_FILE)
      : path.join(__dirname, '..', 'state.json'),
    apply: false,
    lockWaitMs: DEFAULT_LOCK_WAIT_MS,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = (): string => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) usage(`${arg} needs a value`);
      i += 1;
      return next;
    };
    if (arg === '--apply') options.apply = true;
    else if (arg === '--state') options.stateFile = path.resolve(value());
    else if (arg === '--openai-account-scope') options.openaiAccountScope = value();
    else if (arg === '--lock-wait-ms') {
      options.lockWaitMs = Number(value());
      if (!Number.isFinite(options.lockWaitMs) || options.lockWaitMs < 0) usage('--lock-wait-ms must be a non-negative number');
    } else usage(`unknown argument ${arg}`);
  }
  return options;
}

function convert(bytes: Buffer, options: Options): ReturnType<typeof migrateStateV1> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${options.stateFile} is not valid JSON (${error instanceof Error ? error.message : String(error)}); nothing was changed.`);
  }
  return migrateStateV1(parsed, { openaiAccountScope: options.openaiAccountScope });
}

function printReport(file: string, report: MigrationReport, applied: boolean): void {
  console.log(`${applied ? 'Migrated' : 'Preview of'} ${file}${applied ? '' : ' (read-only; re-run with --apply to write)'}`);
  for (const row of report.batches) {
    const items = row.items
      ? Object.entries(row.items).map(([state, count]) => `${state}=${count}`).join(' ')
      : `${row.requests} v1 requests kept`;
    const status = row.migration_status ? ` ${row.migration_status}` : '';
    console.log(`  ${row.id}  ${row.disposition}${status}  provider=${row.provider ?? 'unknown'}  route=${row.route ?? 'null'}  [${items}]  ${row.reason}`);
  }
  console.log(`  file cache: ${report.file_cache.moved} moved to the OpenAI namespace, ${report.file_cache.retained_as_legacy} kept as unverified legacy entries`);
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.stateFile)) throw new Error(`${options.stateFile} does not exist; there is nothing to migrate.`);

  if (!options.apply) {
    printReport(options.stateFile, convert(fs.readFileSync(options.stateFile), options).report, false);
    return;
  }

  withStateLock(options.stateFile, () => {
    const original = fs.readFileSync(options.stateFile);
    const { state, report } = convert(original, options);
    state.revision = 1;
    const contents = serialiseStateV2(state);
    validateStateV2(JSON.parse(contents), `${options.stateFile} (converted)`);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${options.stateFile}.v1-backup-${stamp}-${process.pid}`;
    writeNewFileDurably(backup, original);
    replaceFileAtomically(options.stateFile, contents);
    printReport(options.stateFile, report, true);
    console.log(`  original bytes backed up to ${backup}`);
  }, { lockWaitMs: options.lockWaitMs });
}

try {
  main();
} catch (error) {
  const code = (error as { code?: unknown }).code;
  console.error(`migrate-state-v2: ${typeof code === 'string' ? `${code}: ` : ''}${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
