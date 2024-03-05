const print = require("./lib/print.js");
const collect = require("./lib/collect.js");
const schedule = require("./lib/schedule.js");
const lib = require("./lib");

const run = async () => {
  await lib.createReleaseNote(
    {
      token: "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",
      apiKey:
        "patYccq9GQsQKzChm.b579787a1b088f8e9824caae3ef362ff303d0735f5c551989485fb6c98cb64ab",
      bucketRelease: "kungfu-releases",
      bucketPrebuilt: "kungfu-prebuilt",
      baseId: "appAdi5zFFEsCzmEM",
      tableId: "tblJabUQUuS6ywW5Z",
      owner: "kungfu-trader",
      repo: "kungfu",
      pullRequestTitle: "Prerelease v2.6.14-alpha.4",
      pullRequestNumber: 3065,
    },
    true
  );
};

// const argv = {
//   token: core.getInput("token"),
//   apiKey: core.getInput("apiKey"),
//   bucketRelease: core.getInput("bucket-release") ? "kungfu-releases" : null,
//   bucketPrebuilt: "kungfu-prebuilt",
//   baseId: core.getInput("airtable-baseid"),
//   tableId: core.getInput("airtable-tableid"),
//   owner: context.payload.repository.owner.login,
//   repo: context.payload.repository.name,
//   pullRequestTitle: context.payload?.pull_request?.title,
//   pullRequestNumber: context.payload?.pull_request?.number,
//   fullDoseRepo: core.getInput("full-dose-repo"),
//   fullDoseArtifact: core.getInput("full-dose-artifact"),
// };

run();
