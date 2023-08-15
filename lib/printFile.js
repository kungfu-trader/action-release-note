const path = require("path");
const fs = require("fs");

const printMarkDown = (argv, rootNote, depNote, version) => {
  const content = [...rootNote, ...depNote]
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
    `notes/${argv.repo}-${version}-${Date.now()}.md`
  );
  writeFile(fileName, content);
  return { fileName, content };
};

const printRst = (argv, rootNote, depNote, version) => {
  const content = [...rootNote, ...depNote]
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
    `notes/${argv.repo}-${version}-${Date.now()}.rst`
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

module.exports = { printMarkDown, printRst };
