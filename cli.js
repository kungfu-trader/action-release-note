const lib = require("./lib.js");

const argv = require("yargs/yargs")(process.argv.slice(2))
  .option("token", { description: "token", type: "string" })
  .option("owner", { description: "owner", type: "string" })
  .option("repo", { description: "repo", type: "string" })
  .option("apiKey", { description: "apiKey", type: "string" })
  .option("pullRequestNumber", {
    description: "pullRequestNumber",
    type: "number",
  })
  .option("pullRequestTitle", {
    description: "pullRequestTitle",
    type: "string",
  })
  .help().argv;

// node cli.js --token token --owner kungfu-trader --repo test-rollback-packages --pullRequestNumber 88
lib.getReleaseNote(argv).catch(console.error);
// lib.closeIssue(argv).catch(console.error);
