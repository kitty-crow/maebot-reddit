# Legacy parity audit

## Status

This document freezes the Git-visible legacy behaviour before the TypeScript/Bun overhaul. It does not claim that every imported file is active in production. Production-only state and runtime wiring still require a read-only host and Reddit audit.

Baseline inspected on 17 August 2026:

- `kitty-crow/maebot-reddit` `main`: `5af9f859f48cca3f457992014fea6c06638883f5`
- `kitty-crow/maebot-twitter` `main`: `7fbd5622be7c1e895e78724929e3492c0a22d349`
- `kitty-crow/maebot-telegram` `main`: `ef602fba42d2dfceb41c903516796b96184e4039`
- `kitty-crow/maebot-discord` `main`: `02e1e276d0ea69070312de62ccc2feb91ff0a965`

The legacy Python implementation remains the behaviour oracle until explicit parity or intentional replacement is proven.

## Source inventory

| Source | Git-visible role | External side effects | State access | Audit classification |
| --- | --- | --- | --- | --- |
| `main.py` | Main comment stream for `r/catgirlcoin` | Remove/reply to comments, set user flair | `database.db`, sibling `common` | Active candidate |
| `redditbot.py` | Canned replies, special Mae response, leaderboard, haiku dispatch | Reply/edit comments, submit haiku posts | `pairs.csv`, `database.db`, `Haikus/` through helpers | Active candidate |
| `commands.py` | `!remove`, `!thankyou`, question marker/pinned answer | Remove comments, create/edit/sticky/distinguish comments | `database.db` | Active candidate |
| `counter.py` | Global "this is the Mae" counter and emoji rendering | None directly | `database.db` | Active helper |
| `leaderboard.py` | Per-user Mae count leaderboard | None directly | `database.db` | Active helper with suspected defect |
| `haiku_finder.py` | Approximate 5/7/5 detection and formatting | Writes local haiku files; caller posts/replies | `database.db`, `Haikus/` | Active helper with suspected persistence defect |
| `syllable_fixes.py` | Hand-authored syllable corrections | None | None | Active helper |
| `stringhandle.py` | Legacy text/date normalisation | None | None | Active helper |
| `globals.py` | Comment moderation thresholds/messages/CSS semantics | None | None | Active configuration |
| `mods.py` | Static moderator tuple | None | None | Legacy authority source to supersede |
| `submission_moderation/main.py` | Submission stream | User flair changes, invokes post moderation | parent `database.db`, sibling `common`, `database_reduild` | Active candidate, runtime dependencies missing from Git |
| `submission_moderation/post_moderation.py` | Submission policy and question flow | Remove submissions, reply/sticky comments | working-directory `database.db` | Active candidate |
| `submission_moderation/question_cleaner.py` | Rigid question title check | Change post flair, reply/distinguish | None | Active helper |
| `submission_moderation/similar_questions.py` | Count-vector/cosine duplicate question detection | Reply/sticky | `database.db` supplied by caller | Active helper |
| `submission_moderation/globals.py` | Post thresholds, regex, stopwords, CSS semantics | None | None | Active configuration |
| `submission_moderation/over18.py` | NSFW flair helper | Change post flair | None | Unproven wiring |
| `submission_moderation/comment_moderation.py` | Stub wrapper | None | None | Incomplete/dead candidate |
| `submission_moderation/strings.py` | Empty file | None | None | No behaviour observed |

## Comment-stream behaviour

The imported main loop streams comments from `r/catgirlcoin` with `skip_existing=True` and performs the following observable operations:

1. Reapplies persisted warned/banned user-flair state.
2. Detects configured blacklisted strings.
3. Removes matching comments.
4. Escalates a normal user to warned state on a configured offence.
5. Escalates a warned user to banned/uncivil state on a later configured offence.
6. Removes comments from users already represented as banned/uncivil.
7. Removes comments from users whose flair text is empty.
8. Sends explanatory bot replies for several removals.
9. Runs canned/social matching and haiku matching.
10. Runs legacy command handling.

These outcomes are parity inputs. The new moderation model may intentionally supersede blunt flair/karma gates, but that must be documented and tested rather than silently changing behaviour.

## Submission moderation behaviour

The imported submission service:

- streams new `r/catgirlcoin` submissions;
- reads current subreddit moderators at startup;
- reapplies warned/banned user flair state from the parent database;
- invokes post moderation for submissions it considers non-moderator content;
- removes posts with no required flair;
- removes posts by banned users;
- applies stricter karma handling to warned/restricted users;
- applies a minimum link-karma gate;
- routes `Question` posts through the question workflow.

Production launcher working directory matters. `submission_moderation/main.py` explicitly opens the parent `database.db`, while `post_moderation.py` opens `database.db` relative to its current working directory. The live audit must determine whether these are one store or two different stores.

## Question and best-answer workflow

Behaviour to preserve as a community feature unless explicitly redesigned:

