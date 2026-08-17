const questionPattern = /^(what|when|why|which|who|how|whose|whom|where|will|would|have|has|had|does|do|did|how|are|is|can).+\w+(.?)+(?=\?+$)\?*$/iu;

export const legacyQuestionTitleValid = (title: string): boolean => questionPattern.test(title);

export const legacyStopwords = new Set([
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', "you're", "you've", "you'll", "you'd",
  'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', "she's", 'her', 'hers', 'herself',
  'it', "it's", 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this',
  'that', "that'll", 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'having', 'do', 'does', 'did', 'doing', 'a', 'an', 'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while',
  'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during', 'before', 'after', 'above',
  'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here',
  'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don', "don't", 'should',
  "should've", 'now', 'd', 'll', 'm', 'o', 're', 've', 'y', 'ain', 'aren', "aren't", 'couldn', "couldn't", 'didn', "didn't",
  'doesn', "doesn't", 'hadn', "hadn't", 'hasn', "hasn't", 'haven', "haven't", 'isn', "isn't", 'ma', 'mightn', "mightn't",
  'mustn', "mustn't", 'needn', "needn't", 'shan', "shan't", 'shouldn', "shouldn't", 'wasn', "wasn't", 'weren', "weren't",
  'won', "won't", 'wouldn', "wouldn't", 'catgirl', 'catgirls',
]);

const punctuation = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/gu;

export const normaliseLegacyQuestion = (title: string): string => title
  .replace(punctuation, '')
  .toLowerCase()
  .split(/\s+/u)
  .filter(word => word.length > 0 && !legacyStopwords.has(word))
  .join(' ');

const tokens = (value: string): readonly string[] => value.toLowerCase().match(/\b\w\w+\b/gu) ?? [];

export const countVectorCosine = (left: string, right: string): number => {
  const a = tokens(left);
  const b = tokens(right);
  const vocab = new Set([...a, ...b]);
  if (vocab.size === 0) return 0;
  const ac = new Map<string, number>();
  const bc = new Map<string, number>();
  for (const token of a) ac.set(token, (ac.get(token) ?? 0) + 1);
  for (const token of b) bc.set(token, (bc.get(token) ?? 0) + 1);
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (const token of vocab) {
    const x = ac.get(token) ?? 0;
    const y = bc.get(token) ?? 0;
    dot += x * y;
    aa += x * x;
    bb += y * y;
  }
  if (aa === 0 || bb === 0) return 0;
  return dot / (Math.sqrt(aa) * Math.sqrt(bb));
};

export type SimilarQuestion = {
  readonly submissionId: string;
  readonly normalisedTitle: string;
};

export const firstLegacySimilarQuestion = (
  title: string,
  existing: readonly SimilarQuestion[],
  threshold = 0.49,
): SimilarQuestion | null => {
  const normalised = normaliseLegacyQuestion(title);
  for (const candidate of existing) {
    if (countVectorCosine(normalised, candidate.normalisedTitle) > threshold) return candidate;
  }
  return null;
};
