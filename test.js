const lib = require("./lib");

async function run() {
  const argv = {
    token: "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",
    owner: "kungfu-trade",
    repo: "kungfu",
    pullRequestNumber: 1199,
    pullRequestTitle: '',
    apiKey: 'sdddd'
  };

  lib.createNote(argv);
}

run();