- `Question` post flair is semantically meaningful.
- A rigid regex validates legacy question titles.
- Invalid question formatting can cause the bot to replace the post flair and explain the requirement.
- Accepted questions are normalised and stored.
- Similarity is estimated with count vectors and cosine similarity.
- The observed duplicate threshold is greater than approximately `0.49`.
- Similar questions receive a sticky link to the previous question.
- Accepted questions receive a bot marker comment containing the submission ID.
- That marker is used by the best-answer workflow.
- `!thankyou` may be used by the submission OP or a moderator to update the sticky/distinguished best-answer comment with a quoted answer and permalink.
- A later `!thankyou` may replace the displayed best answer.
- `!remove` may be used by the submission OP or a moderator to remove its parent comment; the command comment is also removed.

The TypeScript implementation does not need to retain the regex or sklearn implementation if a deterministic replacement preserves the intended user experience.

## Canned replies and social features

### `pairs.csv`

`redditbot.py` loads phrase/reply pairs from `pairs.csv`. The file is deliberately excluded from the source import. The production audit must locate it and freeze all currently used pairs before porting.

### "this is the Mae"

Observed intended behaviour:

- increment a global count;
- render the number with keycap number emoji;
- update a per-user leaderboard;
- edit a fixed leaderboard comment;
- rate-limit the special public response with a long cooldown, observed as 43,200 seconds.

The counter is incremented before the public-response cooldown check. The cooldown itself is only in memory in the imported implementation and does not survive restart.

### Haiku

Observed intended behaviour:

- approximate 5/7/5 detection with exactly 17 estimated syllables;
- hand-authored syllable corrections;
- formatted reply to the triggering comment;
- author/history persistence;
- local `.haiku` file creation;
- repost to `r/this_is_the_mae` through the caller.

The live audit must determine whether the repost behaviour is still desired exactly as implemented and inventory the existing `Haikus/` directory.

## Cross-repository Reddit behaviour already in production code

`maebot-discord` currently contains an active Reddit relay. Discord itself:

- owns Reddit OAuth credentials in configuration;
- polls a configured subreddit comment listing every 15 seconds;
- seeds an in-memory seen set from the first poll;
- detects Mae question-marker comments where body equals submission ID;
- announces new questions in a Discord Reddit channel and stores the Discord message ID by Reddit submission ID;
- detects comments containing `!thankyou` and marks the corresponding Discord question as resolved if the actor is the OP or a statically configured moderator.

This user-facing integration is useful behaviour to preserve, but its current ownership violates the target architecture. Reddit OAuth and Reddit polling must move to `maebot-reddit`. Discord should consume typed Reddit-owned events/state and retain only Discord presentation state.

## Suspected legacy defects

These are not parity requirements. They require confirmation against production behaviour before deciding whether any compatibility fixture should encode them.

1. `main.py` checks whether a comment author is the bot but uses `pass` rather than skipping the remaining processing path.
2. `submission_moderation/main.py` compares a Redditor object against a tuple of moderator-name strings, so moderator skipping may not work as intended.
3. `post_moderation.py` contains similar object-to-string author comparisons for hard-coded skip users.
4. `leaderboard.py` has control-flow/indentation that appears to prevent the intended existing-user increment path.
5. `haiku_finder.py` appears not to write the updated `Haikus` map back to the database when the author is first created, while it does so for an existing author.
6. Question similarity code assumes database values are question strings. If it shares a store containing unrelated keys, the behaviour may be unsafe. The working-directory/database split must be resolved first.

## External production artefacts not present in Git

The repository intentionally uses a source-only allowlist. The following are excluded and must be inventoried read-only in production:

- one or more `database.db` files;
- any files matching `database*`, including the imported `database_reduild` dependency if present;
- `pairs.csv` and other CSV data;
- `Haikus/`;
- logs used only where needed to validate wiring/behaviour;
- `.env` and credential locations, without copying secrets into the audit output;
- the sibling `common` directory imported by both legacy runtimes;
- launch scripts and process-manager configuration.

## Parity fixture plan

Before replacing the Python oracle, freeze representative fixtures for:

- canned-response matching and text cleaning;
- "this is the Mae" counter formatting;
- intended leaderboard ordering/update semantics;
- cooldown semantics, with restart behaviour explicitly redesigned;
- haiku positive/negative cases and syllable corrections;
- `!remove` permissions and effects;
- `!thankyou` permissions, marker lookup, replacement behaviour and effects;
- question-title acceptance/rejection;
- duplicate-question threshold cases around `0.49`;
- warned/banned escalation;
- blacklist matching;
- no-flair and karma decisions;
- old flair semantics translated to logical identifiers.

Fixtures for suspected defects must describe the intended corrected behaviour unless production evidence shows that compatibility with the defect is required.

## Audit completion gate

The Git-visible source audit is complete. The frozen legacy audit is not complete until the following read-only work is done:

1. production runtime/state inventory;
2. live `r/catgirlcoin` flair/configuration export;
3. destination capability check for `r/nyaonearth`;
4. current Reddit moderator/permission audit;
5. representative live object/API read audit;
6. identification of active versus unwired legacy helpers;
7. preservation of the production `pairs.csv`, databases and haiku state in copy-first migration inputs.
