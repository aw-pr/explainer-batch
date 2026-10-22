// Contract test for stage-cards/44-migrate-v1-reads-organisation-and-dated-references.md.
// Run: TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test tests/contract/44-migrate-v1-reads-organisation-and-dated-references.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');

// AUTOMETTA-CONTRACT-BEGIN card=stage-cards/44-migrate-v1-reads-organisation-and-dated-references.md
const NO_IO = { listing: [] as string[], bytes: (_: string) => undefined as Uint8Array | undefined };
const PARTIAL = 'references[0]: partial APA parse';

const CCAF = 'Cambridge Centre for Alternative Finance (2026). <em>The 2026 Global AI in Financial Services Report: Adoption, impact and risks</em>. University of Cambridge Judge Business School, in partnership with BIS, IMF, WEF, IDB, CGAP and AMF, with support from the UK FCDO. <a href="https://www.jbs.cam.ac.uk/faculty-research/centres/alternative-finance/" target="_blank" rel="noopener noreferrer">https://www.jbs.cam.ac.uk/faculty-research/centres/alternative-finance/</a>';
const SAFETY = 'International AI Safety Report authors. (2026, February). <em>International AI Safety Report</em> (2nd ed.). Evidence synthesis on frontier general-purpose AI, emerging risks, capability trends, and governance implications. Link not provided in the extracted notes; consult the official report landing page or publisher repository for the definitive version.';
const IBM = 'Mandelbaum, R., Gambetta, J., Chow, J., Mittal, T., Yoder, T. J., Cross, A., & Steffen, M. (2025, June 10). How IBM will build the world\'s first large-scale, fault-tolerant quantum computer. <em>IBM Quantum Blog</em>. <a href="https://www.ibm.com/quantum/blog/large-scale-ftqc" target="_blank" rel="noopener noreferrer">https://www.ibm.com/quantum/blog/large-scale-ftqc</a>';
const ANTHROPIC = 'Anthropic. (2026, June 16). <em>Agentic coding and persistent returns to expertise</em>. <a href="https://www.anthropic.com/research/claude-code-expertise" target="_blank" rel="noopener noreferrer">https://www.anthropic.com/research/claude-code-expertise</a>';
const JUMPER = 'Jumper, J., et al. (2021). Highly accurate protein structure prediction with AlphaFold. <em>Nature</em>. <a href="https://doi.org/10.1038/s41586-021-03819-2" target="_blank" rel="noopener noreferrer">https://doi.org/10.1038/s41586-021-03819-2</a>';
const CHEN = 'Chen, K., Patel, D., Nishball, D., et al. (2025). InferenceMAX: Open Source Inference Benchmarking. <em>SemiAnalysis</em>. <a href="https://newsletter.semianalysis.com/p/inferencemax-open-source-inference" target="_blank" rel="noopener noreferrer">https://newsletter.semianalysis.com/p/inferencemax-open-source-inference</a>';
const LI = 'Li, H., Zhang, H., & Hassan, A. E. (2025). The Rise of AI Teammates in Software Engineering (SE) 3.0: How Autonomous Coding Agents Are Reshaping Software Engineering. <em>arXiv preprint arXiv:2507.15003</em>. <a href="https://arxiv.org/abs/2507.15003" target="_blank" rel="noopener noreferrer">https://arxiv.org/abs/2507.15003</a>';
const GABISON = 'Gabison, G. A., & Xian, R. P. (2025). Inherent and emergent liability issues in LLM-based agentic systems: a principal-agent perspective. <em>arXiv preprint</em>, arXiv:2504.03255v2. <a href="https://arxiv.org/abs/2504.03255" target="_blank" rel="noopener noreferrer">https://arxiv.org/abs/2504.03255</a>';
const SMITH = 'Smith, J. (2026). Agent costs in practice. Journal of Agents, 4(2), 1-20.';
const UNKNOWN = 'Research paper details were not included in the supplied extraction. <a href="https://example.com" target="_blank" rel="noopener noreferrer">Source link unavailable</a>';

function v1(ref: string, slug = '2026-05-01_smith_agent-costs_explainer'): Record<string, any> {
  return {
    version: 1,
    metadata: { title: 'Agent Costs: Smith (2026)', eyebrow: 'Research Explainer · Smith (2026)', date_created: '2026-05-01', filename_slug: slug },
    hero: { headline: 'Agents cut costs by a third', subtitle: 'What the study found.' },
    top_block: { kind: 'pills', pills: [{ number: '33%', description: 'Lower cost' }, { number: '2x', description: 'Faster' }] },
    sections: [{ label: 'Why', paragraphs: ['Costs fell.'] }, { label: 'How', paragraphs: ['Three steps.'] }],
    end_takeaway: { label: 'So what', body: 'Cheaper and faster.' },
    references: [ref],
  };
}

