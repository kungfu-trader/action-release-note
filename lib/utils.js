const path = require("path");
const fs = require("fs");
const glob = require("glob");
const { spawnSync } = require("child_process");

const spawnOptsInherit = { shell: true, stdio: "inherit", windowsHide: true };

const printMarkDown = async (argv, notes, version) => {
  const content = notes
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
    }, `# ${argv.repo}\n\n`)
    .slice(0, -1);

  const fileName = path.join(
    process.cwd(),
    `notes/${argv.repo}-${version}-release-note.md`
  );
  writeFile(fileName, content);
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
    `notes/${argv.repo}-${version}-release-note.rst`
  );
  writeFile(fileName, content);
  return { fileName, content };
};

const writeFile = (fileName, content, folder = "notes") => {
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
  if (!artifacts || artifacts.length === 0) {
    return;
  }
  const sources = ["notes", "pdfs"]
    .map((v) => path.join(process.cwd(), v))
    .filter((v) => fs.existsSync(v));

  sources.length > 0 &&
    artifacts.forEach((name) => {
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
  return artifacts;
}

function getArtifactPath(name, version) {
  return `${name.replace("@kungfu-trader/", "")}/v${
    version.split(".")[0]
  }/v${version}`;
}

const getPkgNameMap = () => {
  const cwd = process.cwd();
  const hasLerna = fs.existsSync(path.join(cwd, "lerna.json"));
  const config = getPkgConfig(cwd, hasLerna ? "lerna.json" : "package.json");
  if (hasLerna) {
    const items = config.packages
      .map((x) =>
        glob.sync(`${x}/package.json`).reduce((acc, link) => {
          const { name, binary } = getPkgConfig(cwd, link);
          binary && acc.push(name);
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
  const cwd = process.cwd();
  return glob
    .sync("artifact*/package.json")
    .map((v) => getArtifactPath(getPkgConfig(cwd, v)?.name, version));
};

module.exports = {
  printMarkDown,
  printRst,
  teleport,
  getPkgNameMap,
  getPkgConfig,
  awsCall,
  writeFile,
};
