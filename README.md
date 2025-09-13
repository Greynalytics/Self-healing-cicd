
# Self-Healing CodePipeline (Console Setup)

This starter contains **source code** you can push to CodeCommit (or GitHub) and the **Lambda code** for the "Pipeline Doctor".
Follow the step-by-step console instructions from ChatGPT to create:
- CodeCommit repo
- CodeBuild project
- CodePipeline (Source → Build → Deploy)
- DynamoDB table (SelfHealingIncidents)
- SNS Topic (SelfHealingAlerts)
- EventBridge rules for failures
- Doctor Lambda wired to EventBridge

## Structure
- `pipeline-src/` — the app the pipeline builds/tests
- `lambda/doctor/index.js` — the Self-Healing "Doctor" Lambda
- `lambda/demo/handler.js` — a tiny Lambda used by the Deploy stage (invoke-only)

You can initialize a CodeCommit repo and push `pipeline-src/` to it.

