import { loadDotEnv } from './env';
import { preprocessInputs } from './preprocess';
import { submitBatch, pollAndRetrieve, printStatus, runSync } from './batch';
import { getProviderFromArgs, parseOpenAIAuthMode, type ProviderName } from './providers';

// Fill-only: never overrides a real shell export or an op-fetch injection.
loadDotEnv();

const COMMANDS = ['process', 'submit', 'poll', 'status'] as const;
type Command = typeof COMMANDS[number];

function usage(): void {
  console.log(`
Usage: npm run <command> [batch-id] [--provider claude|openai] [--sync]

  process          Full pipeline: preprocess PDFs → submit batch → poll → save JSON + deterministic HTML
  submit           Preprocess PDFs → submit batch only (returns batch ID, exits)
  poll [id]        Poll latest pending batch (or specific id) and save results when done
  status           Print status of all batches from state.json

Options:
  --provider claude|openai    Select provider (default: claude)
  --sync                      Synchronous mode. Claude: uses max-plan credits (CLAUDE_CODE_OAUTH_TOKEN).
                              OpenAI: uses API key or codex auth.
`);
}

function parseCommandArgs(command: Command): { provider: ProviderName; batchId?: string; providerExplicit: boolean; syncMode: boolean } {
  const args = process.argv.slice(3);
  const provider = getProviderFromArgs(args);
  const providerExplicit = args.includes('--provider') || Boolean(process.env.PROVIDER);
  const nonFlagArgs = args.filter(arg => !arg.startsWith('--') && arg !== 'claude' && arg !== 'openai');
  const batchId = command === 'poll' ? nonFlagArgs[0] : undefined;
  const syncMode = args.includes('--sync');
  return { provider, batchId, providerExplicit, syncMode };
}

function assertProviderAuth(provider: ProviderName, command: Command, syncMode: boolean): void {
  if (provider === 'claude') {
    const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
    const hasCliToken = Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN);
    if (!hasApiKey && !hasCliToken) {
      throw new Error(
        'Claude auth not configured. Set ANTHROPIC_API_KEY in .env.local, ' +
        'or export CLAUDE_CODE_OAUTH_TOKEN for max-plan sync mode.'
      );
    }
    if (!syncMode && !hasApiKey) {
      throw new Error(
        'Claude batch mode requires ANTHROPIC_API_KEY. ' +
        'Add --sync to use max-plan mode (CLAUDE_CODE_OAUTH_TOKEN) instead.'
      );
    }
    if (syncMode) {
      if (!hasCliToken) {
        throw new Error('Claude sync mode requires CLAUDE_CODE_OAUTH_TOKEN. Use batch mode for ANTHROPIC_API_KEY.');
      }
      if (hasApiKey) {
        throw new Error('Claude sync mode received both CLAUDE_CODE_OAUTH_TOKEN and ANTHROPIC_API_KEY. Run via process:secure:tmux or unset ANTHROPIC_API_KEY.');
      }
    }
  }
  if (provider === 'openai') {
    const mode = parseOpenAIAuthMode();
    if (mode === 'none') {
      throw new Error('OpenAI auth not configured. Set OPENAI_API_KEY in .env.local');
    }
    if (mode === 'codex_cli' && !syncMode) {
      throw new Error('OpenAI batch API requires OPENAI_API_KEY. Add --sync to use codex CLI sync mode instead.');
    }
  }
  if (command === 'submit' && syncMode) {
    throw new Error('--sync is only supported with "process". Use "process --sync" for synchronous execution.');
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] as Command | undefined;

  if (!command || !COMMANDS.includes(command as Command)) {
    usage();
    process.exit(1);
  }

  const parsed = parseCommandArgs(command);

  if (command === 'status') {
    printStatus(parsed.providerExplicit ? parsed.provider : undefined);
    return;
  }

  assertProviderAuth(parsed.provider, command, parsed.syncMode);

  if (command === 'poll') {
    console.log('\n── Poll ─────────────────────────────────────────');
    await pollAndRetrieve(parsed.provider, parsed.batchId);
    return;
  }

  console.log('\n── Preprocess ───────────────────────────────────');
  const items = await preprocessInputs();

  if (items.length === 0) {
    console.log('Nothing to process. Drop PDFs into input/ or add URLs to input/urls.txt');
    process.exit(0);
  }

  if (parsed.syncMode) {
    console.log('\n── Run sync ─────────────────────────────────────');
    const syncId = await runSync(parsed.provider, items);
    console.log(`\nSync run ID: ${syncId}`);
    return;
  }

  console.log('\n── Submit batch ─────────────────────────────────');
  const batchId = await submitBatch(parsed.provider, items);

  if (command === 'submit') {
    console.log(`\nBatch ID: ${batchId}`);
    console.log('Run "npm run poll -- --provider <claude|openai>" to retrieve results when ready.');
    return;
  }

  console.log('\n── Poll & retrieve ──────────────────────────────');
  await pollAndRetrieve(parsed.provider, batchId);
}

main().catch(err => {
  if (err instanceof Error) {
    console.error(`Error: ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
