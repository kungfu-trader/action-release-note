const { Octokit } = require("@octokit/rest");
const { createRecords } = require("./collect");
const { createNote } = require("./print");

const refreshFullDose = async (argv) => {
  const octokit = new Octokit({
    auth: argv.token,
  });
  const pulls = await getPulls(argv, octokit);
  const records = pulls.filter(
    (v) => v.base.ref.startsWith("alpha") || v.base.ref.startsWith("release")
  );
  for (const record of records) {
    const { changed } = await createRecords({
      ...argv,
      pullRequestNumber: record.number,
      pullRequestTitle: record.title,
      repo: argv.fullDoseRepo
    }, pulls);
    if (changed) {
      await createNote(
        {
          ...argv,
          pullRequestNumber: record.number,
          pullRequestTitle: record.title,
          repo: argv.fullDoseRepo
        },
        true
      );
    }
  }
};

const getPulls = async (argv, octokit, page = 1) => {
  const pulls = await octokit
    .request(`GET /repos/{owner}/{repo}/pulls`, {
      owner: argv.owner,
      repo: argv.repo,
      per_page: 100,
      state: "closed",
      page,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    })
    .then((res) => res.data)
    .catch((e) => {
      console.error(e.message);
      return [];
    });
  if (pulls.length < 100) {
    return pulls;
  }
  return [...pulls, ...(await getPulls(argv, octokit, page + 1))];
};

const pick = (obj, keys) => {
  return keys.reduce((acc, cur) => ({ ...acc, [cur]: obj[cur] }), {});
};
module.exports = { refreshFullDose };
