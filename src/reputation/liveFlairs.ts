import type { RedditFlairTemplate } from '../reddit/types.ts';
import type { ReputationFlairReferences } from './store.ts';

export const CATGIRLCOIN_REPUTATION_FLAIRS = {
  user: {
    mae: { id: 'c287b8ea-94bc-11ec-ac69-aab48f042082', text: ':mae:', cssClass: 'h' },
    lisa: { id: 'db95e19a-94bc-11ec-b636-d6d9f3ebf86d', text: ':lisa:', cssClass: 'h' },
    kita: { id: 'c9271cd6-94bc-11ec-b2f4-3e0827c16db5', text: ':kita:', cssClass: 'h' },
    aoi: { id: 'e48e5160-94bc-11ec-b456-860cd7017d9e', text: ':aoi:', cssClass: 'h' },
    hana: { id: 'd44f2694-94bc-11ec-a039-eec865a675c1', text: ':hana:', cssClass: 'h' },
    rin: { id: 'e9b4c9f8-94bc-11ec-b636-d6d9f3ebf86d', text: ':rin:', cssClass: 'h' },
    celeste: { id: 'd8018552-94bc-11ec-a4d1-22f06121d139', text: ':celeste:', cssClass: 'h' },
    pawsomeContributor: {
      id: 'a31e3b22-3e55-11ec-bb6b-ceedb0263d7d',
      text: 'Pawsome contributor :catgirl-moon:',
      cssClass: 'h',
    },
    warned: { id: 'bc2db8c4-29d5-11ed-a76f-163c4ee499e0', text: ' ', cssClass: 'w' },
    uncivil: { id: 'e37b5534-91ce-11ec-84c8-7602fd74d2f2', text: ' ', cssClass: 'u' },
    scam: { id: 'fec5118a-4ff2-11ed-922e-96e4dc818f74', text: 'SCAM', cssClass: 's' },
  },
  post: {
    minorAnnouncement: {
      id: 'a6fef792-9100-11ec-aa84-9a9e4751ff9e',
      text: 'Minor Announcement :lisa:',
    },
    announcement: {
      id: '807098b2-3b72-11ec-a37b-aa7cb124a04e',
      text: 'Announcement :catgirl-moon:',
    },
  },
} as const;

type ExpectedFlair = {
  readonly id: string;
  readonly text: string;
  readonly cssClass?: string;
};

const exactById = (
  templates: readonly RedditFlairTemplate[],
  expected: ExpectedFlair,
  kind: string,
): RedditFlairTemplate => {
  const template = templates.find(value => value.id === expected.id);
  if (template === undefined) {
    throw new Error(`Canonical r/catgirlcoin ${kind} flair ${expected.id} is missing from live inventory`);
  }
  if (template.text !== expected.text) {
    throw new Error(`Canonical r/catgirlcoin ${kind} flair ${expected.id} text changed from ${JSON.stringify(expected.text)} to ${JSON.stringify(template.text)}`);
  }
  if (expected.cssClass !== undefined && (template.cssClass ?? '') !== expected.cssClass) {
    throw new Error(`Canonical r/catgirlcoin ${kind} flair ${expected.id} css changed from ${JSON.stringify(expected.cssClass)} to ${JSON.stringify(template.cssClass ?? '')}`);
  }
  return template;
};

export const catgirlcoinFlairReferences = (
  userFlairs: readonly RedditFlairTemplate[],
  postFlairs: readonly RedditFlairTemplate[],
): ReputationFlairReferences => {
  const user = CATGIRLCOIN_REPUTATION_FLAIRS.user;
  const post = CATGIRLCOIN_REPUTATION_FLAIRS.post;

  for (const [name, expected] of Object.entries(user)) exactById(userFlairs, expected, `user ${name}`);
  for (const [name, expected] of Object.entries(post)) exactById(postFlairs, expected, `post ${name}`);

  return {
    user: {
      mae: user.mae.id,
      lisa: user.lisa.id,
      kita: user.kita.id,
      aoi: user.aoi.id,
      hana: user.hana.id,
      rin: user.rin.id,
      celeste: user.celeste.id,
      pawsomeContributor: user.pawsomeContributor.id,
      warned: user.warned.id,
      uncivil: user.uncivil.id,
      scam: user.scam.id,
    },
    post: {
      minorAnnouncement: post.minorAnnouncement.id,
      announcement: post.announcement.id,
    },
  };
};
