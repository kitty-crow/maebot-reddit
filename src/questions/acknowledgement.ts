import type { RedditMutationClient } from '../reddit/mutate.ts';
import type { QuestionStateRecord, QuestionStateStore } from './state.ts';

export const QUESTION_ACKNOWLEDGEMENT = [
  'Thanks for your question! Please be patient while one of our nyantastic community members replies.',
  '',
  "If someone answers your question, reply `!thankyou` directly to their answer and I will mark it as the best answer. You must be the OP or a subreddit moderator.",
  '',
  '---',
  '^beep ^boop! ^I ^am ^a ^bot. ^This ^response ^is ^automated.',
].join('\n');

export type QuestionAcknowledgementWriter = Pick<RedditMutationClient, 'reply' | 'distinguish'>;

export const ensureQuestionAcknowledgement = async (
  question: QuestionStateRecord,
  state: QuestionStateStore,
  writer: QuestionAcknowledgementWriter,
  at = Math.floor(Date.now() / 1_000),
): Promise<QuestionStateRecord> => {
  if (question.acknowledgementCommentId !== null) return question;
  const created = await writer.reply(`t3_${question.submissionId}`, QUESTION_ACKNOWLEDGEMENT);
  const stored = await state.markAcknowledgement(question.submissionId, created.id, Math.max(0, Math.floor(at)));
  if (stored === null) throw new Error(`Question ${question.submissionId} disappeared while storing Mae acknowledgement`);
  try {
    await writer.distinguish(created.fullname, true);
  } catch (error) {
    console.error(
      `[Reddit questions] could not distinguish/sticky acknowledgement ${created.fullname}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return stored;
};
