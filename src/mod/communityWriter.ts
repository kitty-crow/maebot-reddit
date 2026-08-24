import type { ModerationWriter } from './runtime.ts';

const communities = (values: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (value.length === 0) throw new Error('Moderation community name cannot be empty');
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  if (out.length === 0) throw new Error('At least one moderation community is required');
  return out;
};

export class CommunityModerationWriter implements ModerationWriter {
  private readonly subreddits: readonly string[];

  public constructor(
    private readonly writer: ModerationWriter,
    subreddits: readonly string[],
  ) {
    this.subreddits = communities(subreddits);
  }

  public async setUserFlairTemplate(
    subreddit: string,
    username: string,
    templateId: string,
    customText: string | null,
  ): Promise<void> {
    await this.writer.setUserFlairTemplate(subreddit, username, templateId, customText);
  }

  public async remove(fullname: string): Promise<void> {
    await this.writer.remove(fullname);
  }

  public async banUser(subreddit: string, username: string, reason: string, note: string): Promise<void> {
    await this.writer.banUser(subreddit, username, reason, note);
  }

  public async sendPrivateMessage(username: string, subject: string, body: string): Promise<void> {
    await this.writer.sendPrivateMessage(username, subject, body);
  }

  public async muteUser(_subreddit: string, username: string, note: string): Promise<void> {
    for (const subreddit of this.subreddits) await this.writer.muteUser(subreddit, username, note);
  }

  public async unmuteUser(_subreddit: string, username: string): Promise<void> {
    for (const subreddit of this.subreddits) await this.writer.unmuteUser(subreddit, username);
  }
}
