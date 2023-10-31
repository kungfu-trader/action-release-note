const path = require("path");
const fs = require("fs");
const glob = require("glob");
const axios = require("axios");
const { spawnSync } = require("child_process");
const { noteDir, pdfDir, htmlDir } = require("./const");
const lockfile = require("@yarnpkg/lockfile");

const spawnOptsInherit = { shell: true, stdio: "inherit", windowsHide: true };

const printMarkDown = async (argv, notes, version) => {
  const content = notes
    .filter((v) => v.notes.length > 0)
    .reduce((acc, cur) => {
      acc += `- ${cur.description}\n`;
      cur.notes.forEach((e, i) => {
        const url = cur.urls?.[i];
        const extend = cur.extends?.[i] ?? "";
        acc += url ? `  - [${e}](${url} "${e}") ${extend}\n` : `  - ${e}\n`;
      });
      acc += "\n";
      return acc;
    }, `# ${argv.repo}\n\n`)
    .slice(0, -1);

  const fileName = path.join(
    process.cwd(),
    `${noteDir}/${argv.repo}-${version}-release-notes.md`
  );
  writeFile(fileName, content, noteDir);
  return { fileName, content };
};

const printRst = (argv, notes, version) => {
  const content = notes
    .filter((v) => v.notes.length > 0)
    .reduce((acc, cur) => {
      acc += `- ${cur.description}\n\n`;
      cur.notes.forEach((e, i) => {
        const url = cur.urls?.[i];
        if (url) {
          acc += `  - \`${e} <${url}>\`_ \n`;
        } else {
          acc += `  - ${e} \n`;
        }
      });
      acc += "\n";
      return acc;
    }, `${argv.repo}\n=========\n\n`)
    .slice(0, -1);

  const fileName = path.join(
    process.cwd(),
    `${noteDir}/${argv.repo}-${version}-release-notes.rst`
  );
  writeFile(fileName, content, noteDir);
  return { fileName, content };
};

const printMetadata = async (argv, version) => {
  if (argv.repo !== "kungfu-trader") {
    return;
  }
  const yarnLockInfo = (await getCurrentYarnLock()) || new Map();
  const str = await axios(
    `https://releases.kungfu-trader.com/${argv.repo}/metadata.txt`
  )
    .then((res) => res.data)
    .catch((e) => console.error(e));
  if (str) {
    const obj = {
      version,
      dependencies: Object.fromEntries(yarnLockInfo.entries()),
    };
    writeFile(
      path.join(process.cwd(), `${htmlDir}/metadata.txt`),
      str + "\n" + JSON.stringify(obj),
      noteDir
    );
  }
};

const getCurrentYarnLock = () => {
  try {
    return getYarnLockInfo(
      fs.readFileSync(path.join(process.cwd(), "yarn.lock"), "utf8")
    );
  } catch (error) {
    console.error(error);
  }
};

const writeFile = (fileName, content, folder) => {
  if (!fs.existsSync(path.join(process.cwd(), folder))) {
    fs.mkdirSync(path.join(process.cwd(), folder));
  }
  fs.writeFileSync(fileName, content);
};

function awsCall(args, opts = spawnOptsInherit) {
  console.log(`$ aws ${args.join(" ")}`);
  const result = spawnSync("aws", args, opts);
  if (result.status !== 0) {
    throw new Error(`Failed to call aws with status ${result.status}`);
  }
  return result;
}

function teleport(argv, version, fullDoseArtifact) {
  const { bucketRelease, fullDoseRepo, repo } = argv;
  let items;
  if (fullDoseArtifact) {
    items = fullDoseArtifact.split(",").map((v) => getArtifactPath(v.trim(), version));
  } else {
    const artifacts = getArtifactNameMap(version);
    const pkgName = getArtifactPath(getPkgConfig().name, version);
    items = artifacts?.length > 0 ? artifacts : [pkgName];
  }
  const sources = [
    `${noteDir}/${fullDoseRepo || repo}-${version}-release-notes.md`,
    `${noteDir}/${fullDoseRepo || repo}-${version}-release-notes.rst`,
    `${pdfDir}/${fullDoseRepo || repo}-${version}-release-notes.pdf`,
    `${pdfDir}/${fullDoseRepo || repo}-${version}-release-notes.html`,
  ]
    .map((v) => path.join(process.cwd(), v))
    .filter((v) => fs.existsSync(v));
  sources.length > 0 &&
    items.forEach((name) => {
      const dest = `s3://${bucketRelease}/${name}`;
      sources.forEach((source) => {
        const items = source.split(".");
        const expanded = items[items.length - 1];
        awsCall([
          "s3",
          "cp",
          source,
          `${dest}/${fullDoseRepo || repo}-${version}-release-notes.${expanded}`,
        ]);
      });
    });
  return items;
}

function getArtifactPath(name, version) {
  return `${name.replace("@kungfu-trader/", "")}/v${
    version.split(".")[0]
  }/v${version}`;
}

const getPkgNameMap = (filterBinary = true) => {
  const cwd = process.cwd();
  const hasLerna = fs.existsSync(path.join(cwd, "lerna.json"));
  const config = getPkgConfig(cwd, hasLerna ? "lerna.json" : "package.json");
  if (hasLerna) {
    const items = config.packages
      .map((x) =>
        glob.sync(`${x}/package.json`).reduce((acc, link) => {
          const { name, binary } = getPkgConfig(cwd, link);
          !(filterBinary && !binary) && acc.push(name);
          return acc;
        }, [])
      )
      .flat();
    return items;
  }
  return [config.name];
};

const getPkgConfig = (cwd, link = "package.json") => {
  return JSON.parse(fs.readFileSync(path.join(cwd || process.cwd(), link)));
};

const getArtifactNameMap = (version) => {
  return getArtifactMap().map((v) => getArtifactPath(v?.name, version));
};

const getArtifactMap = () => {
  const cwd = process.cwd();
  return glob.sync("artifact*/package.json").map((v) => getPkgConfig(cwd, v));
};

const getYarnLockInfo = function (content) {
  if (!content) {
    return;
  }
  const json = lockfile.parse(content);
  return filterBy(json.object).reduce((acc, [key, value]) => {
    acc.set("@" + key.split("@")[1], value.version);
    return acc;
  }, new Map());
};

const filterBy = (items) => {
  if (!items) {
    return [];
  }
  return Object.entries(items).filter(([key]) =>
    key.startsWith("@kungfu-trader/")
  );
};

module.exports = {
  printMarkDown,
  printRst,
  printMetadata,
  teleport,
  getPkgNameMap,
  getPkgConfig,
  awsCall,
  writeFile,
  getArtifactMap,
  getYarnLockInfo,
  getCurrentYarnLock,
};
