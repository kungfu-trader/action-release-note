const print = require("./print.js");
const collect = require("./collect.js");
require("puppeteer/install.js");

const getReleaseNote = async function (argv) {
  await collect.createRecords(argv);
  await print.createNote(argv);
};

module.exports = {
  ...print,
  ...collect,
  getReleaseNote,
};
