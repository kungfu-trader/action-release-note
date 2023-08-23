const lib = (exports.lib = require("./lib"));
const core = require("@actions/core");
const github = require("@actions/github");

const main = async function () {
  const context = github.context;
  const argv = {
    token: core.getInput("token"),
    apiKey: core.getInput("apiKey"),
    bucketRelease: core.getInput("bucket-release"),
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
    pullRequestTitle: context.payload.pull_request.title,
    pullRequestNumber: context.payload.pull_request.number,
  };
  if (!argv.apiKey) {
    console.error("has not airtable access token");
    return;
  }
  const publish = core.getInput("publish");
  publish ? await lib.teleportNotes(argv) : await lib.getReleaseNote(argv);
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    // 设置操作失败时退出
    core.setFailed(error.message);
  });
}
