const print = require("./print.js");
const collect = require("./collect.js");

const getReleaseNote = async function (argv) {
  await collect.createRecords(argv);
  const notes = await print.createNote(argv);
  return notes.length > 0;
};

module.exports = {
  ...print,
  ...collect,
  getReleaseNote,
};
