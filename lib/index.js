const print = require("./print.js");
const collect = require("./collect.js");
const schedule = require('./schedule.js')

const createReleaseNote = async function (argv) {
  await collect.createRecords(argv);
  const notes = await print.createNote(argv);
  return notes;
};

module.exports = {
  ...print,
  ...collect,
  ...schedule,
  createReleaseNote,
};
