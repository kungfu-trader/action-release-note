const print = require("./print.js");
const upload = require("./upload.js");

const getReleaseNote = async function ({
  token,
  mondayApi,
  apiKey,
  owner,
  repo,
  pullRequestTitle,
}) {
  await upload.createRecords({
    token,
    mondayApi,
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
