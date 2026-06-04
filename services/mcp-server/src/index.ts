import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config } from './env.js';
import { registerTools } from './tools.js';

const app = express();
app.use(express.json({ limit: '25mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, owner: config.ghOwner, repo: config.ghRepo, branch: config.ghBranch });
});

// Stateless MCP — each request spins up a fresh server + transport. Cloud Run
// instances can disappear between requests, so we don't keep a session.
app.all('/mcp', async (req, res) => {
  const server = new McpServer({ name: 'phaedrus', version: '1.0.0' });
  registerTools(server);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('phaedrus mcp error', err);
    if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
  }
});

app.listen(config.port, () => {
  console.log(`phaedrus mcp listening on :${config.port} (repo ${config.ghOwner}/${config.ghRepo}@${config.ghBranch})`);
});
