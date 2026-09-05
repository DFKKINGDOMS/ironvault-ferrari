import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

function requireText(relativePath, expected, explanation) {
  if (!read(relativePath).includes(expected)) {
    throw new Error(`${relativePath}: ${explanation}`);
  }
}

const forbiddenPersonalIdentity = ['Kurt', 'White'].join(' ');
const personalIdentitySearch = spawnSync(
  'git',
  ['grep', '-n', '-F', forbiddenPersonalIdentity, '--', '.'],
  { cwd: repositoryRoot, encoding: 'utf8' }
);

if (personalIdentitySearch.status === 0) {
  throw new Error(`Hard-coded personal identity remains:\n${personalIdentitySearch.stdout.trim()}`);
}
if (personalIdentitySearch.status !== 1) {
  throw new Error(`Unable to scan tracked files: ${personalIdentitySearch.stderr.trim()}`);
}

requireText(
  'src/config.ts',
  "env.EBAY_ENV === 'production' && env.ALLOW_EBAY_WRITES",
  'production eBay-write refusal must remain executable'
);
requireText(
  '.github/workflows/azure-partquill-deploy.yml',
  'EBAY_MODE=mock',
  'Azure production must retain the mock eBay gateway'
);
requireText(
  '.github/workflows/azure-partquill-deploy.yml',
  'ALLOW_EBAY_WRITES=false',
  'Azure production must retain the global eBay write kill switch'
);
requireText(
  'docs/SAFETY_INVARIANTS.md',
  'Public publishing requires a preflight approval and a different public-approval action.',
  'the independent approval invariant is missing'
);
requireText(
  'docs/SAFETY_INVARIANTS.md',
  'Both approvals bind to the exact canonical SHA-256 hash and payload version.',
  'the exact-payload binding invariant is missing'
);
requireText(
  'docs/SAFETY_INVARIANTS.md',
  'A generated image derivative can improve presentation but cannot prove part identity, condition or fitment.',
  'the AI-image evidence boundary is missing'
);
requireText(
  'frontend/src/App.tsx',
  'bootstrap?.workspace?.displayName',
  'the account surface must use server-configured workspace identity'
);

process.stdout.write('Enterprise guardrails verified: neutral identity, fail-closed eBay writes, exact approvals, and evidence boundaries are intact.\n');
