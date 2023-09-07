const path = require("path");
const fs = require("fs");
const axios = require("axios");
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

const PRRERELEASE_HTML = "release-prerelease.html";
const STABLE_HTML = "release-stable.html";

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
    if (!result?.stdout) {
      return [];
    }
    const items = result.stdout.split("\n").reduce((acc, cur) => {
      const [date, time, byte, name] = cur.split(" ").filter((v) => !!v);
      const isHit = name && suffixs.some((suffix) => name.endsWith(suffix));
      if (isHit) {
        const size = byte > 1024 * 1024 ? byte / 1024 / 1024 : byte / 1024;
        acc.push({
          date: dateFormat(`${date} ${time}`),
          size: +size.toFixed(4) + (byte > 1024 * 1024 ? "MB" : "KB"),
          byte,
          name,
          url: baseUrl + artifactPath + name,
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
    path.join(__dirname, "../template/release-detail.html"),
    "utf-8"
  );
  const mdUrl =
    tableItem.find((v) => v.name.endsWith("release-notes.md"))?.url ||
    tableItem.find((v) => v.name.endsWith("release-note.md"))?.url;

  const options = {
    artifactName: argv.artifactName,
    version: argv.version,
    hasNotes: !!mdUrl,
    menuUrl: `./${
      argv.version.includes("alpha") ? PRRERELEASE_HTML : STABLE_HTML
    }`,
    tableItem,
    created: dateFormat(),
  };
  if (mdUrl) {
    options.mdUrl = mdUrl;
    options.pdfUrl = mdUrl.replace(".md", ".pdf");
    options.htmlUrl = mdUrl.replace(".md", ".html");
    options.rstUrl = mdUrl.replace(".md", ".rst");
    const result = await axios(options.mdUrl)
      .then((res) => res.data)
      .catch(() => null);
    if (result) {
      options.notes = result;
    }
  }
  const output = mustache.render(template, options);
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
        date: dateFormat(`${items[0]} ${items[1]}`),
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
  await createPrereleaseMenu(argv, tableItem, baseUrl);
  await createStableMenu(argv, tableItem, baseUrl);
};

const createStableMenu = async (argv, tableItem, baseUrl) => {
  const template = fs.readFileSync(
    path.join(__dirname, `../template/${STABLE_HTML}`),
    "utf-8"
  );
  const output = mustache.render(template, {
    artifactName: argv.artifactName,
    tableItem: tableItem
      .map((v) => ({
        key: v.key,
        value: v.items.find((x) => !x.name.includes("alpha")),
      }))
      .filter((v) => v.value),
    created: dateFormat(),
  });
  const fileName = path.join(process.cwd(), `${htmlDir}/${STABLE_HTML}`);
  writeFile(fileName, output, htmlDir);
};

const createPrereleaseMenu = async (argv, tableItem, baseUrl) => {
  const template = fs.readFileSync(
    path.join(__dirname, `../template/${PRRERELEASE_HTML}`),
    "utf-8"
  );
  const output = mustache.render(template, {
    artifactName: argv.artifactName,
    tableItem: tableItem.map((v) => ({
      key: v.key,
      items: v.items.filter((x) => x.name.includes("alpha")),
    })),
    created: dateFormat(),
  });
  const fileName = path.join(process.cwd(), `${htmlDir}/${PRRERELEASE_HTML}`);
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

const dateFormat = (str) => {
  const date = str ? new Date(str) : new Date();
  date.setHours(date.getHours() + 8);
  return date.toLocaleString('zh');
};

const scan = async (argv) => {
  const baseUrl = await getS3BaseUrl(argv);
  const source = `s3://${argv.bucketRelease}/${artifactName}/${
    argv.version.split(".")[0]
  }/`;
  const result = await awsCall(["s3", "ls", source], spawnOpts)
    .stdout.split("\n")
    .map((v) => v.replace("PRE", "").trim().slice(0, -1));
  for await (const version of result) {
    await createPage(
      {
        bucketRelease: argv.bucketRelease,
        artifactName: argv.artifactName,
        version,
      },
      baseUrl
    );
  }
  await transfer(argv);
  await clear();
  await createMenu(argv, baseUrl);
  await transfer(argv);
  await clear();
};

module.exports = {
  generateHTML,
  clear,
};