function migrated(ref: string, slug?: string): { ref: Record<string, any>; issues: string[] } {
  const r = (require('../../contract/migrate-v1') as Record<string, any>).migrateV1(v1(ref, slug), NO_IO);
  assert.equal(r.ok, true, `migrateV1 must succeed: ${r.reason ?? ''}`);
  const parsed = (require('../../contract/explainer-v2') as Record<string, any>).ExplainerV2.safeParse(r.explainer);
  assert.ok(parsed.success, `the result must parse as ExplainerV2: ${JSON.stringify(parsed.error?.issues ?? []).slice(0, 400)}`);
  return { ref: r.explainer.references[0], issues: r.explainer.metadata.quality?.issues ?? [] };
}

function eyebrowOf(ref: Record<string, any>): string {
  return (require('../../contract/derive') as Record<string, any>).eyebrow(ref);
}

function families(ref: Record<string, any>): string[] {
  return ref.authors.map((a: Record<string, any>) => a.family);
}

test('an organisation author keeps its full name and year, with no partial-parse issue', () => {
  const { ref, issues } = migrated(CCAF, '2026-05-08_ccaf_global-ai-financial-services_explainer');
  assert.deepEqual(ref.authors, [{ family: 'Cambridge Centre for Alternative Finance' }]);
  assert.equal(ref.year, 2026);
  assert.equal(ref.title, 'The 2026 Global AI in Financial Services Report: Adoption, impact and risks');
  assert.equal(ref.url, 'https://www.jbs.cam.ac.uk/faculty-research/centres/alternative-finance/');
  assert.equal(eyebrowOf(ref), 'Research Explainer · Cambridge Centre for Alternative Finance (2026)');
  assert.ok(!issues.includes(PARTIAL), 'an organisation author is a full parse');
});

test('an organisation followed by a full stop and a dated year parses, and a title ending in "ed.)" is not cut short', () => {
  const { ref, issues } = migrated(SAFETY, '2026-04-05_expert_international-ai-safety-report_explainer');
  assert.deepEqual(ref.authors, [{ family: 'International AI Safety Report authors' }]);
  assert.equal(ref.year, 2026);
  assert.equal(ref.title, 'International AI Safety Report (2nd ed.)');
  assert.equal(eyebrowOf(ref), 'Research Explainer · International AI Safety Report authors (2026)');
  assert.ok(!issues.includes(PARTIAL));
});

test('a year carrying a month and day parses for a person list and an organisation alike', () => {
  const ibm = migrated(IBM, '2026-04-29_ibm_fault-tolerant-quantum-roadmap_explainer');
  assert.deepEqual(families(ibm.ref), ['Mandelbaum', 'Gambetta', 'Chow', 'Mittal', 'Yoder', 'Cross', 'Steffen']);
  assert.equal(ibm.ref.authors[6].given, 'M.');
  assert.equal(ibm.ref.year, 2025);
  assert.equal(ibm.ref.title, 'How IBM will build the world\'s first large-scale, fault-tolerant quantum computer');
  assert.equal(ibm.ref.venue, 'IBM Quantum Blog');
  assert.equal(eyebrowOf(ibm.ref), 'Research Explainer · Mandelbaum et al. (2025)');
  assert.ok(!ibm.issues.includes(PARTIAL));
  const anthropic = migrated(ANTHROPIC, '2026-06-19_anthropic_agentic-coding-expertise_explainer');
  assert.deepEqual(anthropic.ref.authors, [{ family: 'Anthropic' }]);
  assert.equal(anthropic.ref.year, 2026);
  assert.equal(anthropic.ref.title, 'Agentic coding and persistent returns to expertise');
  assert.equal(eyebrowOf(anthropic.ref), 'Research Explainer · Anthropic (2026)');
  assert.ok(!anthropic.issues.includes(PARTIAL));
});

test('a trailing "et al." is dropped from the author list and never parsed as a name', () => {
  const jumper = migrated(JUMPER, '2026-07-16_jumper_alphafold-protein-structure_explainer');
  assert.deepEqual(jumper.ref.authors, [{ family: 'Jumper', given: 'J.' }]);
  assert.equal(jumper.ref.year, 2021);
  assert.equal(eyebrowOf(jumper.ref), 'Research Explainer · Jumper (2021)');
  const chen = migrated(CHEN, '2026-04-19_chen_inferencemax-benchmark_explainer');
  assert.deepEqual(chen.ref.authors, [{ family: 'Chen', given: 'K.' }, { family: 'Patel', given: 'D.' }, { family: 'Nishball', given: 'D.' }]);
  assert.equal(eyebrowOf(chen.ref), 'Research Explainer · Chen et al. (2025)');
  const noComma = migrated('Smith, J. et al. (2021). A large collaboration. <em>Nature</em>.');
  const noStop = migrated('Smith, J., & Jones, K., et al (2021). A large collaboration. <em>Nature</em>.');
  assert.deepEqual(noComma.ref.authors, [{ family: 'Smith', given: 'J.' }], '"et al." with no comma before it');
  assert.deepEqual(noStop.ref.authors, [{ family: 'Smith', given: 'J.' }, { family: 'Jones', given: 'K.' }], '"et al" with no full stop');
  for (const r of [jumper.ref, chen.ref, noComma.ref, noStop.ref]) {
    for (const a of r.authors) assert.ok(!/et al/.test(`${a.family} ${a.given ?? ''}`), `no author carries "et al.": ${JSON.stringify(a)}`);
  }
});

