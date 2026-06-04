function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}
function opt(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

// Back-compat: previously this service was deployed with GH_REPO=<name>.
// That env var collides with the gh CLI; we now use CONTENT_REPO. Accept
// either so existing Cloud Run revisions don't break on rolling restart.
const contentRepo = process.env.CONTENT_REPO || process.env.GH_REPO;
if (!contentRepo) throw new Error('Missing env: CONTENT_REPO (or legacy GH_REPO)');

export const config = {
  ghOwner: req('GH_OWNER'),
  ghRepo: contentRepo,
  ghBranch: opt('GH_BRANCH', 'main'),
  postsDir: opt('POSTS_DIR', '_posts'),
  authorsDir: opt('AUTHORS_DIR', '_authors'),
  authorsData: opt('AUTHORS_DATA', '_data/authors.yml'),
  imagesDir: opt('IMAGES_DIR', 'assets/images/posts'),
  taxonomyTerms: opt('TAXONOMY_TERMS', '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean),
  taxonomyKey: opt('TAXONOMY_KEY', 'lens'),
  toolPrefix: opt('TOOL_PREFIX', 'post_'),
  githubAppId: req('GITHUB_APP_ID'),
  githubAppPrivateKey: req('GITHUB_APP_PRIVATE_KEY'),
  port: Number(opt('PORT', '8080')),
};

export type Config = typeof config;
