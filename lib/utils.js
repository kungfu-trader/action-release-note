const path = require("path");
const fs = require("fs");
const glob = require("glob");
const { spawnSync } = require("child_process");
const { noteDir, pdfDir } = require("./const");
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
  const yarnLockInfo = await getCurrentYarnLock();
  if (yarnLockInfo && yarnLockInfo.size > 0) {
    const obj = {
      version,
      dependencies: Object.fromEntries(yarnLockInfo.entries()),
    };
    writeFile(
      path.join(process.cwd(), `${noteDir}/metadata-v${version}.json`),
      JSON.stringify(obj),
      noteDir
    );
  }
};

const getCurrentYarnLock = () => {
  try {
    const file = fs.readFileSync(path.join(process.cwd(), "yarn.lock"), "utf8");
    return getYarnLockInfo(file);
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

function teleport(argv, version) {
  const { bucketRelease } = argv;
  if (!bucketRelease) {
    return;
  }
  const artifacts = getArtifactNameMap(version);
  const pkgName = getArtifactPath(getPkgConfig().name, version);
  const items = artifacts?.length > 0 ? artifacts : [pkgName];
  const sources = [noteDir, pdfDir]
    .map((v) => path.join(process.cwd(), v))
    .filter((v) => fs.existsSync(v));

  sources.length > 0 &&
    items.forEach((name) => {
      const dest = `s3://${bucketRelease}/${name}`;
      sources.forEach((source) => {
        awsCall([
          "s3",
          "sync",
          source,
          dest,
          "--acl",
          "public-read",
          "--only-show-errors",
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
