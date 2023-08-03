const print = require("./print.js");
const upload = require("./upload.js");

const getReleaseNote = async function ({
  token,
  apiKey,
  owner,
  repo,
  pullRequestTitle,
}) {
  await upload.createRecords({
    token,
    owner,
    repo,
    pullRequestNumber,
  });
  await print.createNote({
    pullRequestTitle,
    owner,
    repo,
    token,
    apiKey,
  });
};

exports.getReleaseNote = getReleaseNote;
