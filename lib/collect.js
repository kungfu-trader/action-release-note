const { Octokit } = require("@octokit/rest");
const axios = require("axios");
const { getPkgNameMap } = require("./utils");
const sortBy = require("lodash.sortby");
let octokit;

exports.createRecords = async function (argv) {
  octokit = new Octokit({
    auth: argv.token,
  });
  await getPrIssues(argv);
};

const getPrIssues = async (argv) => {
  const current = await getPr(argv, argv.pullRequestNumber);
  if (!current) {
    return;
  }
  const baseRef = current.base.ref;
  const headRef = current.head.ref;
  if (!baseRef.startsWith("alpha/") && !baseRef.startsWith("release/")) {
    return;
  }
  createAirtableRecord.updateArgs({
    ...argv,
    pullRequestTitle: current.title,
    pullRequestNumber: current.number,
    version: current.title.split(" v")?.[1],
    pkgName: getPkgNameMap(),
  });
  if (baseRef.startsWith("alpha/")) {
    await findIssues(argv, argv.pullRequestNumber);
    await traversePr(
      argv,
      argv.pullRequestNumber,
      baseRef,
      headRef,
      Date.parse(new Date(current.merged_at))
    );
  }
  if (baseRef.startsWith("release/")) {
    await findIssues(argv, argv.pullRequestNumber);
  }
  await createAirtableRecord.submit(argv.baseId, argv.tableId);
};

const traversePr = async (
  argv,
  pullRequestNumber,
  baseRef,
  headRef,
  rightRange
) => {
  const headDevPulls = await getPrBatch(argv, { base: headRef });
  const headAlphaPulls = await getPrBatch(argv, { base: baseRef });
  const idx = headAlphaPulls.findIndex((v) => v.number === pullRequestNumber);
  const leftRange = headAlphaPulls[idx + 1]?.merged_at || 0;
  const items = headDevPulls.filter(
    (v) => v.merged_at >= leftRange && v.merged_at <= rightRange
  );

  for await (const pull of items) {
    createAirtableRecord.updateArgs({
      pullRequestTitle: pull.title,
      pullRequestNumber: pull.number,
    });
    await findIssues(argv, pull.number);
  }
};

const getPrBatch = async (argv, option, page = 1) => {
  const per_page = 100;
  const pull = await octokit
    .request(`GET /repos/kungfu-trader/${argv.repo}/pulls`, {
      owner: argv.owner,
      repo: argv.repo,
      per_page,
      state: "closed",
      page,
      ...option,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    })
    .then((res) =>
      res.data
        .filter((v) => v.merged_at)
        .map((v) => ({
          number: v.number,
          title: v.title,
          merged_at: Date.parse(new Date(v.merged_at)),
          base: v.base.ref,
        }))
    )
    .catch((e) => {
      console.error(e.message);
      return [];
    });
  if (pull.length < per_page) {
    return pull;
  }
  return sortBy(
    [...pull, ...(await getPrBatch(argv, base, page + 1))],
    "merged_at"
  );
};

const getPr = async (argv, pullRequestNumber) => {
  const pull = await octokit
    .request(
      `GET /repos/kungfu-trader/${argv.repo}/pulls/${pullRequestNumber}`,
      {
        owner: argv.owner,
        repo: argv.repo,
        headers: {
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    )
    .catch((e) => console.error("get pr error", e.message));

  const result =
    pull?.data?.state === "closed" && pull.data.merged ? pull.data : null;
  console.log("from request pull", result?.title, pullRequestNumber);
  return result;
};

const findIssues = async (argv, pullRequestNumber) => {
  const iss = await octokit
    .graphql(
      `
    query{
      repository(name: "${argv.repo}", owner: "${argv.owner}") {
        pullRequest(number: ${pullRequestNumber}) {
          title
          closingIssuesReferences (first: 100) {
            edges {
              node {
                number
                body
                title,
                url
              }
            }
          }
        }
      }
    } 
  `
    )
    .catch((e) => console.error(e.message));
  const issues = iss?.repository?.pullRequest?.closingIssuesReferences?.edges;
  createAirtableRecord.collect(issues);
};

class CreateAirtableRecord {
  constructor(argv) {
    this.records = [];
    this.argv = argv || {};
    this.numbers = new Set();
  }
  updateArgs(argv) {
    Object.assign(this.argv, argv);
  }
  collect(lists) {
    lists.forEach((v) => {
      if (!this.numbers.has(v.node.number)) {
        this.records.push({
          fields: {
            ...v.node,
            repo: this.argv.repo,
            owner: this.argv.owner,
            pullRequestTitle: this.argv.pullRequestTitle,
            pullRequestNumber: this.argv.pullRequestNumber,
            version: this.argv.version,
            pkgName: this.argv.pkgName,
          },
        });
        this.numbers.add(v.node.number);
      }
    });
  }
  submit(baseId, tableId) {
    if (this.records.length === 0) {
      return;
    }
    return axios
      .post(
        `https://api.airtable.com/v0/${baseId}/${tableId}`,
        {
          records: this.records,
          typecast: true,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.argv.apiKey}`,
          },
        }
      )
      .then(() => {
        console.log(
          `submit completed length:${this.records.length} prnumber:${this.argv.pullRequestNumber}`
        );
      })
      .catch((e) => {
        console.error(
          `submit failed ${e.message} prnumber:${this.argv.pullRequestNumber}`
        );
        console.error(e.stack);
      })
      .finally(() => {
        this.records.length = [];
        this.numbers.clear();
      });
  }
}

const createAirtableRecord = new CreateAirtableRecord();
