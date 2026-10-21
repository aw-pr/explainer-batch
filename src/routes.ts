import { LlmContractError } from './llm-contract';
import type { ProviderId, Route } from './llm-contract';

export type CredentialKind = 'anthropic-api-key' | 'claude-oauth-token'
  | 'openai-api-key' | 'codex-chatgpt-login' | 'gemini-api-key';

export interface CredentialInventory {
  kinds: Partial<Record<CredentialKind, 'present' | 'wrong-kind'>>;
  codexAuth?: 'chatgpt' | 'api-key' | 'missing' | 'malformed';
  read(kind: CredentialKind): string;
}

export interface CredentialBinding {
  readonly provider: ProviderId;
  readonly route: Route;
  readonly surface: 'anthropic-api-sdk' | 'claude-agent-sdk' | 'openai-api' | 'codex-cli';
  readonly credentialKind: CredentialKind;
  credential(): string;
}

type Environment = Readonly<Record<string, string | undefined>>;

const PREFERENCE_TOKENS: Readonly<Record<string, Route>> = {
  batch: 'batch-api', subscription: 'subscription-cli', api: 'sync-api',
};
const CREDENTIAL_VARIABLES: Partial<Record<CredentialKind, string>> = {
  'anthropic-api-key': 'ANTHROPIC_API_KEY',
  'claude-oauth-token': 'CLAUDE_CODE_OAUTH_TOKEN',
  'openai-api-key': 'OPENAI_API_KEY',
  'gemini-api-key': 'GEMINI_API_KEY',
};

export function parseRoutePreference(value: string | undefined): Route[] {
  if (value === undefined) return ['batch-api', 'subscription-cli', 'sync-api'];
  const routes: Route[] = [];
  for (const token of value.split(',').map(part => part.trim().toLowerCase())) {
    const route = Object.hasOwn(PREFERENCE_TOKENS, token) ? PREFERENCE_TOKENS[token] : undefined;
    if (!route || routes.includes(route)) {
      throw new LlmContractError('INVALID_ROUTE_PREFERENCE', 'Route preference needs unique batch, subscription or api tokens.');
    }
    routes.push(route);
  }
  return routes;
}

export function resolveCredentialBinding(
  provider: string, route: Route, inventory: CredentialInventory,
): CredentialBinding {
  if (provider === 'gemini') {
    throw new LlmContractError('PROVIDER_DISABLED', 'Gemini routes are not enabled.');
  }
  if (provider !== 'claude' && provider !== 'openai') {
    throw new LlmContractError('UNKNOWN_PROVIDER', 'Provider is not recognised.');
  }
  if (!['batch-api', 'sync-api', 'subscription-cli'].includes(route)) {
    throw new LlmContractError('ROUTE_UNSUPPORTED', 'Provider route is not supported.');
  }

  const subscription = route === 'subscription-cli';
  const credentialKind: CredentialKind = provider === 'claude'
    ? subscription ? 'claude-oauth-token' : 'anthropic-api-key'
    : subscription ? 'codex-chatgpt-login' : 'openai-api-key';
  const surface: CredentialBinding['surface'] = provider === 'claude'
    ? subscription ? 'claude-agent-sdk' : 'anthropic-api-sdk'
    : subscription ? 'codex-cli' : 'openai-api';

  if (credentialKind === 'codex-chatgpt-login') {
    if (inventory.codexAuth !== 'chatgpt' || inventory.kinds[credentialKind] === 'wrong-kind') {
      throw new LlmContractError('CODEX_AUTH_NOT_SUBSCRIPTION', 'Codex subscription requires a valid ChatGPT login; configure an explicit API key for API routes.');
    }
  } else {
    if (credentialKind === 'anthropic-api-key' && inventory.kinds[credentialKind] === 'wrong-kind') {
      throw new LlmContractError('CLAUDE_OAUTH_WRONG_SURFACE', 'Claude OAuth cannot be used with the Anthropic API SDK.');
    }
    if (inventory.kinds[credentialKind] !== 'present') {
      throw new LlmContractError('MISSING_ROUTE_CREDENTIAL', 'The selected route requires its own valid credential.');
    }
  }

  return Object.freeze({
    provider, route, surface, credentialKind,
    credential: () => inventory.read(credentialKind),
  });
}

export function assertSingleCredential(binding: CredentialBinding, env: Environment): void {
  const own = CREDENTIAL_VARIABLES[binding.credentialKind];
  const variables = [
    ...Object.values(CREDENTIAL_VARIABLES), 'ANTHROPIC_AUTH_TOKEN',
    'CODEX_API_KEY', 'OP_SERVICE_ACCOUNT_TOKEN',
  ];
  if (variables.some(variable => variable !== own && env[variable] !== undefined)) {
    throw new LlmContractError('MIXED_BILLING_CREDENTIALS', 'Environment contains a credential outside the selected binding.');
  }
}

export function childEnvironment(binding: CredentialBinding, parentEnv: Environment): Record<string, string> {
  if (binding.route !== 'subscription-cli') {
    throw new LlmContractError('ROUTE_UNSUPPORTED', 'Only subscription bindings use a child environment.');
  }
  const allowed = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ'];
  if (binding.surface === 'codex-cli') allowed.push('CODEX_HOME');
  const child: Record<string, string> = {};
  for (const key of allowed) {
    if (parentEnv[key] !== undefined) child[key] = parentEnv[key];
  }
  if (binding.surface === 'claude-agent-sdk') {
    child.CLAUDE_CODE_OAUTH_TOKEN = binding.credential();
  }
  assertSingleCredential(binding, child);
  return child;
}
