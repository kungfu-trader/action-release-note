const { Octokit } = require("@octokit/rest");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const lockfile = require("@yarnpkg/lockfile");

const BASE_ID = "appAdi5zFFEsCzmEM";
const TABLE_ID = "tblJabUQUuS6ywW5Z";

exports.createNote = async function (argv) {
  const octokit = new Octokit({
    auth: argv.token,
  });
  const currentVersion = argv.pullRequestTitle.split(" v")?.[1];
  const lastVersion = getLastVersion(currentVersion);
  const rootNote = await printRootNote(argv, currentVersion);
  const depNote = await printDepNote(argv, octokit, lastVersion);
  printMd(argv, rootNote, depNote);
};

const printMd = (argv, rootNote, depNote) => {
  const str = [...rootNote, ...depNote]
    .filter((v) => v.notes.length > 0)
    .reduce((acc, cur) => {
      acc += `- ${cur.description}\n`;
      cur.notes.forEach((e, i) => {
        const url = cur.urls?.[i];
        if (url) {
          acc += `  - [${e}](${url} "${e}")\n`;
        } else {
          acc += `  - ${e}\n`;
        }
      });
      acc += "\n";
      return acc;
    }, `# ${argv.repo}\n\n`);

  if (!fs.existsSync(path.join(process.cwd(), "notes"))) {
    fs.mkdirSync(path.join(process.cwd(), "notes"));
  }
  fs.writeFileSync(
    path.join(process.cwd(), "notes/release.md"),
    str.slice(0, -1)
  );
};

const printRootNote = async (argv, version) => {
  const records = await getRecordFromAirtable(argv, {
    repo: argv.repo,
    version,
  });
  return groupByRecords(argv.repo, records);
};

const printDepNote = async (argv, octokit, version) => {
  const alters = await getYarnALterList(argv, octokit, version);
  const notes = [];
  const repoSet = new Set();
  if (!alters) {
    return [];
  }
  for await (const item of alters.diff) {
    if (!repoSet.has(item.pkgName)) {
      const result = await diffVersion(
        argv,
        item.current,
        item.last,
        item.pkgName,
        repoSet
      );
      result.forEach((e) => notes.push(e));
    }
  }
  notes.push({
    description: "The following dependencies are added",
    notes: alters.add.map((v) => v.key),
  });
  notes.push({
    description: "The following dependencies are removed",
    notes: alters.delete.map((v) => v.key),
  });
  return notes;
};

const diffVersionCollect = (current, last, result) => {
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

const diffVersion = async (argv, current, last, pkgName, repoSet) => {
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
            "The following dependencies are updated "
          ),
          ...result,
        ];
      }
    }
    return diffVersionCollect(current, last, result);
  } catch (e) {
    console.error(e);
    return;
  }
};

const getYarnALterList = async (argv, octokit, version) => {
  const current = await getCurrentYarnLock();
  const last = await getOriginYarnLock(argv, octokit, version);
  const alters = { diff: [], delete: [], add: [] };
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
      alters.diff.push({ key, current: value, last: last.get(key) });
    }
    current.delete(key);
    last.delete(key);
  });
  last.forEach((value, key) => {
    alters.delete.push({ key });
  });
  return alters;
};

const filterBy = (items) => {
  if (!items) {
    return [];
  }
  return Object.entries(items).filter(([key]) =>
    key.startsWith("@kungfu-trader/")
  );
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
  const result = await axios
    .get(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`, {
      params: {
        filterByFormula,
        sort: [{ field: "version", direction: "desc" }],
        pageSize,
        offset,
      },
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${argv.apiKey}`,
      },
    })
    .then((res) => {
      offset = res.data.offset;
      return res.data.records.map((v) => ({
        ...v.fields,
        id: v.id,
      }));
    })
    .catch((e) => {
      console.error(e.stack);
    });
  if (result?.length === pageSize && offset !== undefined) {
    return [...result, ...(await getRecordFromAirtable(argv, rules, offset))];
  }
  return result;
};

const groupByRecords = (repo, records, description = "") => {
  let result = records.reduce((acc, cur) => {
    const index = acc.findIndex((v) => v.version === cur.version);
    if (index >= 0) {
      acc[index].notes.push(cur.title);
      acc[index].urls.push(cur.url);
    } else {
      acc.push({
        notes: [cur.title],
        urls: [cur.url],
        version: cur.version,
        repo,
        description: `${description}${repo} ${cur.version}`,
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

const getYarnLockInfo = function (content) {
  try {
    const json = lockfile.parse(content);
    return filterBy(json.object).reduce((acc, [key, value]) => {
      acc.set("@" + key.split("@")[1], value.version);
      return acc;
    }, new Map());
  } catch (e) {
    console.error(e);
    return null;
  }
};

const getCurrentYarnLock = () => {
  const file = fs.readFileSync("yarn.lock", "utf8");
  return getYarnLockInfo(file);
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

// const getDepList = () => {
//   const cwd = process.cwd();
//   const hasLerna = fs.existsSync(path.join(cwd, "lerna.json"));
//   const rootPkg = getPkgConfig(cwd, "package.json");
//   const items = [
//     {
//       name: rootPkg.name,
//       dependencies: filterBy(rootPkg.dependencies).map(
//         ([key, value]) => `${key}@${value}`
//       ),
//       root: true,
//     },
//   ];

//   if (hasLerna) {
//     const config = getPkgConfig(cwd, "lerna.json");
//     const pkgs = config.packages
//       .map((x) => glob.sync(`${x}/package.json`))
//       .flat()
//       .map((v) => getPkgConfig(cwd, v));
//     const friendlyForces = pkgs.reduce((acc, cur) => {
//       acc.add(cur.name);
//       return acc;
//     }, new Set());
//     pkgs.forEach((pkg) => {
//       const dependencies = filterBy(pkg.dependencies).filter(
//         ([key]) => !friendlyForces.has(key)
//       );
//       dependencies.length > 0 &&
//         items.push({
//           name: pkg.name,
//           dependencies: dependencies.map(([key, value]) => `${key}@${value}`),
//         });
//     });
//   }
//   return items;
// };

// const getPkgConfig = (cwd, link) => {
//   return JSON.parse(fs.readFileSync(path.join(cwd, link)));
// };
