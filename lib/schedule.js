const { Octokit } = require("@octokit/rest");
const { createRecords } = require("./collect");
const { createNote } = require("./print");

const refreshFullDose = async (argv) => {
  const octokit = new Octokit({
    auth: argv.token,
  });
  const pulls = await getPulls(argv, octokit);
  console.log("pulls", pulls.length);
  const records = pulls
    .filter(
      (v) =>
        v.merged_at &&
        (v.base.ref.startsWith("alpha") || v.base.ref.startsWith("release"))
    )
    .reverse();
  console.log("records", records.length);
  for (const record of records) {
    const { changed } = await createRecords(
      {
        ...argv,
        pullRequestNumber: record.number,
        pullRequestTitle: record.title,
        repo: argv.fullDoseRepo,
      },
      pulls
    );
    await createNote(
      {
        ...argv,
        pullRequestNumber: record.number,
        pullRequestTitle: record.title,
        repo: argv.fullDoseRepo,
      },
      true
    );
  }
};

const getPulls = async (argv, octokit, page = 1) => {
  const pulls = await octokit
    .request(`GET /repos/{owner}/{repo}/pulls`, {
      owner: argv.owner,
      repo: argv.fullDoseRepo,
      per_page: 100,
      state: "closed",
      page,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    })
    .then((res) => {
      return res.data.map((v) =>
        pick(v, ["number", "title", "base", "head", "merged_at", "state"])
      );
    })
    .catch((e) => {
      console.error(e);
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
