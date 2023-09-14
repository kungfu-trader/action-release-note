// const {
//   awsCall,
//   getYarnLockInfo,
//   writeFile,
//   teleport,
// } = require("./utils");
// const { createPage, createMenu, transfer, clear } = require("./generate");
// const { Octokit } = require("@octokit/rest");
// const { htmlDir } = require("./const");
// const fs = require("fs");
// const path = require("path");
// const axios = require("axios");
// const { spawnSync } = require("child_process");
// const { createNote } = require('./print')

// const spawnOpts = {
//   shell: true,
//   stdio: "pipe",
//   encoding: "utf-8",
//   windowsHide: true,
// };

// const downloadBaseUrl = "https://download.kungfu-trader.com/";
// const releaseBaseUrl = "https://releases.kungfu-trader.com/";

// const getArtifactPath = (version) => {
//   return `${version.split(".")[0]}/${version}`;
// };

// const moveReleaseNote = async (argv) => {
//   for (const filename of ["notes.md", "notes.rst", "notes.pdf", "notes.html"]) {
//     const awsObject = await awsCall(
//       [
//         "s3api",
//         "list-objects-v2",
//         `--bucket ${argv.bucketPrebuilt}`,
//         `--prefix artifact-kungfu/v2/`,
//         `--query "Contents[?ends_with(Key, '${filename}')]"`,
//       ],
//       spawnOpts
//     );
//     const result = JSON.parse(awsObject.stdout);
//     for await (const item of result) {
//       awsCall([
//         "s3",
//         "mv",
//         `s3://${argv.bucketPrebuilt}/${item.Key}`,
//         `s3://${argv.bucketRelease}/${item.Key}`.replace("note", "notes"),
//         "--acl",
//         "public-read",
//         "--only-show-errors",
//       ]);
//     }
//   }
// };

// const scanFullPage = async (argv) => {
//   const source = `s3://${argv.bucketPrebuilt}/${argv.artifactName}/${
//     argv.version.split(".")[0]
//   }/`;
//   const result = await awsCall(["s3", "ls", source], spawnOpts)
//     .stdout.split("\n")
//     .map((v) => v.replace("PRE", "").trim().slice(0, -1))
//     .filter((v) => v);
//   for await (const version of result) {
//     await createPage(
//       {
//         bucketRelease: argv.bucketRelease,
//         bucketPrebuilt: argv.bucketPrebuilt,
//         artifactName: argv.artifactName,
//         version,
//       },
//       downloadBaseUrl
//     );
//     await transfer(argv, `${getArtifactPath(version)}/`);
//     await clear();
//   }
//   await createMenu(argv, releaseBaseUrl);
//   await transfer(argv);
//   await clear();
// };

// const scanCoreVersion = async (argv) => {
//   const octokit = new Octokit({ auth: argv.token });
//   const source = `s3://kungfu-releases/kungfu-trader/v2/`;
//   const result = await awsCall(["s3", "ls", source], spawnOpts)
//     .stdout.split("\n")
//     .map((v) => v.replace("PRE", "").trim().slice(0, -1))
//     .filter((v) => v);

//   for (const version of result) {
//     const yarnLockInfo = await getCoreVersion(octokit, argv, version);
//     if (yarnLockInfo) {
//       const obj = {
//         version,
//         dependencies: Object.fromEntries(yarnLockInfo.entries()),
//       };
//       writeFile(path.join(process.cwd(), `${htmlDir}/metadata-${version}.json`), JSON.stringify(obj), htmlDir);
//       await transfer(argv, `${getArtifactPath(version)}/`);
//       await clear();
//     }
//   }
// };

// const getCoreVersion = (octokit, argv, version) => {
//   return octokit
//     .request("GET /repos/{owner}/{repo}/contents/{path}", {
//       owner: argv.owner,
//       repo: argv.repo,
//       path: "yarn.lock",
//       ref: version,
//       headers: {
//         "X-GitHub-Api-Version": "2022-11-28",
//       },
//     })
//     .then((res) =>
//       getYarnLockInfo(
//         Buffer.from(res?.data?.content, "base64").toString("utf-8")
//       )
//     )
//     .catch((error) => console.error(error));
// };

// const scanReleaseNote = async (argv) => {
//   let i = 15;
//   for (const version of Array.from({length: 14})) {
//     await createNote({
//       ...argv,
//       pullRequestTitle: `Release v1.0.${i}`
//     })
//     await spawnSync("md-to-pdf", ["notes/*.md", "--highlight-style monokai"], {
//       shell: true,
//       stdio: "inherit",
//       windowsHide: true,
//     });
//     await spawnSync(
//       "md-to-pdf",
//       ["notes/*.md", "--as-html", "--highlight-style monokai"],
//       { shell: true, stdio: "inherit", windowsHide: true }
//     );
//     await teleport(argv, `1.0.${i}`);
//     fs.rmdirSync(path.join(process.cwd(), "notes"), {
//       force: true,
//       recursive: true,
//     });
//     i -= 1;
//   }
// };

// const getAirtableFullData = async (argv, offset = 0) => {
//   const result = await axios
//     .get(`https://api.airtable.com/v0/${argv.baseId}/${argv.tableId}`, {
//       params: {
//         sort: [{ field: "version", direction: "desc" }],
//         pageSize: 100,
//         offset,
//       },
//       headers: {
//         "Content-Type": "application/json",
//         Authorization: `Bearer ${argv.apiKey}`,
//       },
//     })
//     .then((res) => res.data)
//     .catch(() => null);

//   if (result.records.length < 100) {
//     return result.records;
//   }
//   return [
//     ...result.records,
//     ...(await getAirtableFullData(argv, result.offset)),
//   ];
// };

// module.exports = {
//   moveReleaseNote,
//   scanFullPage,
//   scanCoreVersion,
//   scanReleaseNote,
// };
