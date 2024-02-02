const { Octokit } = require("@octokit/rest");
const { getTableRecords } = require("./airtable");
const glob = require("glob");
const {
  printMarkDown,
  printRst,
  teleport,
  getYarnLockInfo,
  getCurrentYarnLock,
} = require("./utils");

const semver = require("semver");

exports.createNote = async function (argv, useOrigin) {
  const octokit = new Octokit({ auth: argv.token });
  const currentVersion = argv.pullRequestTitle.split(" v")?.[1];
  const lastVersion = getLastVersion(currentVersion);
  const notes = [
    ...(await printRootNote(argv, currentVersion, lastVersion)),
    ...(await printDepNote(
      argv,
      octokit,
      lastVersion,
      currentVersion,
      useOrigin
    )),
  ];
  try {
    if (notes.length > 0) {
      await printRst(argv, notes, currentVersion);
      await printMarkDown(argv, notes, currentVersion);
    }
  } catch (error) {
    console.error(error);
  }
  return notes;
};

exports.teleportNotes = async function (argv) {
  const versions = argv.fullDoseArtifact
    ? glob
        .sync("notes/*.md")
        .map((v) =>
          v
            .replace("-release-notes.md", "")
            .replace(`notes/${argv.fullDoseRepo || argv.repo}-`, "")
        )
    : [argv.pullRequestTitle.split(" v")?.[1]];
  for (const currentVersion of versions) {
    await teleport(argv, currentVersion, argv.fullDoseArtifact);
  }
};

const printRootNote = async (argv, currentVersion, lastVersion) => {
  const records = await getRecordFromAirtable(argv, {
    repo: argv.repo,
    version: currentVersion,
  });
  return groupByRecords(argv.repo, records, `${argv.repo} ${lastVersion}->${currentVersion}`);
};

const printDepNote = async (
  argv,
  octokit,
  version,
  currentVersion,
  useOrigin
) => {
  const alters = await getYarnALterList(
    argv,
    octokit,
    version,
    currentVersion,
    useOrigin
  );
  const notes = [];
  const repoSet = new Set();
  if (!alters) {
    return [];
  }
  alters.compare?.length > 0 &&
    notes.push({
      description: "The following dependencies are updated",
      notes: alters.compare.map((v) => `${v.key} ${v.last} -> ${v.current}`),
    });
  for await (const item of alters.compare) {
    if (!repoSet.has(item.key)) {
      const result = await compareVersion(
        argv,
        item.current,
        item.last,
        item.key,
        repoSet
      );
      result && result.forEach((e) => notes.push(e));
    }
  }
  alters.add.length > 0 &&
    notes.push({
      description: "The following dependencies are added",
      notes: alters.add.map((v) => v.key),
    });
  alters.delete.length > 0 &&
    notes.push({
      description: "The following dependencies are removed",
      notes: alters.delete.map((v) => v.key),
    });
  return notes;
};

const compareVersionCollect = (current, last, result) => {
  const [cmajor, cminor, cpatch, calpha] = semverParse(current);
  const [lmajor, lminor, lpatch, lalpha] = semverParse(last);
  if (calpha === undefined && lalpha === undefined) {
    return result.filter((v) => {
      const [vmajor, vminor, vpatch, valpha] = semverParse(v.version);
      return vpatch > lpatch && vpatch <= cpatch;
    });
  }
  return result.filter((v) => {
    const [vmajor, vminor, vpatch, valpha] = semverParse(v.version);
    if (vpatch < cpatch && vpatch > lpatch) {
      return true;
    }
    const points = v.versions.reduce((acc, cur, idx) => {
      const [_major, _minor, _patch, _alpha] = semverParse(cur);
      if (calpha === undefined && cpatch === _patch) {
      } else if (
        (lalpha === undefined && lpatch === _patch) ||
        (_patch === cpatch && _alpha > calpha) ||
        (_patch === lpatch && _alpha <= lalpha)
      ) {
        acc.push(+idx);
      }
      return acc;
    }, []);
    v.versions = v.versions.filter((_, idx) => !points.includes(+idx));
    v.notes = v.notes.filter((_, idx) => !points.includes(+idx));
    v.urls = v.urls.filter((_, idx) => !points.includes(+idx));
    v.extends = v.extends.filter((_, idx) => !points.includes(+idx));
    return true;
  });
};

const semverParse = (version) => {
  const {
    major,
    minor,
    patch,
    prerelease: [_, alpha],
  } = semver.parse(version);
  return [major, minor, patch, alpha];
};

