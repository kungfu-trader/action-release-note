// const {
//   awsCall,
//   getYarnLockInfo,
//   printMarkDown,
//   printRst,
//   teleport,
// } = require("./utils");
// const { createPage, createMenu, transfer, clear } = require("./generate");
// const { Octokit } = require("@octokit/rest");
// const { htmlDir } = require("./const");
// const fs = require("fs");
// const path = require("path");
// const axios = require("axios");
// const { spawnSync } = require("child_process");

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
//   const source = `s3://kungfu-releases/kungfu-trader/v1/`;
//   const result = await awsCall(["s3", "ls", source], spawnOpts)
//     .stdout.split("\n")
//     .map((v) => v.replace("PRE", "").trim().slice(0, -1))
//     .filter((v) => v);

//   const writerStream = fs.createWriteStream(
//     path.join(process.cwd(), `${htmlDir}/metadata.txt`)
//   );
//   for (const version of result) {
//     const yarnLockInfo = await getCoreVersion(octokit, argv, version);
//     if (yarnLockInfo) {
//       const obj = {
//         version,
//         coreVersion: yarnLockInfo.get("@kungfu-trader/kungfu-core"),
//       };
//       writerStream.write("\n" + JSON.stringify(obj), "UTF-8");
//     }
//   }
//   writerStream.end();
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
//   const result = await getAirtableFullData(argv);
//   const items = result
//     .filter((v) => v.fields.repo === "kungfu")
//     .map((v) => ({
//       ...v.fields,
//       id: v.id,
//       createdTime: v.createdTime,
//     }));

//   const keys = items.reduce((acc, cur) => {
//     acc.add(cur.version);
//     return acc;
//   }, new Set());
//   for (const version of new Set(
//     [...keys].map((v) => v.replace(/-alpha.\d+/, ""))
//   )) {
//     const notes = items
//       .filter((v) => v.version.replace(/-alpha.\d+/, "") === version)
//       .reduce(
//         (acc, cur) => {
//           if (!acc.urls.includes(cur.url)) {
//             acc.notes.push(cur.title);
//             acc.urls.push(cur.url);
//             acc.extends.push(cur.pullRequestTitle);
//           }
//           return acc;
//         },
//         {
//           notes: [],
//           urls: [],
//           extends: [],
//           version,
//           repo: "kungfu",
//           description: `kungfu ${version}`,
//         }
//       );
//     await printRst({ repo: "kungfu" }, [notes], version);
//     await printMarkDown({ repo: "kungfu" }, [notes], version);
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
//     await teleport(argv, version);
//     fs.rmdirSync(path.join(process.cwd(), "notes"), {
//       force: true,
//       recursive: true,
//     });
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
