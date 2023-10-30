const { Octokit } = require("@octokit/rest");
const sortBy = require("lodash.sortby");
const omit = require("lodash.omit");
const {
  insertTableRecords,
  getTableRecords,
  deleteTableRecords,
} = require("./airtable");
const { getPkgNameMap } = require("./utils");
let octokit, pullsCache;

exports.createRecords = async function (argv, pulls) {
  octokit = new Octokit({
    auth: argv.token,
  });
  pullsCache = pulls;
  await getPrIssues(argv);
  const result = await createAirtableRecord.submit(argv.baseId, argv.tableId);
  return result;
};

const getPrIssues = async (argv) => {
  const current = await getPr(argv, argv.pullRequestNumber);
  const pkgName = await getPkgNames(argv);
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
    pkgName,
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
  return createAirtableRecord.list();
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
    .catch((e) => console.error(e));
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
  for (const item of items) {
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
          ...omit(v, "id"),
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
  const headDevPulls = await getPrBatch(argv, headRef);
  const headAlphaPulls = await getPrBatch(argv, baseRef);
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

const getPrBatch = async (argv, baseRef, page = 1) => {
  if (pullsCache) {
    return sortBy(
      pullsCache
        .filter((v) => v.base.ref === baseRef)
        .map((v) => ({
          number: v.number,
          title: v.title,
          merged_at: v.merged_at ? Date.parse(new Date(v.merged_at)) : null,
          base: v.base.ref,
        })),
      (v) => v.merged_at * -1
    );
  }
  const per_page = 100;
  const pull = await octokit
    .request(`GET /repos/kungfu-trader/${argv.repo}/pulls`, {
      owner: argv.owner,
      repo: argv.repo,
      per_page,
      state: "closed",
      page,
      base: baseRef,
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
    [...pull, ...(await getPrBatch(argv, baseRef, page + 1))],
    (v) => v.merged_at * -1
  );
};

const getPr = async (argv, pullRequestNumber) => {
  const pull = pullsCache
    ? pullsCache.find((v) => +v.number === +pullRequestNumber)
    : await octokit
        .request(`GET /repos/${argv.owner}/${argv.repo}/pulls/${pullRequestNumber}`, {
          owner: argv.owner,
          repo: argv.repo,
          headers: {
            "X-GitHub-Api-Version": "2022-11-28",
          },
        })
        .then((res) => res.data)
        .catch((e) => console.error("get pr error", e.message));
  const result = pull?.state === "closed" && pull.merged_at ? pull : null;
  result && console.log("from request pull", result?.title, pullRequestNumber);
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
    .catch((e) => console.error(e));
  const issues = iss?.repository?.pullRequest?.closingIssuesReferences?.edges;
  createAirtableRecord.collect(issues);
};

const getRepoPackages = async (argv, page = 1) => {
  const packages = await octokit
    .request("GET /orgs/{org}/packages", {
      package_type: "npm",
      org: argv.owner,
      page,
      per_page: 100,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    })
    .then((res) => {
      return res.data;
    })
    .catch((e) => console.error(e));
  if (!packages) {
    return [];
  }
  if (packages.length < 100) {
    return packages;
  }
  return [...packages, ...(await getRepoPackages(argv, page + 1))];
};

const getPkgNames = async (argv) => {
  if (!argv.fullDoseRepo) {
    return getPkgNameMap();
  }
  const packages = await getRepoPackages(argv);
  return packages
    .filter((v) => v.repository?.name === argv.fullDoseRepo)
    .map((v) => `@${argv.owner}/${v.name}`);
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
  list() {
    return this.records;
  }
  async submit(baseId, tableId) {
    const origin = await getTableRecords({
      apiKey: this.argv.apiKey,
      baseId,
      tableId,
      params: {
        filterByFormula: `AND(
            {repo} = "${this.argv.repo}",
            {version} = "${this.argv.version}"
          )`,
      },
    });
    const insertRecords = this.records.filter(
      (v) =>
        !origin.find(
          (x) => +x.number === +v.fields.number && x.title === v.fields.title
        )
    );
    if (insertRecords.length > 0) {
      await insertTableRecords({
        apiKey: this.argv.apiKey,
        baseId,
        tableId,
        records: insertRecords,
      });
    }
    const deleteRecords = origin
      .filter(
        (v) =>
          !this.records.find(
            (x) => +x.fields.number === +v.number && x.fields.title === v.title
          )
      )
      .map((v) => v.id);
    if (deleteRecords.length > 0) {
      await deleteTableRecords({
        apiKey: this.argv.apiKey,
        baseId,
        tableId,
        ids: deleteRecords,
      });
    }
    this.records.length = [];
    this.numbers.clear();
    return {
      changed: deleteRecords.length > 0 || insertRecords.length > 0,
    };
  }
}

const createAirtableRecord = new CreateAirtableRecord();
