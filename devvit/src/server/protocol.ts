export type HealthResponse = {
  readonly ok: true;
  readonly protocol: 1;
  readonly app: 'this-is-the-mae';
  readonly redditUser: string;
};

export const healthResponse = (redditUser: string): HealthResponse => ({
  ok: true,
  protocol: 1,
  app: 'this-is-the-mae',
  redditUser,
});
