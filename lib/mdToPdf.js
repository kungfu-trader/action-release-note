const puppeteer = require("puppeteer");
const showdown = require("showdown");
const mustache = require("mustache");
const path = require("path");
const fs = require("fs");

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
      browser = await puppeteer.launch({
        headless: true,
        args: [
          "--headless",
          "--no-sandbox",
          "--disable-gpu",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--single-process",
        ],
      });
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

exports.MarkdownToPDF = MarkdownToPDF;
