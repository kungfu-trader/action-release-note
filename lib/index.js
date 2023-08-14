const print = require("./print.js");
const upload = require("./upload.js");

const getReleaseNote = async function (argv) {
  await upload.createRecords(argv);
  await print.createNote(argv);
};

module.exports = {
  ...print,
  ...upload,
  getReleaseNote,
};
