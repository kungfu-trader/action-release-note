const path = require("path");
const fs = require("fs");
const glob = require("glob");
const { mdToPdf } = require("md-to-pdf");
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
  await markDownToPdf(fileName);
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

const writeFile = (fileName, content) => {
  if (!fs.existsSync(path.join(process.cwd(), "notes"))) {
    fs.mkdirSync(path.join(process.cwd(), "notes"));
  }
  fs.writeFileSync(fileName, content);
};

const markDownToPdf = async (fileName) => {
  const pdf = await mdToPdf({ path: fileName });
  if (pdf) {
    fs.writeFileSync(fileName.replace(".md", ".pdf"), pdf.content);
    fs.writeFileSync(fileName.replace(".md", ".html"), pdf.html);
  }
  return pdf;
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
  const source = path.join(process.cwd(), "notes");

  getPkgNameMap().forEach((name) => {
    const dest = `s3://${bucketRelease}/${getArtifactPath(name, version)}`;
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

const getPkgConfig = (cwd, link = 'package.json') => {
  return JSON.parse(fs.readFileSync(path.join(cwd || process.cwd(), link)));
};

module.exports = { printMarkDown, printRst, teleport, getPkgNameMap, getPkgConfig };
