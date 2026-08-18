import 'dotenv/config';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { redditConfig } from '../src/env.ts';
import { FlairCloner } from '../src/flair/clone.ts';
import { RedditReadClient } from '../src/reddit/client.ts';
import { RedditMutationClient } from '../src/reddit/mutate.ts';
import type { RedditFlairTemplate } from '../src/reddit/types.ts';

const cfg = redditConfig();
if (cfg.sourceSubreddit.toLowerCase() === cfg.primarySubreddit.toLowerCase()) {
  throw new Error('Source and primary subreddit must be different for flair migration');
}

const read = new RedditReadClient(cfg.auth);
const write = new RedditMutationClient(cfg.auth);
const [me, source, target] = await Promise.all([
  read.me(),
  read.subreddit(cfg.sourceSubreddit),
  read.subreddit(cfg.primarySubreddit),
]);
if (!source.userIsModerator) throw new Error(`${me.name} is not a moderator of r/${cfg.sourceSubreddit}`);
if (!target.userIsModerator) throw new Error(`${me.name} is not a moderator of r/${cfg.primarySubreddit}`);

console.log(`Cloning user and post flairs: r/${cfg.sourceSubreddit} -> r/${cfg.primarySubreddit}`);
const result = await new FlairCloner(read, write).clone(cfg.sourceSubreddit, cfg.primarySubreddit);

const [sourceUserTemplates, sourcePostTemplates, sourceAssignments, targetUserTemplates, targetPostTemplates, targetAssignments] = await Promise.all([
  read.userFlairTemplates(cfg.sourceSubreddit),
  read.postFlairTemplates(cfg.sourceSubreddit),
  read.userFlairAssignments(cfg.sourceSubreddit),
  read.userFlairTemplates(cfg.primarySubreddit),
  read.postFlairTemplates(cfg.primarySubreddit),
  read.userFlairAssignments(cfg.primarySubreddit),
]);

const norm = (value: string | null): string => value ?? '';
const samePresentation = (left: RedditFlairTemplate, right: RedditFlairTemplate): boolean =>
  left.text === right.text
  && norm(left.cssClass) === norm(right.cssClass)
  && norm(left.textColour) === norm(right.textColour)
  && norm(left.backgroundColour) === norm(right.backgroundColour)
  && left.modOnly === right.modOnly
  && left.textEditable === right.textEditable
  && norm(left.allowableContent) === norm(right.allowableContent)
  && (left.maxEmojis ?? 0) === (right.maxEmojis ?? 0);

const mappings = (kind: 'user' | 'post', sourceTemplates: readonly RedditFlairTemplate[], targetTemplates: readonly RedditFlairTemplate[]) =>
  sourceTemplates.map(template => {
    const matches = targetTemplates.filter(targetTemplate => samePresentation(template, targetTemplate));
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one cloned ${kind} flair destination for ${template.id}, found ${matches.length}`);
    }
    const destination = matches[0];
    if (destination === undefined) throw new Error(`Cloned ${kind} flair destination disappeared for ${template.id}`);
    return {
      kind,
      sourceTemplateId: template.id,
      targetTemplateId: destination.id,
      text: template.text,
      cssClass: template.cssClass,
    } as const;
  });

const catalogueFile = resolve(
  process.cwd(),
  process.env['REDDIT_FLAIR_CATALOGUE_FILE']?.trim() || 'data/flairs.json',
);
const catalogue = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  sourceSubreddit: cfg.sourceSubreddit,
  targetSubreddit: cfg.primarySubreddit,
  userTemplates: {
    source: sourceUserTemplates,
    target: targetUserTemplates,
    mapping: mappings('user', sourceUserTemplates, targetUserTemplates),
  },
  postTemplates: {
    source: sourcePostTemplates,
    target: targetPostTemplates,
    mapping: mappings('post', sourcePostTemplates, targetPostTemplates),
  },
  userAssignments: {
    source: sourceAssignments,
    target: targetAssignments,
  },
  cloneResult: result,
};

await mkdir(dirname(catalogueFile), { recursive: true });
const temp = `${catalogueFile}.tmp.${process.pid}`;
await writeFile(temp, `${JSON.stringify(catalogue, null, 2)}\n`, { mode: 0o600 });
await rename(temp, catalogueFile);

console.log(`user templates created=${result.userTemplatesCreated}`);
console.log(`post templates created=${result.postTemplatesCreated}`);
console.log(`user assignments applied=${result.userAssignmentsApplied}`);
console.log(`user assignments already correct=${result.userAssignmentsAlreadyCorrect}`);
console.log(`canonical flair catalogue=${catalogueFile}`);
console.log('Flair clone complete.');
