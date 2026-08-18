import type { getOctokit } from '@actions/github';
import { COMMENT_MARKER } from './commentBuilder.js';

type Octokit = ReturnType<typeof getOctokit>;

export interface RepoRef {
  owner: string;
  repo: string;
}

/**
 * Finds an existing comment carrying COMMENT_MARKER on this PR and edits
 * it in place; otherwise creates a new one. Keeps a push-triggered
 * re-run from piling up a fresh comment every time.
 */
export async function upsertComment(
  octokit: Octokit,
  repo: RepoRef,
  issueNumber: number,
  body: string
): Promise<void> {
  const existing = await findExistingComment(octokit, repo, issueNumber);

  if (existing) {
    await octokit.rest.issues.updateComment({
      ...repo,
      comment_id: existing,
      body,
    });
    return;
  }

  await octokit.rest.issues.createComment({
    ...repo,
    issue_number: issueNumber,
    body,
  });
}

async function findExistingComment(octokit: Octokit, repo: RepoRef, issueNumber: number): Promise<number | undefined> {
  const iterator = octokit.paginate.iterator(octokit.rest.issues.listComments, {
    ...repo,
    issue_number: issueNumber,
    per_page: 100,
  });

  for await (const { data: comments } of iterator) {
    const match = comments.find((comment) => comment.body?.includes(COMMENT_MARKER));
    if (match) return match.id;
  }

  return undefined;
}
