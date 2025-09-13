
'use strict';

/**
 * Pipeline Doctor (Node.js, AWS SDK v2 which is available in the Lambda runtime).
 * - Listens to EventBridge events from CodeBuild/CodePipeline.
 * - Tracks retries in DynamoDB.
 * - Applies simple playbooks: retry, bump timeout, backoff+retry, retry stage.
 * - Notifies via SNS if retries are exhausted.
 *
 * Required env vars:
 *   TABLE       = SelfHealingIncidents    (DynamoDB)
 *   TOPIC_ARN   = arn:aws:sns:...         (SNS topic ARN)
 *   MAX_RETRIES = 2                        (optional)
 */

const AWS = require('aws-sdk');
const codebuild = new AWS.CodeBuild();
const codepipeline = new AWS.CodePipeline();
const dynamodb = new AWS.DynamoDB();
const sns = new AWS.SNS();

const TABLE = process.env.TABLE;
const TOPIC_ARN = process.env.TOPIC_ARN;
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '2', 10);

exports.handler = async (event) => {
  const type = event['detail-type'] || '';
  const detail = event.detail || {};

  // Handle CodeBuild failures/timeouts
  if (type.includes('CodeBuild Build State Change')) {
    const buildId = detail['build-id'];
    const status = detail['build-status']; // FAILED | TIMED_OUT | etc.
    if (status === 'FAILED' || status === 'TIMED_OUT') {
      const info = await codebuild.batchGetBuilds({ ids: [buildId] }).promise();
      const build = (info.builds || [])[0];
      const projectName = build?.projectName;
      const incidentId = `codebuild:${buildId}`;

      const retries = await getRetries(incidentId);
      if (retries >= MAX_RETRIES) {
        await notify(`❌ Build ${buildId} (${projectName}) failed after ${retries} retries`);
        await saveIncident(incidentId, retries, 'GAVE_UP', 'UNHEALED');
        return;
      }

      // Simple classification based on text
      const raw = JSON.stringify(build);
      let action = 'RETRY';
      if ((raw || '').includes('TIMED_OUT')) action = 'BUMP_TIMEOUT_AND_RETRY';
      if ((raw || '').toLowerCase().includes('rate exceeded')) action = 'BACKOFF_AND_RETRY';

      if (action === 'BUMP_TIMEOUT_AND_RETRY') {
        // Bump project timeout to 25 minutes (demo). In production, read current and add +5.
        await codebuild.updateProject({
          name: projectName,
          timeoutInMinutes: 25
        }).promise();
      }

      if (action === 'BACKOFF_AND_RETRY') {
        // quick backoff
        await new Promise(res => setTimeout(res, 30000));
      }

      // Retry with cache-buster to avoid stale caches
      await codebuild.startBuild({
        projectName,
        environmentVariablesOverride: [
          { name: 'CACHE_BUSTER', value: Date.now().toString() }
        ]
      }).promise();

      await saveIncident(incidentId, retries + 1, action, 'RETRYING');
      return;
    }
  }

  // Handle CodePipeline action failures
  if (type.includes('CodePipeline Action Execution State Change')) {
    const state = detail.state; // FAILED
    if (state === 'FAILED') {
      const pipelineName = detail.pipeline;
      const stageName = detail.stage;
      const execId = detail['execution-id'];
      const incidentId = `codepipeline:${execId}:${stageName}`;

      const retries = await getRetries(incidentId);
      if (retries >= MAX_RETRIES) {
        await notify(`❌ Pipeline ${pipelineName}/${stageName} failed after ${retries} retries`);
        await saveIncident(incidentId, retries, 'GAVE_UP', 'UNHEALED');
        return;
      }

      await codepipeline.retryStageExecution({
        pipelineName,
        pipelineExecutionId: execId,
        stageName,
        retryMode: 'FAILED_ACTIONS'
      }).promise();

      await saveIncident(incidentId, retries + 1, 'RETRY_STAGE', 'RETRYING');
    }
  }
};

async function getRetries(incidentId) {
  const out = await dynamodb.getItem({
    TableName: TABLE,
    Key: { incidentId: { S: incidentId } }
  }).promise();
  const n = out.Item && out.Item.retries && out.Item.retries.N;
  return n ? parseInt(n, 10) : 0;
}

async function saveIncident(incidentId, retries, lastAction, status) {
  await dynamodb.putItem({
    TableName: TABLE,
    Item: {
      incidentId: { S: incidentId },
      retries: { N: String(retries) },
      lastAction: { S: lastAction },
      status: { S: status },
      lastUpdated: { S: new Date().toISOString() }
    }
  }).promise();
}

async function notify(message) {
  if (!TOPIC_ARN) return;
  await sns.publish({ TopicArn: TOPIC_ARN, Message: message }).promise();
}
