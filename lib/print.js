const { Octokit } = require("@octokit/rest");
const { generateHTML } = require("./generate");
const { getTableRecords } = require("./airtable");
const glob = require("glob");
const {
  printMarkDown,
  printRst,
  teleport,
  getYarnLockInfo,
  getCurrentYarnLock,
} = require("./utils");

exports.createNote = async function (argv, useOrigin) {
  const octokit = new Octokit({ auth: argv.token });
  const currentVersion = argv.pullRequestTitle.split(" v")?.[1];
  const lastVersion = getLastVersion(currentVersion);
  const notes = [
    ...(await printRootNote(argv, currentVersion)),
    ...(await printDepNote(
      argv,
      octokit,
      lastVersion,
      currentVersion,
      useOrigin
    )),
  ];
  console.log("notes", notes);
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
    const artifacts =
      (await teleport(argv, currentVersion, argv.fullDoseArtifact)) || [];
    if (!argv.fullDoseArtifact) {
      for (const artifact of artifacts) {
        await generateHTML({
          ...argv,
          bucketRelease: argv.bucketRelease,
          bucketPrebuilt: argv.bucketPrebuilt,
          artifactName: artifact.split("/")[0],
          version: `v${currentVersion}`,
        });
      }
    }
  }
};

const printRootNote = async (argv, version) => {
  const records = await getRecordFromAirtable(argv, {
    repo: argv.repo,
    version,
  });
  return groupByRecords(argv.repo, records);
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
  const [currentHead, currentAlphaString] = current.split("-alpha.");
  const [lastHead, lastAlphaString] = last.split("-alpha.");
  const currentVersion = +currentHead.split(".")[2];
  const lastVersion = +lastHead.split(".")[2];
  const currentAlpha = +currentAlphaString;
  const lastAlpha = +lastAlphaString;

  if (!currentAlpha && !lastAlpha) {
    return result.filter((v) => {
      const [head] = v.version.split("-alpha.");
      const version = +head.split(".")[2];
      return version <= currentVersion && version > lastVersion;
    });
  }

  if (currentAlpha && lastAlpha) {
    return result.filter((v) => {
      let [head, alphaString] = v.version.split("-alpha.");
      const version = +head.split(".")[2];
      const alpha = +alphaString;
      return (
        (version < currentVersion && version > lastVersion) ||
        (version === currentVersion &&
          version === lastVersion &&
          alpha <= currentAlpha &&
          alpha > lastAlpha) ||
        (version === currentVersion &&
          version > lastVersion &&
          alpha <= currentAlpha) ||
        (version < currentVersion &&
          version === lastVersion &&
          alpha > lastAlpha)
      );
    });
  }

  if (!currentAlpha && lastAlpha) {
    return result.filter((v) => {
      let [head, alphaString] = v.version.split("-alpha.");
      const version = +head.split(".")[2];
      const alpha = +alphaString;
      return (
        (version <= currentVersion && version > lastVersion) ||
        (version === currentVersion &&
          version === lastVersion &&
          (isNaN(alpha) || alpha > lastAlpha)) ||
        (version < currentVersion &&
          version === lastVersion &&
          (isNaN(alpha) || alpha > lastAlpha))
      );
    });
  }

  if (currentAlpha && !lastAlpha) {
    return result.filter((v) => {
      let [head, alphaString] = v.version.split("-alpha.");
      const version = +head.split(".")[2];
      const alpha = +alphaString;
      return (
        (version < currentVersion && version > lastVersion) ||
        (version === currentVersion &&
          version > lastVersion &&
          alpha <= currentAlpha)
      );
    });
  }
};

const compareVersion = async (argv, current, last, pkgName, repoSet) => {
  try {
    const currentHead = current.split("-alpha.")[0]?.split(".");
    const lastHead = last.split("-alpha.")[0]?.split(".");
    let gap = lastHead[2] - currentHead[2];
    if (currentHead[0] !== lastHead[0] || currentHead[1] !== lastHead[1]) {
      return;
    }
    let result = [];
    for await (const idx of Array.from({
      length: currentHead[2] - lastHead[2] + 1,
    })) {
      const records = await getRecordFromAirtable(argv, {
        pkgName,
        version: `${currentHead[0]}.${currentHead[1]}.${
          +currentHead[2] + gap++
        }`,
      });
      const repo = records?.[0]?.repo;
      if (repo) {
        records?.[0].pkgName.forEach((v) => repoSet.add(v));
        result = [
          ...groupByRecords(
            repo,
            records,
            "The following dependencies repo are updated "
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
      }
    } else {
      acc.push({
        notes: [cur.title],
        urls: [cur.url],
        extends: [cur.extra || cur.pullRequestTitle],
        version: cur.identify,
        repo,
        description: `${description}${repo} ${cur.identify}`,
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