const compareVersion = async (argv, current, last, pkgName, repoSet) => {
  try {
    const [cmajor, cminor, cpatch] = semverParse(current);
    const [lmajor, lminor, lpatch] = semverParse(last);
    if (cmajor !== lmajor || cminor !== lminor) {
      return;
    }
    let result = [];
    for await (const idx of Array.from({
      length: cpatch - lpatch + 1,
    }).keys()) {
      const records = await getRecordFromAirtable(argv, {
        pkgName,
        version: `${cmajor}.${cminor}.${+lpatch + +idx}`,
      });
      const repo = records?.[0]?.repo;
      if (repo && records?.[0].pkgName.includes(pkgName)) {
        records?.[0].pkgName.forEach((v) => repoSet.add(v));
        result = [
          ...groupByRecords(
            repo,
            records,
            `The following dependencies repo are updated ${repo} ${last}->${current} `
          ),
          ...result,
        ];
      }
    }
    return compareVersionCollect(current, last, result);
  } catch (e) {
    console.error(e);
    return;
  }
};

const getYarnALterList = async (
  argv,
  octokit,
  version,
  currentVersion,
  useOrigin
) => {
  const current = useOrigin
    ? await getOriginYarnLock(argv, octokit, currentVersion)
    : await getCurrentYarnLock();
  const last = await getOriginYarnLock(argv, octokit, version);
  const alters = { compare: [], delete: [], add: [] };
  if (!current || !last) {
    return;
  }
  current.forEach((value, key) => {
    const lastValue = last.get(key);
    if (!lastValue) {
      alters.add.push({ key });
      return;
    }
    if (lastValue !== value) {
      alters.compare.push({ key, current: value, last: last.get(key) });
    }
    current.delete(key);
    last.delete(key);
  });
  last.forEach((value, key) => {
    alters.delete.push({ key });
  });
  return alters;
};

const getLastVersion = (version) => {
  const items = version.split(".");
  const tail = items.pop() - 1;
  if (tail < 0) {
    return;
  }
  return [...items, tail].join(".");
};

const getRecordFromAirtable = async (argv, rules, offset = 0) => {
  const pageSize = 100;
  const filterByFormula = filterByFormulaRule(rules);
  const filterVersionHander = filterVersion(rules.version);
  const result = await getTableRecords({
    apiKey: argv.apiKey,
    baseId: argv.baseId,
    tableId: argv.tableId,
    params: {
      filterByFormula,
      sort: [{ field: "version", direction: "desc" }],
      pageSize,
      offset,
    },
  });
  return result
    .map((v) => ({
      ...v,
      identify: rules?.version || v.version,
    }))
    .filter((v) => filterVersionHander(v.version));
};

const filterVersion = (version) => {
  const isAlpha = /-alpha.\d+/.test(version);
  return isAlpha
    ? (val) => val === version
    : (val) => val.replace(/-alpha.\d+/, "") === version;
};
const groupByRecords = (repo, records = [], description = "") => {
  let result = records.reduce((acc, cur) => {
    const index = acc.findIndex((v) => v.version === cur.identify);
    if (index >= 0) {
      if (!acc[index].urls.includes(cur.url)) {
        acc[index].notes.push(cur.title);
        acc[index].urls.push(cur.url);
        acc[index].extends.push(cur.extra || cur.pullRequestTitle);
        acc[index].versions.push(cur.version);
      }
    } else {
      acc.push({
        notes: [cur.title],
        urls: [cur.url],
        extends: [cur.extra || cur.pullRequestTitle],
        versions: [cur.version],
        version: cur.identify,
        repo,
        description,
      });
    }
    return acc;
  }, []);
  if (
    result.length > 1 &&
    !result?.[result.length - 1]?.version?.includes("alpha.")
  ) {
    result.unshift(result.pop());
  }
  return result;
};

const getOriginYarnLock = async (argv, octokit, version) => {
  const res = await octokit
    .request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner: argv.owner,
      repo: argv.repo,
      path: "yarn.lock",
      ref: `v${version}`,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    })
    .catch(() => null);
  if (res?.data?.content) {
    return getYarnLockInfo(
      Buffer.from(res?.data?.content, "base64").toString("utf-8")
    );
  }
};

const filterByFormulaRule = ({ repo, version, pkgName }) => {
  const rules = [];
  repo && rules.push(`{repo} = "${repo}"`);
  version.includes("alpha.")
    ? rules.push(`{version} = "${version}"`)
    : rules.push(`FIND("${version}", {version})`);
  pkgName && rules.push(`FIND("${pkgName}", {pkgName})`);
  const filterByFormula = `AND(
    ${rules.join(",")}
  )`;
  return filterByFormula;
};
