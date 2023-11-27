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
  getCurrentYarnLock,
} = require("./utils");
const { htmlDir, platforms, suffixs } = require("./const");
const { insertTableRecords } = require("./airtable");

const spawnOpts = {
  shell: true,
  stdio: "pipe",
  encoding: "utf-8",
  windowsHide: true,
};

const PRRERELEASE_HTML = "release-prerelease.html";
const STABLE_HTML = "release-stable.html";
const downloadBaseUrl = "https://download.kungfu-trader.com/";
const releaseBaseUrl = "https://releases.kungfu-trader.com/";

const getArtifactPath = (version) => {
  return `${version.split(".")[0]}/${version}`;
};

const generateHTML = async (argv) => {
  if (!argv.repo.startsWith("kungfu")) {
    return;
  }
  try {
    await createPage(argv, downloadBaseUrl);
    await transfer(argv, `${getArtifactPath(argv.version)}/`);
    await clear();
    await createMenu(argv, releaseBaseUrl);
    await createMetadata(argv, argv.version);
    await transfer(argv);
    await clear();
  } catch (error) {
    console.error(error);
  }
};

const getDownloadList = async (argv, downloadBaseUrl, artifactName) => {
  try {
    const artifactPath = `${artifactName}/${getArtifactPath(argv.version)}/`;
    const source = `s3://${argv.bucketPrebuilt}/${artifactPath}`;
    const result = await awsCall(
      ["s3", "ls", source, "--human-readable"],
      spawnOpts
    );
    const items = result.stdout
      .split("\n")
      .filter((v) => !!v)
      .reduce((acc, cur) => {
        const [date, time, size, sizeUnit, name] = cur
          .split(" ")
          .filter((v) => !!v);
        const isHit = suffixs.some((suffix) => name.endsWith(suffix));
        if (isHit) {
          acc.push({
            date: dateFormat(`${date} ${time}`),
            size: `${size} ${sizeUnit}`,
            name,
            url: `${downloadBaseUrl}${artifactPath}${name}`,
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

const getReleaseNoteList = async (argv, releaseBaseUrl) => {
  try {
    const awsObject = await awsCall(
      [
        "s3api",
        "list-objects-v2",
        `--bucket ${argv.bucketRelease}`,
        `--prefix ${argv.artifactName}/${getArtifactPath(argv.version)}/`,
        `--query "Contents[?contains(Key, 'release-notes')]"`,
      ],
      spawnOpts
    );
    const result = JSON.parse(awsObject.stdout);
    return Object.fromEntries(
      Object.entries({
        mdUrl: result.find((v) => v.Key.endsWith(".md"))?.Key,
        pdfUrl: result.find((v) => v.Key.endsWith(".pdf"))?.Key,
        htmlUrl: result.find((v) => v.Key.endsWith(".html"))?.Key,
        rstUrl: result.find((v) => v.Key.endsWith(".rst"))?.Key,
      })
        .filter((v) => !!v[1])
        .map((v) => [v[0], releaseBaseUrl + v[1]])
    );
  } catch {
    return {};
  }
};

const createPage = async (argv, downloadBaseUrl) => {
  const artifact = getArtifactMap().find((v) =>
    v.name.endsWith(`/${argv.artifactName}`)
  );
  const deps = Object.keys(artifact?.dependencies ?? {});
  const items = artifact
    ? getPkgNameMap(false)
        .filter((v) => deps.includes(v) || v.includes("/example"))
        .sort()
    : [];
  const tableItem = await Promise.all([
    getDownloadList(argv, downloadBaseUrl, argv.artifactName),
    ...items.map((v) =>
      getDownloadList(argv, downloadBaseUrl, v.replace("@kungfu-trader/", ""))
    ),
  ]).then((res) => res.flat(2));
  const releaseNotes = await getReleaseNoteList(argv, releaseBaseUrl);
  const template = fs.readFileSync(
    path.join(__dirname, "../template/release-detail.html"),
    "utf-8"
  );
  const output = mustache.render(template, {
    artifactName: argv.artifactName,
    version: argv.version,
    hasNotes: !!releaseNotes.mdUrl,
    menuUrl: `${releaseBaseUrl}${argv.artifactName}/${
      argv.version.includes("alpha") ? PRRERELEASE_HTML : STABLE_HTML
    }`,
    homeUrl: releaseBaseUrl,
    tableItem,
    created: dateFormat(),
    ...releaseNotes,
    notes: releaseNotes.mdUrl
      ? await axios(releaseNotes.mdUrl)
          .then((res) => res.data)
          .catch(() => null)
      : null,
  });
  const fileName = path.join(process.cwd(), `${htmlDir}/index.html`);
  writeFile(fileName, output, htmlDir);
};

const getPageList = async (argv, releaseBaseUrl) => {
  const awsObject = await awsCall(
    [
      "s3api",
      "list-objects-v2",
      `--bucket ${argv.bucketRelease}`,
      `--prefix ${argv.artifactName}/`,
      `--query "Contents[?ends_with(Key, 'index.html')]"`,
    ],
    spawnOpts
  );
  const result = JSON.parse(awsObject.stdout);
  const sortItems = (items, key) =>
    sortBy(items, (x) => getWeightingNumber(x[key].slice(1), result.length));
  const firstGrades = new Set();
  return result
    .map((items) => {
      const [_, firstGrade, version] = items.Key.split("/");
      const secondGrade = version.replace(/-alpha.\d+/, "");
      firstGrades.add(firstGrade);
      return {
        version,
        firstGrade,
        secondGrade,
        url: `${releaseBaseUrl}${items.Key}`,
        isAlpha: version.includes("-alpha"),
        date: dateFormat(items.LastModified),
        size: items.Size,
      };
    })
    .reduce(
      (acc, cur) => {
        const itemName = cur.isAlpha ? "alphas" : "stables";
        const firstTarget = acc.find((v) => v.key === cur.firstGrade);
        const secondTarget = firstTarget[itemName].find(
          (v) => v.key === cur.secondGrade
        );
        if (secondTarget) {
          secondTarget.items.push(cur);
        } else {
          firstTarget[itemName].push({ key: cur.secondGrade, items: [cur] });
        }
        return acc;
      },
      sortBy([...firstGrades], (v) => v.slice(1) * -1).map((v) => ({
        key: v,
        alphas: [],
        stables: [],
      }))
    )
    .map((v) => ({
      key: v.key,
      alphas: sortItems(
        v.alphas.map((x) => ({
          key: x.key,
          items: sortItems(x.items, "version"),
        })),
        "key"
      ),
      stables: sortItems(v.stables, "key"),
    }));
};

const createMenu = async (argv, releaseBaseUrl) => {
  const tableItem = await getPageList(argv, releaseBaseUrl);
  await createPrereleaseMenu(argv, tableItem);
  await createStableMenu(argv, tableItem);
};

const createStableMenu = async (argv, tableItem) => {
  const template = fs.readFileSync(
    path.join(__dirname, `../template/${STABLE_HTML}`),
    "utf-8"
  );
  const output = mustache.render(template, {
    artifactName: argv.artifactName,
    tableItem,
    homeUrl: releaseBaseUrl,
    created: dateFormat(),
  });
  const fileName = path.join(process.cwd(), `${htmlDir}/${STABLE_HTML}`);
  writeFile(fileName, output, htmlDir);
};

const createPrereleaseMenu = async (argv, tableItem) => {
  const template = fs.readFileSync(
    path.join(__dirname, `../template/${PRRERELEASE_HTML}`),
    "utf-8"
  );
  const output = mustache.render(template, {
    artifactName: argv.artifactName,
    tableItem,
    homeUrl: releaseBaseUrl,
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

const transfer = (argv, link = "") => {
  const source = path.join(process.cwd(), htmlDir);
  const dest = `s3://${argv.bucketRelease}/${argv.artifactName}/${link}`;
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

const dateFormat = (str) => {
  const date = str ? new Date(str) : new Date();
  date.setHours(date.getHours() + 8);
  return date.toLocaleString("zh");
};

const createMetadata = async (argv, version) => {
  if (!argv.apiKey) {
    return;
  }
  const deps = await getCurrentYarnLock();
  deps &&
    (await insertTableRecords({
      apiKey: argv.apiKey,
      baseId: argv.baseId,
      tableId: "pr dependencies",
      records: [
        {
          fields: {
            name: argv.artifactName,
            version: version.replace("v", ""),
            dependencies: JSON.stringify(Object.fromEntries(deps.entries())),
            repo: argv.repo,
            timestamp: Date.parse(new Date())
          },
        },
      ],
    }));
};

module.exports = {
  generateHTML,
  createPage,
  createMenu,
  transfer,
  clear,
};
