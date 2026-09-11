const active = new Set<string>();

const keyFor = (username: string): string => username.trim().toLowerCase();

export const redditStateAdoptionInProgress = (username: string): boolean => active.has(keyFor(username));

export const assertRedditStateMutationAllowed = (username: string): void => {
  if (redditStateAdoptionInProgress(username)) {
    throw new Error(`Live Reddit state adoption is in progress for u/${username}; deferred normal enforcement`);
  }
};

export const withRedditStateAdoption = async <T>(
  username: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const key = keyFor(username);
  if (active.has(key)) throw new Error(`Live Reddit state adoption is already in progress for u/${username}`);
  active.add(key);
  try {
    return await operation();
  } finally {
    active.delete(key);
  }
};
