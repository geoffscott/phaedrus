function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}
function opt(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const config = {
  ghOwner: req('GH_OWNER'),
  ghRepo: req('GH_REPO'),
  ghBranch: opt('GH_BRANCH', 'main'),
  postsDir: opt('POSTS_DIR', '_posts'),
  authorsDir: opt('AUTHORS_DIR', '_authors'),
  authorsData: opt('AUTHORS_DATA', '_data/authors.yml'),
  imagesDir: opt('IMAGES_DIR', 'assets/images/posts'),
  taxonomyTerms: opt('TAXONOMY_TERMS', '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean),
  toolPrefix: opt('TOOL_PREFIX', 'post_'),
  githubAppId: req('GITHUB_APP_ID'),
  githubAppPrivateKey: req('GITHUB_APP_PRIVATE_KEY'),
  port: Number(opt('PORT', '8080')),
};

export type Config = typeof config;
