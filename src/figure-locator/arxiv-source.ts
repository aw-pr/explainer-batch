import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { formatLabel, labelsEqual, parseLabel, LabelKey } from './label';
import { sniffImageType, imageSize, AssetExt } from './asset';

interface HtmlFigure { label: string; key: LabelKey; id: string; basename: string }
type FailureReason = 'disabled' | 'unavailable' | 'label-not-found' | 'no-asset' | 'multi-file' | 'eps-only';
type SourceResult = {
  ok: true; label: LabelKey; bytes: Buffer; ext: AssetExt; width?: number; height?: number;
  provenance: 'arxiv-source'; member: string; htmlId: string; notes: string[];
} | { ok: false; reason: FailureReason; notes: string[] };
interface SourceOptions {
  fetchBytes?: (url: string) => Promise<Buffer>;
  cacheRoot?: string;
  env?: Record<string, string | undefined>;
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match ? match[1] ?? match[2] ?? match[3] : null;
}

const basename = (file: string) => path.posix.parse(file.split(/[?#]/)[0]).name;

function captionText(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&(?:nbsp|#160|#x[aA]0);/g, ' ')
    .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

export function parseArxivHtmlFigures(html: string): HtmlFigure[] {
  const figures: HtmlFigure[] = [];
  for (const match of html.matchAll(/<figure\b([^>]*)>([\s\S]*?)<\/figure\s*>/gi)) {
    const id = attribute(` ${match[1]}`, 'id') ?? '';
    const body = match[2];
    const caption = /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption\s*>/i.exec(body);
    let key = caption ? parseLabel(captionText(caption[1])) : null;
    if (!key) {
      const fallback = /^(?:S\d+(?:\.\d+)*|A\d+)\.([FT])(\d+)$/.exec(id);
      if (fallback) key = { noun: fallback[1] === 'F' ? 'Figure' : 'Table', number: fallback[2] };
    }
    const firstAsset = (tag: string, attr: string) => {
      for (const hit of body.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'gi'))) {
        const value = attribute(hit[0], attr);
        if (value) return value;
      }
      return null;
    };
    const asset = firstAsset('object', 'data') ?? firstAsset('img', 'src');
    if (key && asset) figures.push({ label: formatLabel(key), key, id, basename: basename(asset) });
  }
  return figures;
}

export function includeGraphicsEnvironments(files: Array<{ path: string; text: string }>): Array<{ path: string; files: string[] }> {
  const environments: Array<{ path: string; files: string[] }> = [];
  for (const file of files) {
    const text = file.text.replace(/(?<!\\)%[^\r\n]*/g, '');
    for (const env of text.matchAll(/\\begin\s*\{(figure\*?|table\*?)\}([\s\S]*?)\\end\s*\{\1\}/g)) {
      const includes = Array.from(env[2].matchAll(/\\includegraphics\*?\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g), m => m[1].trim());
      if (includes.length) environments.push({ path: file.path, files: includes });
    }
  }
  return environments;
}

export function resolveIncludePath(arg: string, members: string[]): string | null {
  const clean = (name: string) => name.replace(/^(?:\.\/)+/, '');
  const name = clean(arg);
  const candidates = path.posix.extname(name) ? [name] : ['.pdf', '.png', '.jpg', '.jpeg', '.eps'].map(ext => name + ext);
  for (const candidate of candidates) {
    const member = members.find(entry => clean(entry) === candidate);
    if (member !== undefined) return member;
  }
  return null;
}

async function fetchBytes(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function arxivSourceFigure(id: string, label: LabelKey, opts: SourceOptions = {}): Promise<SourceResult> {
  const fail = (reason: FailureReason, note?: string): SourceResult => ({ ok: false, reason, notes: note ? [note] : [] });
  if ((opts.env ?? process.env).FIGURE_ARXIV_SOURCE === '0') return fail('disabled');
  const dir = path.join(opts.cacheRoot ?? path.join(__dirname, '../../state/cache/arxiv'), id);
  const cached = async (name: string, url: string) => {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) return fs.readFileSync(file);
    const bytes = await (opts.fetchBytes ?? fetchBytes)(url);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, bytes);
    return bytes;
  };
  let figures: HtmlFigure[];
  let archive: Buffer;
  try {
    figures = parseArxivHtmlFigures((await cached('html.html', `https://arxiv.org/html/${id}`)).toString('utf8'));
    fs.writeFileSync(path.join(dir, 'mapping.json'), JSON.stringify(Object.fromEntries(
      figures.map(figure => [figure.label, { id: figure.id, basename: figure.basename }]),
    ), null, 2));
    if (!figures.some(figure => labelsEqual(figure.key, label))) return fail('label-not-found');
    archive = await cached('eprint.tar.gz', `https://arxiv.org/e-print/${id}`);
  } catch (error) {
    return fail('unavailable', `arxiv-source: unavailable (${error instanceof Error ? error.message : String(error)})`);
  }
  const figure = figures.find(entry => labelsEqual(entry.key, label))!;
  let tmp: string | undefined;
  let operation = 'temporary directory';
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxiv-source-'));
    const tarball = path.join(tmp, 'eprint.tar.gz');
    fs.writeFileSync(tarball, archive);
    operation = 'tar listing';
    const members = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split(/\r?\n/).filter(Boolean);
    if (members.some(member => path.posix.isAbsolute(member) || member.split('/').includes('..'))) throw new Error('unsafe archive member');
    const root = path.join(tmp, 'source');
    fs.mkdirSync(root);
    operation = 'tar extraction';
    execFileSync('tar', ['-xzf', tarball, '-C', root], { stdio: 'pipe' });
    const realRoot = fs.realpathSync(root);
    const memberPath = (member: string) => {
      const resolved = fs.realpathSync(path.join(root, member));
      if (!resolved.startsWith(realRoot + path.sep)) throw new Error('member outside extraction directory');
      return resolved;
    };
    const tex = members.filter(member => member.endsWith('.tex')).map(member => {
      operation = `read member ${member}`;
      return { path: member, text: fs.readFileSync(memberPath(member), 'utf8') };
    });
    const env = includeGraphicsEnvironments(tex).find(entry => entry.files.some(file => basename(file) === figure.basename));
    if (!env) return fail('no-asset', 'arxiv-source: no matching includegraphics environment');
    let arg = env.files[0];
    if (env.files.length > 1) {
      const index = label.panel && /^[a-z]$/.test(label.panel) ? label.panel.charCodeAt(0) - 97 : -1;
      if (index < 0 || index >= env.files.length) return fail('multi-file');
      arg = env.files[index];
    }
    const member = resolveIncludePath(arg, members);
    if (!member) return fail('no-asset', `arxiv-source: unresolved include ${arg}`);
    const extension = path.posix.extname(member).toLowerCase();
    if (extension === '.eps') return fail('eps-only');
    if (!['.pdf', '.png', '.jpg', '.jpeg'].includes(extension)) return fail('no-asset', `arxiv-source: unsupported asset ${member}`);
    operation = `read member ${member}`;
    const file = memberPath(member);
    let bytes: Buffer;
    if (extension === '.pdf') {
      operation = `render member ${member}`;
      const prefix = path.join(tmp, 'render');
      execFileSync('pdftoppm', ['-jpeg', '-jpegopt', 'quality=90', '-r', '300', '-f', '1', '-l', '1', '-singlefile', file, prefix], { stdio: 'pipe' });
      bytes = fs.readFileSync(prefix + '.jpg');
    } else bytes = fs.readFileSync(file);
    const ext = sniffImageType(bytes);
    if (!ext) return fail('no-asset', `arxiv-source: unrecognised image ${member}`);
    return {
      ok: true, label: { ...figure.key, ...(label.panel && { panel: label.panel }) }, bytes, ext,
      ...imageSize(bytes), provenance: 'arxiv-source', member, htmlId: figure.id, notes: [],
    };
  } catch (error) {
    return fail('no-asset', `arxiv-source: ${operation} failed (${error instanceof Error ? error.message : String(error)})`);
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}
