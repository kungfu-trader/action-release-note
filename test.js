const lib = require("./lib");

const run = async () => {
  const argv = {
    token: "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",
    owner: "kungfu-trader",
    bucketRelease: "kungfu-prebuilt",
    baseId: "appAdi5zFFEsCzmEM",
    tableId: "tblJabUQUuS6ywW5Z",
    repo: "kungfu",
    pullRequestNumber: 1264,
    pullRequestTitle: "Prerelease v2.6.2",
    apiKey:
      "patYccq9GQsQKzChm.b579787a1b088f8e9824caae3ef362ff303d0735f5c551989485fb6c98cb64ab",
  };

  const argv2 = {
    bucketRelease: "kungfu-prebuilt",
    artifactPath: "artifact-kungfu/v2/v2.6.2/",
    artifactName: "artifact-kungfu",
    version: "v2.6.2",
  };

  lib.clear(argv2);
};

run();
