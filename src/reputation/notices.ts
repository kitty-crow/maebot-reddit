export type ReputationNoticeState = 'warned' | 'uncivil' | 'banned' | 'scam';

export type ReputationViolationNotice = {
  readonly state: ReputationNoticeState;
  readonly contentKind: 'post' | 'comment' | 'dm' | 'modmail' | 'vote-manipulation';
  readonly content: string;
  readonly reason: string;
  readonly points: number;
};

const clip = (value: string, max: number): string => {
  const clean = value.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
};

const supportRoute = `If your modmail is temporarily muted, a genuine apology to me will reopen it immediately so you can request human moderator review. The apology does not change your score, Strikes, or Marks.`;

const label = (kind: ReputationViolationNotice['contentKind']): string => {
  if (kind === 'post') return 'post';
  if (kind === 'comment') return 'comment';
  if (kind === 'dm') return 'message to me';
  if (kind === 'modmail') return 'modmail message';
  return 'vote-manipulation case';
};

export const maeSupportRoute = supportRoute;

export const violationNoticeText = (input: ReputationViolationNotice): string => {
  const content = clip(input.content, 1_200) || '[content unavailable]';
  const reason = clip(input.reason, 700) || 'A community rule was violated.';

  if (input.state === 'warned') {
    const strikes = Math.max(0, Math.min(3, Math.abs(Math.min(0, input.points))));
    const threshold = strikes >= 3
      ? 'You’re at 3/3 Strikes. Another reputation loss can mark your account as uncivil, which means you will no longer be able to make posts in the Nya communities.'
      : 'If your reputation falls below the warned range, your account will be marked as uncivil and you will no longer be able to make posts in the Nya communities.';
    return [
      `I’ve warned you for this ${label(input.contentKind)}:`,
      '',
      content,
      '',
      `Reason: ${reason}`,
      `Current Strikes: ${strikes}/3`,
      '',
      threshold,
      '',
      supportRoute,
    ].join('\n');
  }

  if (input.state === 'uncivil') {
    const marks = Math.max(4, Math.min(9, Math.abs(input.points)));
    return [
      `I’ve marked this ${label(input.contentKind)} as a rule violation:`,
      '',
      content,
      '',
      `Reason: ${reason}`,
      `Current Marks: ${marks}/10`,
      '',
      'While your account is uncivil you can comment, but you cannot make posts. At 10 Marks your account will be permanently banned.',
      'Your modmail access is temporarily muted while your account is uncivil.',
      '',
      supportRoute,
    ].join('\n');
  }

  if (input.state === 'scam') {
    return [
      `I’ve permanently banned your account for this ${label(input.contentKind)}:`,
      '',
      content,
      '',
      `Reason: ${reason}`,
      '',
      'Scam, phishing, malicious promotion, and prohibited cryptocurrency promotion are subject to immediate permanent enforcement.',
    ].join('\n');
  }

  return [
    `I’ve permanently banned your account following this ${label(input.contentKind)}:`,
    '',
    content,
    '',
    `Reason: ${reason}`,
    '',
    'Your reputation reached the permanent-ban threshold.',
  ].join('\n');
};
