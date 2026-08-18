import { readFile } from 'node:fs/promises';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { buildComment } from './commentBuilder.js';
import { upsertComment } from './commentUpsert.js';
import { NxipApiError, mapWithConcurrency, previewSubnet, resolveClientOptions } from './nxipClient.js';
import { parsePlan } from './planParser.js';
import type { PreviewOutcome, TerraformPlan } from './types.js';

const PREVIEW_CONCURRENCY = 5;

export async function run(): Promise<void> {
  try {
    const planJsonPath = core.getInput('plan-json-path', { required: true });
    const apiKeyInput = core.getInput('nxip-api-key');
    const urlInput = core.getInput('nxip-url');
    const githubToken = core.getInput('github-token', { required: true });
    const utilizationWarningThreshold = Number(core.getInput('utilization-warning-threshold') || '80');
    const failOnPredictedFailure = core.getInput('fail-on-predicted-failure') === 'true';

    const pullRequest = github.context.payload.pull_request;
    if (!pullRequest) {
      core.setFailed('This action must run on a pull_request event - github.context.payload.pull_request is not set.');
      return;
    }

    const clientOptions = resolveClientOptions(apiKeyInput, urlInput);
    if (!clientOptions.apiKey) {
      core.setFailed('No nxip API key: set the nxip-api-key input or the NXIP_API_KEY environment variable.');
      return;
    }

    const planRaw = await readFile(planJsonPath, 'utf8');
    const plan = JSON.parse(planRaw) as TerraformPlan;
    const parsed = parsePlan(plan);

    core.info(
      `Found ${parsed.previewable.length} previewable, ${parsed.skipped.length} skipped, ${parsed.deletions.length} deletion-only nxip_subnet change(s).`
    );

    const outcomes: PreviewOutcome[] = await mapWithConcurrency(parsed.previewable, PREVIEW_CONCURRENCY, async (resource) => {
      const result = await previewSubnet(clientOptions, resource.body);
      return { address: resource.address, result };
    });

    const comment = buildComment({
      outcomes,
      skipped: parsed.skipped,
      deletions: parsed.deletions,
      utilizationWarningThreshold,
    });

    const octokit = github.getOctokit(githubToken);
    await upsertComment(octokit, github.context.repo, pullRequest.number, comment);

    const wouldFailCount = outcomes.filter((outcome) => !outcome.result.wouldSucceed).length;
    core.setOutput('previewed-count', outcomes.length);
    core.setOutput('would-fail-count', wouldFailCount);

    if (failOnPredictedFailure && wouldFailCount > 0) {
      core.setFailed(`${wouldFailCount} previewed subnet change(s) would fail if applied.`);
    }
  } catch (error) {
    if (error instanceof NxipApiError) {
      // A non-200 from the preview call means the request couldn't be
      // evaluated at all (bad key, malformed body) - fail the whole step
      // before posting anything, rather than post a comment silently
      // missing rows for resources we never got an answer for.
      core.setFailed(`nxip API returned HTTP ${error.status}: ${error.message}`);
      return;
    }
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

run();
