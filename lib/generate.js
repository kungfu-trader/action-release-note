const path = require("path");
const fs = require("fs");
const mustache = require("mustache");
const sortBy = require("lodash.sortby");
const {
  awsCall,
  writeFile,
  getPkgNameMap,
  getArtifactMap,
} = require("./utils");
const { bucketNote, htmlDir } = require("./const");

const spawnOpts = {
  shell: true,
  stdio: "pipe",
  encoding: "utf-8",
  windowsHide: true,
};

const platforms = [
  "linux-x64",
  "linux-x86_64",
  "mac-x64",
  "mac-x86_64",
  "darwin-x64",
  "win-x64",
  "win-x86_64",
  "win32-x64",
];
const suffixs = [
  ".zip",
  ".exe",
  ".dmg",
  ".rpm",
  ".AppImage",
  ".gz",
  ".yml",
  ".pdf",
  ".html",
  ".md",
  ".rst",
];

const generateHTML = async (argv) => {
  // const argv = {
  //   bucketRelease: "kungfu-prebuilt",
  //   artifactName: "artifact-kungfu",
  //   version: "v2.5.6-alpha.18",
  // };
  const baseUrl = await getS3BaseUrl(argv);
  await createPage(argv, baseUrl);
  await transfer(argv);
  await clear();
  await createMenu(argv, baseUrl);
  await transfer(argv);
  await clear();
};

const getDownloadList = async (argv, baseUrl, artifactName) => {
  try {
    const artifactPath = `${artifactName}/${argv.version.split(".")[0]}/${
      argv.version
    }/`;
    const source = `s3://${argv.bucketRelease}/${artifactPath}`;
    const result = await awsCall(["s3", "ls", source], spawnOpts);
    const prefix = baseUrl + artifactPath;
    if (!result?.stdout) {
      return [];
    }
    const items = result.stdout.split("\n").reduce((acc, cur) => {
      const [date, time, byte, name] = cur.split(" ").filter((v) => !!v);
      const isHit = name && suffixs.some((suffix) => name.endsWith(suffix));
      if (isHit) {
        const size = byte > 1024 * 1024 ? byte / 1024 / 1024 : byte / 1024;
        acc.push({
          date: `${date} ${time}`,
          size: +size.toFixed(4) + (byte > 1024 * 1024 ? "MB" : "KB"),
          byte,
          name,
          url: prefix + name,
          platform: platforms.find((v) => name.includes(v)),
        });
      }
      return acc;
    }, []);
    return sortBy(items, ({ name, platform }) =>
      platform
        ? platforms.findIndex((x) => platform.includes(x))
        : suffixs.findIndex((x) => name.endsWith(x)) + platforms.length
    );
  } catch (error) {
    return [];
  }
};

const createPage = async (argv, baseUrl) => {
  const artifactMap = getArtifactMap();
  const deps = Object.keys(
    artifactMap.find((v) => v.name === `@kungfu-trader/${argv.artifactName}`)
      ?.dependencies || {}
  );
  const items = getPkgNameMap(false)
    .filter((v) => deps.includes(v) || v.includes("/example"))
    .sort();
  const tableItem = await Promise.all([
    getDownloadList(argv, baseUrl, argv.artifactName),
    ...items.map((v) =>
      getDownloadList(argv, baseUrl, v.replace("@kungfu-trader/", ""))
    ),
  ]).then((res) => res.flat(2));
  const template = fs.readFileSync(
    path.join(__dirname, "../template/page.html"),
    "utf-8"
  );
  const output = mustache.render(template, {
    artifactName: argv.artifactName,
    version: argv.version,
    pdfUrl: tableItem.find((v) => v.name.endsWith("release-note.pdf"))?.url,
    homeUrl: `${baseUrl}${bucketNote}/menu.html`,
    artifactMenuUrl: `${baseUrl}${bucketNote}/${argv.artifactName}/menu.html`,
    hasPdf: tableItem.some((v) => v.name.includes("note")),
    tableItem,
    created: new Date().toLocaleString(),
  });
  const fileName = path.join(process.cwd(), `${htmlDir}/${argv.version}.html`);
  writeFile(fileName, output, htmlDir);
};

const getPageList = async (argv, baseUrl) => {
  const source = `s3://${argv.bucketRelease}/${bucketNote}/${argv.artifactName}/`;
  const result = await awsCall(["s3", "ls", source], spawnOpts).stdout?.split(
    "\n"
  );
  const groups = result
    .map((v) => {
      const items = v.split(" ");
      const name = items[items.length - 1] || "";
      return {
        name: name.replace(".html", ""),
        root: name
          .replace(".html", "")
          .replace(/-alpha.\d+/, "")
          .slice(1),
        url: `${baseUrl}${bucketNote}/${argv.artifactName}/${name}`,
        number: getWeightingNumber(name, result.length),
        date: `${items[0]} ${items[1]}`,
      };
    })
    .filter((v) => v.name?.startsWith("v"))
    .reduce((acc, cur) => {
      const key = cur.root;
      const target = acc.find((v) => v.key === key);
      target
        ? target?.items?.push(cur)
        : acc.push({
            key,
            items: [cur],
          });
      return acc;
    }, [])
    .map((v) => ({
      key: v.key,
      items: sortBy(v.items, "number"),
    }));
  return sortBy(groups, (v) => getWeightingNumber(v.key, groups.length));
};

const createMenu = async (argv, baseUrl) => {
  const tableItem = await getPageList(argv, baseUrl);
  const template = fs.readFileSync(
    path.join(__dirname, "../template/menu.html"),
    "utf-8"
  );
  const output = mustache.render(template, {
    artifactName: argv.artifactName,
    homeUrl: `${baseUrl}${bucketNote}/menu.html`,
    tableItem,
    created: new Date().toLocaleString(),
  });
  const fileName = path.join(process.cwd(), `${htmlDir}/menu.html`);
  writeFile(fileName, output, htmlDir);
};

const getWeightingNumber = (name, len) => {
  const [v1, v2, v3, v4] = name.replace("-alpha", "").split(".");
  if (v4) {
    return (v4 === "html" ? len : +v4) * -1;
  }
  return (v1 * len * 100 + v2 * len + +v3) * -1;
};

const getS3BaseUrl = async ({ bucketRelease }) => {
  const s3Location = awsOutput([
    "s3api",
    "get-bucket-location",
    "--bucket",
    bucketRelease,
    "--output",
    "text",
  ]);
  const s3BaseUrlGlobal = `https://${bucketRelease}.s3.amazonaws.com/`;
  const s3BaseUrlCN = `https://${bucketRelease}.s3.${s3Location}.amazonaws.com.cn/`;
  return s3Location.startsWith("cn") ? s3BaseUrlCN : s3BaseUrlGlobal;
};

const transfer = (argv) => {
  const source = path.join(process.cwd(), htmlDir);
  const dest = `s3://${argv.bucketRelease}/${bucketNote}/${argv.artifactName}/`;
  awsCall([
    "s3",
    "sync",
    source,
    dest,
    "--acl",
    "public-read",
    "--only-show-errors",
  ]);
};

const clear = () => {
  fs.rmdirSync(path.join(process.cwd(), htmlDir), {
    force: true,
    recursive: true,
  });
};

function awsOutput(args) {
  const result = awsCall(args, spawnOpts);
  return result.output
    .filter((e) => e && e.length > 0)
    .toString()
    .trimEnd();
}

module.exports = {
  generateHTML,
  clear,
};
