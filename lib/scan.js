const { awsCall, getYarnLockInfo } = require("./utils");
const { createPage, createMenu, transfer, clear } = require("./generate");
const { Octokit } = require("@octokit/rest");

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

const moveReleaseNote = async (argv) => {
  for (const filename of ["notes.md", "notes.rst", "notes.pdf", "notes.html"]) {
    const awsObject = await awsCall(
      [
        "s3api",
        "list-objects-v2",
        `--bucket ${argv.bucketPrebuilt}`,
        `--prefix artifact-kungfu/v2/`,
        `--query "Contents[?ends_with(Key, '${filename}')]"`,
      ],
      spawnOpts
    );
    const result = JSON.parse(awsObject.stdout);
    for await (const item of result) {
      awsCall([
        "s3",
        "mv",
        `s3://${argv.bucketPrebuilt}/${item.Key}`,
        `s3://${argv.bucketRelease}/${item.Key}`.replace("note", "notes"),
        "--acl",
        "public-read",
        "--only-show-errors",
      ]);
    }
  }
};

const scanFullPage = async (argv) => {
  // const source = `s3://${argv.bucketPrebuilt}/${argv.artifactName}/${
  //   argv.version.split(".")[0]
  // }/`;
  // const result = await awsCall(["s3", "ls", source], spawnOpts)
  //   .stdout.split("\n")
  //   .map((v) => v.replace("PRE", "").trim().slice(0, -1))
  //   .filter((v) => v);
  // for await (const version of result) {
  //   await createPage(
  //     {
  //       bucketRelease: argv.bucketRelease,
  //       bucketPrebuilt: argv.bucketPrebuilt,
  //       artifactName: argv.artifactName,
  //       version,
  //     },
  //     downloadBaseUrl
  //   );
  //   await transfer(argv, `${getArtifactPath(version)}/`);
  //   await clear();
  // }
  await createMenu(argv, releaseBaseUrl);
  await transfer(argv);
  await clear();
};

const scanCoreVersion = async(argv) => {
  const octokit = new Octokit({ auth: argv.token });
  const source = `s3://kungfu-releases/kungfu-trader/v1/`;
  const result = await awsCall(["s3", "ls", source], spawnOpts)
    .stdout.split("\n")
    .map((v) => v.replace("PRE", "").trim().slice(0, -1))
    .filter((v) => v);
  
  console.log(result)
  getCoreVersion(octokit, argv, 'v1.1.0')
};

const getCoreVersion = async(octokit, argv, version) => {
  const res = await octokit
  .request("GET /repos/{owner}/{repo}/contents/{path}", {
    owner: argv.owner,
    repo: argv.repo,
    path: "yarn.lock",
    ref: version,
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
    },
  })
  .then(res => getYarnLockInfo(
    Buffer.from(res?.data?.content, "base64").toString("utf-8")
  ))
  .catch((error) => console.error(error));
  console.log(res);
}

module.exports = { moveReleaseNote, scanFullPage, scanCoreVersion };