test('a title runs to the first full stop followed by a space, so "3.0" stays in it', () => {
  const { ref } = migrated(LI, '2026-04-18_li_ai-teammates-se3_explainer');
  assert.equal(ref.title, 'The Rise of AI Teammates in Software Engineering (SE) 3.0: How Autonomous Coding Agents Are Reshaping Software Engineering');
  assert.equal(ref.venue, 'arXiv preprint arXiv:2507.15003');
  const last = migrated('Smith, J. (2026). Version 2.1 of the agent survey.');
  assert.equal(last.ref.title, 'Version 2.1 of the agent survey', 'a full stop that ends the text ends the title');
  assert.equal(last.ref.venue, undefined, 'no venue when nothing follows the title');
  const newline = migrated('Smith, J. (2026). A survey.\nJournal of Agents.');
  assert.equal(newline.ref.title, 'A survey', 'a full stop followed by a newline ends the title');
  assert.equal(newline.ref.venue, 'Journal of Agents');
});

test('references that parsed before parse exactly as before', () => {
  const smith = migrated(SMITH);
  assert.deepEqual(smith.ref, { authors: [{ family: 'Smith', given: 'J.' }], year: 2026, title: 'Agent costs in practice', venue: 'Journal of Agents, 4(2), 1-20', origin: 'legacy' });
  const gabison = migrated(GABISON, '2026-04-14_gabison_llm-agent-liability_explainer');
  assert.deepEqual(gabison.ref, {
    authors: [{ family: 'Gabison', given: 'G. A.' }, { family: 'Xian', given: 'R. P.' }],
    year: 2025,
    title: 'Inherent and emergent liability issues in LLM-based agentic systems: a principal-agent perspective',
    venue: 'arXiv preprint, arXiv:2504.03255v2',
    url: 'https://arxiv.org/abs/2504.03255',
    origin: 'legacy',
  });
  assert.equal(eyebrowOf(gabison.ref), 'Research Explainer · Gabison and Xian (2025)');
});

test('a reference with no author and no year is still a partial parse with the slug fallback', () => {
  const { ref, issues } = migrated(UNKNOWN, '2026-07-31_ai-coding_software-production_explainer');
  assert.ok(issues.includes(PARTIAL), 'the partial-parse issue is still recorded');
  assert.deepEqual(ref.authors, [{ family: 'Ai-coding' }]);
  assert.equal(ref.year, undefined);
  assert.equal(ref.url, 'https://example.com');
});

test('the unit tests carry a fixture for each new case', () => {
  const fixtures = path.join(REPO_ROOT, 'tests', 'unit', 'fixtures', 'v1');
  for (const f of ['reference-organisation.json', 'reference-dated-year.json', 'reference-et-al.json']) {
    const p = path.join(fixtures, f);
    assert.ok(fs.existsSync(p), `tests/unit/fixtures/v1/${f} must exist`);
    const fixture = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(fixture.ok, true, `${f} must be a fixture that migrates`);
    assert.ok(fixture.input && typeof fixture.input === 'object', `${f} must carry an input document`);
    assert.equal(typeof fixture.expected?.['references.0.authors.0.family'], 'string', `${f} must expect the first author's family`);
    assert.equal(typeof fixture.expected?.['references.0.year'], 'number', `${f} must expect the year`);
  }
});

test('the contract revision stays 1, derive.ts is untouched, and the generated files match the source', () => {
  assert.equal((require('../../contract/explainer-v2') as Record<string, any>).CONTRACT_REVISION, 1);
  const sha = (f: string) => createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT, 'contract', f))).digest('hex');
  assert.equal(sha('derive.ts'), 'cc538e029bcc3d0b81b664bf62530ec3ade45ee6722e6b80e8e5f2c6156e541f', 'contract/derive.ts is unchanged');
  assert.equal(sha('explainer-v2.ts'), '95b5a134446cd99d68af8d70f4c57a15bbaae314c4ef14498236884d2a2e7910', 'contract/explainer-v2.ts is unchanged');
  const r = spawnSync('npm', ['run', '-s', 'contract:check'], { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, WEBSITE_REPO: '' } });
  assert.equal(r.status, 0, `contract:check must pass: ${r.stdout}${r.stderr}`);
});
// AUTOMETTA-CONTRACT-END
