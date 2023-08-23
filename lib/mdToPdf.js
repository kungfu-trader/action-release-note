const puppeteer = require("puppeteer");
const showdown = require("showdown");
const mustache = require("mustache");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

const PDFLayout = {
  format: "A4",
  scale: 1,
  displayHeaderFooter: false,
  margin: { top: 50, bottom: 50, right: 50, left: 50 },
};
class MarkdownToPDF {
  constructor(options = {}) {
    this.options = options;
    this.template = fs.readFileSync(
      path.join(__dirname, "../template.html"),
      "utf-8"
    );
  }
  start() {}
  close() {}
  async convert(content) {
    const html = this.convertHtml(content);
    let browser;
    try {
      const config = {
        headless: "new",
        args: [
          `--no-sandbox`,
          `--headless`,
          `--disable-gpu`,
          `--disable-dev-shm-usage`,
        ],
      };
      await installPuppeteer();
      const chromePath = await findChromePath();
      if (chromePath) {
        config.executablePath = chromePath;
      }
      browser = await puppeteer.launch(config);
      const page = await browser.newPage();
      await page.goto("data:text/html;,<h1>Not Rendered</h1>", {
        waitUntil: "domcontentloaded",
        timeout: 2000,
      });
      await page.setContent(html);
      const pdf = await page.pdf(PDFLayout);
      await browser.close();
      return { pdf, html };
    } catch (error) {
      console.error(error);
      browser?.close();
    }
  }

  convertHtml(text) {
    const converter = new showdown.Converter();
    const content = converter.makeHtml(text);
    const output = mustache.render(this.template, {
      title: this.options.title || "release-note",
      content,
    });
    return output;
  }
}

const findChromePath = async () => {
  return new Promise((resolve) => {
    exec("which google-chrome", function (error, stdout, stderr) {
      if (error) {
        resolve();
      }
      console.log("findChromePath: " + stdout);
      resolve(stdout);
    });
  });
};

const installPuppeteer = async () => {
  return new Promise((resolve) => {
    exec("yarn add puppeteer", function (error) {
      exec("node node_modules/puppeteer/install.js", function (error, stdout) {
        console.log("installPuppeteer: " + stdout);
        resolve();
      });
    });
  });
};

exports.MarkdownToPDF = MarkdownToPDF;
