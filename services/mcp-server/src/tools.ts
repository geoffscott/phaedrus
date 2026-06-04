import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from './env.js';
import {
  ensureBranch,
  ensurePR,
  getFile,
  listDir,
  putFile,
} from './github.js';
import { renderFrontMatter, splitFrontMatter } from './frontmatter.js';

const slugRe = /^[a-z0-9][a-z0-9\-]*[a-z0-9]$/;
const isoDateRe = /^\d{4}-\d{2}-\d{2}$/;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function postPath(date: string, slug: string): string {
  return `${config.postsDir}/${date}-${slug}.md`;
}

function branchFor(slug: string): string {
  return `phaedrus/post/${slug}`;
}

function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

// Parse the curated tag vocabulary (_data/tags.yml). Tolerates both the seeded
// `- name: Foo` form and a bare `- Foo` list, mirroring the naive parsing used
// elsewhere in this service.
function parseKnownTags(yamlText: string): Set<string> {
  const tags = new Set<string>();
  for (const line of yamlText.split('\n')) {
    const m = line.match(/^\s*-\s*(?:name:\s*)?(.+?)\s*$/);
    if (m) {
      const v = m[1].replace(/^["']|["']$/g, '').trim();
      if (v) tags.add(v);
    }
  }
  return tags;
}

// Returns the submitted tags that aren't in the curated vocabulary, or null when
// no vocabulary file exists yet (so we don't block before one is set up).
async function unknownTags(tags: string[], ref: string): Promise<string[] | null> {
  const file = await getFile(config.tagsData, ref);
  if (!file) return null;
  const known = parseKnownTags(file.content);
  if (known.size === 0) return null;
  return tags.filter((t) => !known.has(t));
}

function unknownTagsError(unknown: string[]) {
  return jsonResult({
    error: 'unknown_tags',
    unknown,
    hint: `Tags must exist in ${config.tagsData}. Add them there in a PR before using them on a post.`,
  });
}

export function registerTools(server: McpServer): void {
  const p = config.toolPrefix;

  server.tool(
    `${p}list`,
    'List recent posts on the default branch.',
    { limit: z.number().int().min(1).max(200).optional() },
    async ({ limit }) => {
      const files = await listDir(config.postsDir, config.ghBranch);
      const posts = files
        .filter((f) => f.name.endsWith('.md') || f.name.endsWith('.markdown'))
        .sort((a, b) => b.name.localeCompare(a.name))
        .slice(0, limit ?? 50)
        .map((f) => ({ path: f.path, name: f.name }));
      return jsonResult({ posts });
    }
  );

  server.tool(
    `${p}get`,
    'Get a post by path. Returns front matter and body.',
    { path: z.string(), ref: z.string().optional() },
    async ({ path, ref }) => {
      const file = await getFile(path, ref ?? config.ghBranch);
      if (!file) return jsonResult({ error: 'not_found', path });
      const { data, body } = splitFrontMatter(file.content);
      return jsonResult({ path, data, body });
    }
  );

  server.tool(
    `${p}create`,
    'Create a new post and open a PR for review. Returns the PR URL.',
    {
      slug: z.string().regex(slugRe, 'lowercase letters, digits, hyphens; no leading/trailing hyphen'),
      title: z.string().min(1),
      excerpt: z.string().min(1, 'teaser + SEO meta description (1–2 sentences)'),
      body: z.string().min(1, 'post body in Markdown'),
      author: z.string().min(1, 'author id (matches _data/authors.yml / _authors/)'),
      tags: z.array(z.string().min(1)).min(1, 'at least one tag from the curated vocabulary'),
      description: z.string().optional(),
      date: z.string().regex(isoDateRe, 'YYYY-MM-DD').optional(),
      draft: z.boolean().optional(),
    },
    async (args) => {
      const date = args.date ?? todayIso();
      const branch = branchFor(args.slug);
      const path = postPath(date, args.slug);
      await ensureBranch(branch);

      const existing = await getFile(path, branch);
      if (existing) {
        return jsonResult({ error: 'already_exists', path, branch });
      }

      const unknown = await unknownTags(args.tags, config.ghBranch);
      if (unknown && unknown.length) return unknownTagsError(unknown);

      const fm: Record<string, string | string[] | boolean> = {
        title: args.title,
        date,
        author: args.author,
        excerpt: args.excerpt,
        tags: args.tags,
      };
      if (args.description) fm.description = args.description;
      if (args.draft) fm.published = false;

      const content = renderFrontMatter(fm, args.body);
      await putFile({
        path,
        branch,
        content,
        message: `phaedrus: add post "${args.title}"`,
      });

      const pr = await ensurePR({
        head: branch,
        title: `Post: ${args.title}`,
        body:
          `Authored via phaedrus MCP.\n\n` +
          `- **Slug:** \`${args.slug}\`\n` +
          `- **Author:** ${args.author}\n` +
          `- **Tags:** ${args.tags.join(', ')}\n` +
          `- **Path:** \`${path}\`\n`,
      });
      return jsonResult({ pr, path, branch, created: !existing });
    }
  );

  server.tool(
    `${p}update`,
    'Update an existing post on its phaedrus branch (creates the branch from the post on default if missing).',
    {
      path: z.string(),
      body: z.string().optional(),
      title: z.string().optional(),
      excerpt: z.string().optional(),
      author: z.string().optional(),
      description: z.string().optional(),
      tags: z.array(z.string().min(1)).min(1).optional(),
      message: z.string().optional(),
    },
    async (args) => {
      const slug = args.path
        .replace(/^.*\//, '')
        .replace(/\.(md|markdown)$/, '')
        .replace(/^\d{4}-\d{2}-\d{2}-/, '');
      const branch = branchFor(slug);
      await ensureBranch(branch);

      const file = (await getFile(args.path, branch)) ?? (await getFile(args.path, config.ghBranch));
      if (!file) return jsonResult({ error: 'not_found', path: args.path });

      const parsed = splitFrontMatter(file.content);
      const data = { ...parsed.data };
      if (args.title) data.title = args.title;
      if (args.author) data.author = args.author;
      if (args.excerpt) data.excerpt = args.excerpt;
      if (args.description) data.description = args.description;
      const merged: Record<string, string | string[]> = { ...data };
      if (args.tags) {
        const unknown = await unknownTags(args.tags, config.ghBranch);
        if (unknown && unknown.length) return unknownTagsError(unknown);
        merged.tags = args.tags;
      }

      const newBody = args.body ?? parsed.body;
      const content = renderFrontMatter(merged, newBody);

      await putFile({
        path: args.path,
        branch,
        content,
        message: args.message ?? `phaedrus: update "${data.title ?? slug}"`,
      });

      const pr = await ensurePR({
        head: branch,
        title: `Post update: ${data.title ?? slug}`,
        body: `Authored via phaedrus MCP.\n\n- **Path:** \`${args.path}\`\n`,
      });
      return jsonResult({ pr, path: args.path, branch });
    }
  );

  server.tool(
    'author_upsert',
    'Add or update an author entry (writes to AUTHORS_DATA and AUTHORS_DIR).',
    {
      id: z.string().regex(slugRe),
      name: z.string().min(1),
      bio: z.string().optional(),
      url: z.string().url().optional(),
      avatar: z.string().url().optional(),
    },
    async (args) => {
      const branch = `phaedrus/author/${args.id}`;
      await ensureBranch(branch);
      const authorMd = renderFrontMatter(
        {
          name: args.name,
          bio: args.bio ?? '',
          url: args.url ?? '',
          avatar: args.avatar ?? '',
        },
        ''
      );
      await putFile({
        path: `${config.authorsDir}/${args.id}.md`,
        branch,
        content: authorMd,
        message: `phaedrus: upsert author ${args.id}`,
      });
      const pr = await ensurePR({
        head: branch,
        title: `Author: ${args.name}`,
        body: `Authored via phaedrus MCP.\n\n- **Author id:** \`${args.id}\`\n`,
      });
      return jsonResult({ pr, branch });
    }
  );

  server.tool(
    'image_upload',
    'Upload a base64-encoded image to IMAGES_DIR/<slug>/<filename>. Returns the repo path; use it in your post body.',
    {
      slug: z.string().regex(slugRe),
      filename: z.string().min(1),
      contentBase64: z.string().min(1),
    },
    async ({ slug, filename, contentBase64 }) => {
      const branch = branchFor(slug);
      await ensureBranch(branch);
      const path = `${config.imagesDir}/${slug}/${filename}`;
      await putFile({
        path,
        branch,
        content: Buffer.from(contentBase64, 'base64'),
        message: `phaedrus: add image ${path}`,
      });
      return jsonResult({ path, branch });
    }
  );
}
