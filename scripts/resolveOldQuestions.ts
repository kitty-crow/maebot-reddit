import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { QuestionEventStore } from '../src/questions/events.ts';
import { QuestionStateStore } from '../src/questions/state.ts';

// Run from the same working directory as the Reddit service. Require both
// persistent stores so an accidental wrong cwd cannot manufacture empty state.
const stateFile = resolve(process.cwd(), 'data/questionState.pb');
const eventFile = resolve(process.cwd(), 'data/questionEvents.pb');

try {
  await Promise.all([access(stateFile), access(eventFile)]);
  const state = new QuestionStateStore(stateFile);
  const events = new QuestionEventStore(eventFile);
  const pending = (await state.all()).filter(question =>
    question.bestAnswerCommentId === null && question.resolvedAt === null
  );
  const at = Math.floor(Date.now() / 1_000);
  let closed = 0;
  let failed = 0;

  console.log(`Closing ${pending.length} unresolved canonical Reddit questions…`);
  for (const question of pending) {
    try {
      // Journal before marking closed: a crash can safely retry this same key
      // without losing Discord's reaction update.
      await events.resolved({
        submissionId: question.submissionId,
        subreddit: question.subreddit,
        title: question.title,
        summary: question.summary,
        submissionAuthor: question.author ?? '',
        submissionPermalink: question.permalink,
        at,
      });
      if (await state.markResolved(question.submissionId, at)) closed += 1;
    } catch (error) {
      failed += 1;
      console.error(`Failed to close ${question.submissionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`Closed ${closed} questions; ${failed} failures. Discord will update their existing messages on its next question-event poll.`);
  if (failed > 0) process.exitCode = 1;
} catch (error) {
  console.error(`Cannot resolve old questions: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
