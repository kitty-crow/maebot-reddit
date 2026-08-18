import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { redditConfig } from '../src/env.ts';
import { auditReddit } from '../src/reddit/audit.ts';
import { RedditReadClient } from '../src/reddit/client.ts';
import { safeError } from '../src/reddit/error.ts';

const cfg = redditConfig();
const client = new RedditReadClient(cfg.auth);
const output = resolve(process.cwd(), process.argv[2] ?? 'data/reddit-audit.json');

try {
  const audit = await auditReddit(client, cfg.sourceSubreddit, cfg.primarySubreddit);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(audit, null, 2)}\n`, { encoding: 'utf-8' });
  console.log(`Reddit read-only audit written to ${output}`);
  console.log(`Source r/${cfg.sourceSubreddit}: ${audit.source.userFlairTemplates.length} user flair templates, ${audit.source.postFlairTemplates.length} post flair templates, ${audit.source.userFlairAssignments?.length ?? 0} assignments.`);
  console.log(`Primary r/${cfg.primarySubreddit}: ${audit.primary.userFlairTemplates.length} user flair templates, ${audit.primary.postFlairTemplates.length} post flair templates.`);
} catch (error) {
  console.error(`Reddit read-only audit failed: ${safeError(error)}`);
  process.exitCode = 1;
}
