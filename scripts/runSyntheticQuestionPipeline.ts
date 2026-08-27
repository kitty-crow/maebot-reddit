import { isMap, type JsonMap } from '../src/types/json.ts';
import { Store } from '../src/store/store.ts';

const SYNTHETIC_AUTHOR = 'MaeSyntheticTest';
const stateFile = 'data/questionState.pb';

const initialState = (): JsonMap => ({
  schema: 1,
  activated: {},
  questions: {},
  commands: {},
});

const syntheticQuestion = (key: string, value: JsonMap): boolean => {
  const submissionId = typeof value['submissionId'] === 'string' ? value['submissionId'] : '';
  const author = typeof value['author'] === 'string' ? value['author'] : '';
  const permalink = typeof value['permalink'] === 'string' ? value['permalink'] : '';

  return key === submissionId
    && author === SYNTHETIC_AUTHOR
    && /^s[a-z0-9]+[bc]$/iu.test(submissionId)
    && permalink === `/r/${typeof value['subreddit'] === 'string' ? value['subreddit'] : ''}/comments/${submissionId}/synthetic_pipeline_test/`;
};

const syntheticCommand = (key: string): boolean =>
  /^(?:false(?:user|wrong|valid)s[a-z0-9]+c|thankyous[a-z0-9]+b)$/iu.test(key);

const cleanPreviousSyntheticState = async (): Promise<{ questions: number; commands: number }> => {
  const store = new Store(stateFile, initialState());
  let removedQuestions = 0;
  let removedCommands = 0;

  await store.edit(current => {
    if (!isMap(current) || current['schema'] !== 1) {
      throw new Error('Unsupported production Question state store');
    }

    const questions = current['questions'];
    if (!isMap(questions)) throw new Error('Production Question state questions map is invalid');

    for (const [key, raw] of Object.entries(questions)) {
      if (!isMap(raw) || !syntheticQuestion(key, raw)) continue;
      delete questions[key];
      removedQuestions += 1;
    }

    const commands = current['commands'];
    if (!isMap(commands)) throw new Error('Production Question state commands map is invalid');

    for (const key of Object.keys(commands)) {
      if (!syntheticCommand(key)) continue;
      delete commands[key];
      removedCommands += 1;
    }

    return current;
  });

  return {
    questions: removedQuestions,
    commands: removedCommands,
  };
};

const removed = await cleanPreviousSyntheticState();
console.log(
  `Synthetic pre-clean: removed ${removed.questions} prior Question state entr${removed.questions === 1 ? 'y' : 'ies'} and ${removed.commands} handled command entr${removed.commands === 1 ? 'y' : 'ies'}.`,
);

await import('./syntheticQuestionPipeline.ts');
if ((process.exitCode ?? 0) === 0) await import('./syntheticQuestionThankyou.ts');
