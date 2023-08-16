const { Octokit } = require("@octokit/rest");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const glob = require("glob");

let octokit;
const pullCollect = new Map();
const BASE_ID = "appAdi5zFFEsCzmEM";
const TABLE_ID = "tblJabUQUuS6ywW5Z";

exports.createRecords = async function (argv) {
  octokit = new Octokit({
    auth: argv.token,
  });
  await getPrIssues(argv);
};

const getPkgNameMap = () => {
  const cwd = process.cwd();
  const hasLerna = fs.existsSync(path.join(cwd, "lerna.json"));
  const config = getPkgConfig(cwd, hasLerna ? "lerna.json" : "package.json");
  if (hasLerna) {
    const items = config.packages
      .map((x) =>
        glob
          .sync(`${x}/package.json`)
          .map((link) => getPkgConfig(cwd, link).name)
      )
      .flat();
    return items;
  }
  return [config.name];
};

const getPkgConfig = (cwd, link) => {
  return JSON.parse(fs.readFileSync(path.join(cwd, link)));
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
    await traversePr(argv, argv.pullRequestNumber - 1, baseRef, headRef);
  }
  if (baseRef.startsWith("release/")) {
    await findIssues(argv, argv.pullRequestNumber);
  }
  await createAirtableRecord.submit();
};

const traversePr = async (
  argv,
  pullRequestNumber,
  baseRef,
  headRef,
  count = 0
) => {
  if (pullRequestNumber <= 0 || count > 200) {
    return;
  }
  const pull = await getPr(argv, pullRequestNumber);
  if (pull?.base?.ref === headRef) {
    createAirtableRecord.updateArgs({
      pullRequestTitle: pull.title,
      pullRequestNumber: pull.number,
    });
    await findIssues(argv, pullRequestNumber);
  }
  if ([headRef, baseRef].includes(pull?.head?.ref)) {
    return;
  }
  await traversePr(argv, pullRequestNumber - 1, baseRef, headRef, count + 1);
};

const getPr = async (argv, pullRequestNumber) => {
  const memo = pullCollect.get(pullRequestNumber);
  if (memo !== undefined) {
    console.log("from cache", memo?.title, pullRequestNumber);
    return memo;
  }
  const pull = await octokit
    .request(
      `GET /repos/kungfu-trader/${argv.repo}/pulls/${pullRequestNumber}`,
      {
        owner: "kungfu-trader",
        repo: argv.repo,
        headers: {
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    )
    .catch((e) => console.error('get pr error', e.message));

  const result =
    pull?.data?.state === "closed" && pull.data.merged ? pull.data : null;
  pullCollect.size >= 1000 && pullCollect.clear();
  pullCollect.set(pullRequestNumber, result);
  console.log("from request", result?.title, pullRequestNumber);
  return result;
};

const findIssues = async (argv, pullRequestNumber) => {
  const iss = await octokit.graphql(`
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
  `).catch(e => console.error(e.message));
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
  submit() {
    if (this.records.length === 0) {
      return;
    }
    return axios
      .post(
        `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`,
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
