import 'dotenv/config';
import { internalApiConfig } from './env.ts';
import { RedditInternalHttpServer } from './http/server.ts';
import { ModerationReviewStore } from './mod/review.ts';
import { QuestionEventStore } from './questions/events.ts';

const cfg = internalApiConfig();

console.log('Mae Reddit TypeScript/Bun overhaul foundation ready.');
console.log('Live Reddit mutation remains disabled on this branch.');

if (cfg === null) {
  console.log('Reddit internal event API is disabled. Configure REDDIT_INTERNAL_API_TOKEN and REDDIT_INTERNAL_API_PORT together to enable it.');
} else {
  const questions = new QuestionEventStore();
  const moderation = new ModerationReviewStore();
  const api = new RedditInternalHttpServer(cfg, questions, moderation);
  api.start();
  console.log(`Reddit internal event API listening on ${api.address()}.`);

  const stop = (): void => {
    api.stop();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
