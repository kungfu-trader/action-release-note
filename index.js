const lib = (exports.lib = require('./lib.js'));
const core = require('@actions/core');
const github = require('@actions/github');

const main = async function () {
  const context = github.context;
  const argv = {
    token: core.getInput('token'),
    mondayApi: core.getInput('monday_api_key'),
    apiKey: core.getInput("apiKey"),
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
    pullRequestTitle: context.payload.pull_request.title,
    pullRequestNumber: context.payload.pull_request.number,
  };
  await lib.getReleaseNote(argv, pullRequestNumber);
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    // 设置操作失败时退出
    core.setFailed(error.message);
  });
}
