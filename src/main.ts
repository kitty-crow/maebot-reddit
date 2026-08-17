import 'dotenv/config';
import { RedditInternalHttpServer } from './http/server.ts';
import { internalApiConfig } from './env.ts';
import { QuestionEventStore } from './questions/events.ts';

const cfg = internalApiConfig();

console.log('Mae Reddit TypeScript/Bun overhaul foundation ready.');
console.log('Live Reddit mutation remains disabled on this branch.');

if (cfg === null) {
  console.log('Reddit internal event API is disabled. Configure REDDIT_INTERNAL_API_TOKEN and REDDIT_INTERNAL_API_PORT together to enable it.');
} else {
  const questions = new QuestionEventStore();
  const api = new RedditInternalHttpServer(cfg, questions);
  api.start();
  console.log(`Reddit internal event API listening on ${api.address()}.`);

  const stop = (): void => {
    api.stop();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
