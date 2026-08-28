import type { CommunityArchivePublisher } from './types.js';

type JsonObject = Record<string, unknown>;

async function responseJson(response: Response): Promise<JsonObject> {
  const payload = await response.json().catch(() => ({})) as JsonObject;
  if (!response.ok) {
    const message = typeof payload.message === 'string' ? payload.message : `GitHub archive request failed with ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

export class GitHubCommunityArchive implements CommunityArchivePublisher {
  readonly available: boolean;

  constructor(
    private readonly repository: string,
    private readonly branch: string,
    private readonly token?: string,
    private readonly fetcher: typeof fetch = fetch
  ) {
    this.available = Boolean(repository && branch && token);
  }

  private request(path: string, init?: RequestInit): Promise<Response> {
    return this.fetcher(`https://api.github.com/repos/${this.repository}${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
        'user-agent': 'PartQuill-Community-Archive/1.0',
        'x-github-api-version': '2022-11-28',
        ...init?.headers
      }
    });
  }

  async publish(input: { submissionId: string; contributorCredit: string; files: Array<{ path: string; bytes: Uint8Array }> }): Promise<{ commitSha: string }> {
    if (!this.available) throw new Error('GitHub community archive is not activated');
    const ref = await responseJson(await this.request(`/git/ref/heads/${encodeURIComponent(this.branch)}`));
    const parentSha = (ref.object as JsonObject | undefined)?.sha;
    if (typeof parentSha !== 'string') throw new Error('GitHub archive branch has no commit SHA');
    const parent = await responseJson(await this.request(`/git/commits/${parentSha}`));
    const baseTree = (parent.tree as JsonObject | undefined)?.sha;
    if (typeof baseTree !== 'string') throw new Error('GitHub archive commit has no tree SHA');
    const blobs = await Promise.all(input.files.map(async (file) => {
      const blob = await responseJson(await this.request('/git/blobs', {
        method: 'POST',
        body: JSON.stringify({ content: Buffer.from(file.bytes).toString('base64'), encoding: 'base64' })
      }));
      if (typeof blob.sha !== 'string') throw new Error('GitHub archive blob has no SHA');
      return { path: file.path, mode: '100644', type: 'blob', sha: blob.sha };
    }));
    const tree = await responseJson(await this.request('/git/trees', {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseTree, tree: blobs })
    }));
    if (typeof tree.sha !== 'string') throw new Error('GitHub archive tree has no SHA');
    const commit = await responseJson(await this.request('/git/commits', {
      method: 'POST',
      body: JSON.stringify({
        message: `Archive rights-cleared community images (${input.submissionId.slice(0, 8)})`,
        tree: tree.sha,
        parents: [parentSha],
        author: { name: 'PartQuill Community Archive', email: 'archive@partquill.com' },
        committer: { name: 'PartQuill Community Archive', email: 'archive@partquill.com' }
      })
    }));
    if (typeof commit.sha !== 'string') throw new Error('GitHub archive commit has no SHA');
    await responseJson(await this.request(`/git/refs/heads/${encodeURIComponent(this.branch)}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false })
    }));
    return { commitSha: commit.sha };
  }
}

export class DisabledCommunityArchive implements CommunityArchivePublisher {
  readonly available = false;
  async publish(): Promise<{ commitSha: string }> { throw new Error('GitHub community archive is not activated'); }
}
