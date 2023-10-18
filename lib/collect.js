const { Octokit } = require("@octokit/rest");
const axios = require("axios");
const { getPkgNameMap } = require("./utils");
const sortBy = require("lodash.sortby");
const chunk = require("lodash.chunk");
const omit = require("lodash.omit");
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

const getCommits = (argv, number) => {
  return octokit
    .request(`GET /repos/{owner}/{repo}/pulls/{pull_number}/commits`, {
      owner: argv.owner,
      repo: argv.repo,
      pull_number: number,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    })
    .then((res) => {
      const items = res.data
        .map((v) => v.commit.message)
        .filter((v) => v.startsWith("Merge pull request"))
        .map((v) => v.split("\n")?.[2])
        .filter((v) => v.startsWith("Pre"));
      return items[items.length - 1];
    })
    .catch((e) => console.error(e.message));
};

const checkMerges = async (argv, number, items) => {
  const current = await getCommits(argv, number);
  let history,
    formathHistory,
    idx = 0;
  if (!current) {
    return;
  }
  const format = (val) =>
    val
      .replace("Prerelease v", "")
      .replace("-alpha", "")
      .split(".")
      .map((v) => +v);
  const formatCurrent = format(current);
  for (const item of items.slice(0, 50)) {
    history = await getCommits(argv, item.number);
    if (history) {
      formathHistory = format(history);
      if (
        formathHistory[0] === formatCurrent[0] &&
        formathHistory[1] === formatCurrent[1]
      )
        break;
    }
  }
  if (!history || formathHistory[2] > formatCurrent[2]) {
    return;
  }
  for (const _ of Array.from({
    length: formatCurrent[2] - formathHistory[2] + 1,
  })) {
    const targetVerison = +formathHistory[2] + idx;
    const records = await getTableRecords({
      apiKey: argv.apiKey,
      baseId: argv.baseId,
      tableId: argv.tableId,
      params: {
        filterByFormula: `AND(
            {repo} = "${argv.repo}",
            FIND("${formathHistory[0]}.${formathHistory[1]}.${targetVerison}-alpha", {version})
          )`,
      },
    });
    createAirtableRecord.add(
      records
        .filter((v) => {
          const record = format(v.version);
          return (
            (targetVerison < formatCurrent[2] &&
              targetVerison > formathHistory[2]) ||
            (targetVerison === formatCurrent[2] &&
              targetVerison > formathHistory[2] &&
              record[3] <= formatCurrent[3]) ||
            (targetVerison < formatCurrent[2] &&
              targetVerison === formathHistory[2] &&
              record[3] > formathHistory[3]) ||
            (targetVerison === formatCurrent[2] &&
              targetVerison === formathHistory[2] &&
              record[3] <= formatCurrent[3] &&
              record[3] > formathHistory[3])
          );
        })
        .map((v) => ({
          ...v,
          extra: `MERGE FROM ${v.version}`,
        }))
    );
    idx += 1;
  }
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

  await checkMerges(argv, pullRequestNumber, headAlphaPulls.slice(idx + 1));
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
      res.data.map((v) => ({
        number: v.number,
        title: v.title,
        merged_at: v.merged_at ? Date.parse(new Date(v.merged_at)) : null,
        base: v.base.ref,
      }))
    )
    .catch((e) => {
      console.error(e.message);
      return [];
    });
  if (pull.length < per_page) {
    return pull.filter((v) => v.merged_at);
  }
  return sortBy(
    [...pull, ...(await getPrBatch(argv, option, page + 1))],
    (v) => v.merged_at * -1
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
  add(lists) {
    lists.forEach((v) => {
      if (!this.numbers.has(v.number)) {
        this.records.push({
          fields: {
            ...omit(v, "id", "Created"),
            version: this.argv.version,
          },
        });
        this.numbers.add(v.number);
      }
    });
  }
  async submit(baseId, tableId) {
    if (this.records.length === 0) {
      return;
    }
    for (const records of chunk(this.records, 10)) {
      await axios
        .post(
          `https://api.airtable.com/v0/${baseId}/${tableId}`,
          {
            records,
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
            `submit completed length:${records.length} prnumber:${this.argv.pullRequestNumber}`
          );
        })
        .catch((e) => {
          console.error(
            `submit failed ${e.message} prnumber:${this.argv.pullRequestNumber}`
          );
          console.error(e.stack);
        });
    }
    this.records.length = [];
    this.numbers.clear();
  }
}

const getTableRecords = async ({ apiKey, baseId, tableId, params = {} }) => {
  const res = await axios
    .get(`https://api.airtable.com/v0/${baseId}/${tableId}`, {
      params: {
        ...params,
        pageSize: 100,
      },
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    })
    .then((res) => ({
      offset: res.data.offset,
      data: res.data.records.map((v) => v.fields),
    }))
    .catch((e) => console.error(e.response.data.error, e.response.config));
  if (!res) {
    return false;
  }
  return res.offset
    ? [
        ...res.data,
        ...(await getTableRecords({
          apiKey,
          baseId,
          tableId,
          params: {
            ...params,
            offset: res.offset,
          },
        })),
      ]
    : res.data;
};

const createAirtableRecord = new CreateAirtableRecord();
