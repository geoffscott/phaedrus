import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { config } from './env.js';

let installationOctokit: Octokit | null = null;

async function getOctokit(): Promise<Octokit> {
  if (installationOctokit) return installationOctokit;
  const auth = createAppAuth({
    appId: config.githubAppId,
    privateKey: config.githubAppPrivateKey,
  });
  const appOctokit = new Octokit({ authStrategy: createAppAuth, auth: { appId: config.githubAppId, privateKey: config.githubAppPrivateKey } });
  const { data: installation } = await appOctokit.rest.apps.getRepoInstallation({
    owner: config.ghOwner,
    repo: config.ghRepo,
  });
  const { token } = await auth({ type: 'installation', installationId: installation.id });
  installationOctokit = new Octokit({ auth: token });
  return installationOctokit;
}

async function getBaseSha(): Promise<string> {
  const octokit = await getOctokit();
  const { data } = await octokit.rest.repos.getBranch({
    owner: config.ghOwner,
    repo: config.ghRepo,
    branch: config.ghBranch,
  });
  return data.commit.sha;
}

export async function ensureBranch(branch: string): Promise<void> {
  const octokit = await getOctokit();
  try {
    await octokit.rest.repos.getBranch({ owner: config.ghOwner, repo: config.ghRepo, branch });
    return;
  } catch (err: any) {
    if (err.status !== 404) throw err;
  }
  const sha = await getBaseSha();
  await octokit.rest.git.createRef({
    owner: config.ghOwner,
    repo: config.ghRepo,
    ref: `refs/heads/${branch}`,
    sha,
  });
}

export async function getFile(path: string, ref: string): Promise<{ content: string; sha: string } | null> {
  const octokit = await getOctokit();
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: config.ghOwner,
      repo: config.ghRepo,
      path,
      ref,
    });
    if (Array.isArray(data) || data.type !== 'file') return null;
    const content = Buffer.from(data.content, data.encoding as BufferEncoding).toString('utf8');
    return { content, sha: data.sha };
  } catch (err: any) {
    if (err.status === 404) return null;
    throw err;
  }
}

export async function listDir(path: string, ref: string): Promise<Array<{ name: string; path: string }>> {
  const octokit = await getOctokit();
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: config.ghOwner,
      repo: config.ghRepo,
      path,
      ref,
    });
    if (!Array.isArray(data)) return [];
    return data.filter((d) => d.type === 'file').map((d) => ({ name: d.name, path: d.path }));
  } catch (err: any) {
    if (err.status === 404) return [];
    throw err;
  }
}

export async function putFile(opts: {
  path: string;
  branch: string;
  content: string | Buffer;
  message: string;
}): Promise<void> {
  const octokit = await getOctokit();
  const existing = await getFile(opts.path, opts.branch);
  const contentBase64 = Buffer.isBuffer(opts.content)
    ? opts.content.toString('base64')
    : Buffer.from(opts.content, 'utf8').toString('base64');
  await octokit.rest.repos.createOrUpdateFileContents({
    owner: config.ghOwner,
    repo: config.ghRepo,
    path: opts.path,
    message: opts.message,
    content: contentBase64,
    branch: opts.branch,
    sha: existing?.sha,
  });
}

export async function ensurePR(opts: {
  head: string;
  title: string;
  body: string;
}): Promise<{ number: number; url: string; created: boolean }> {
  const octokit = await getOctokit();
  const { data: existing } = await octokit.rest.pulls.list({
    owner: config.ghOwner,
    repo: config.ghRepo,
    head: `${config.ghOwner}:${opts.head}`,
    state: 'open',
  });
  if (existing.length > 0) {
    return { number: existing[0].number, url: existing[0].html_url, created: false };
  }
  const { data: pr } = await octokit.rest.pulls.create({
    owner: config.ghOwner,
    repo: config.ghRepo,
    head: opts.head,
    base: config.ghBranch,
    title: opts.title,
    body: opts.body,
  });
  return { number: pr.number, url: pr.html_url, created: true };
}
