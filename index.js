const path = require('path');
const fs = require('fs');
const url = require('url');
const {URL} = url;
const util = require('util');
const parse5 = require('parse5');
const {fromAST, traverseAsync} = require('html-el');

if (require.main === module) {
  const fileName = process.argv[2];
  if (fileName) {
    fs.readFile(fileName, 'utf8', (err, htmlString) => {
      if (!err) {
        const documentAst = parse5.parse(htmlString, {
          locationInfo: true,
        });
        documentAst.tagName = 'document';
        const document = fromAST(documentAst);
        const html = document.childNodes.find(el => el.tagName === 'HTML');
        const baseUrl = path.join('file:///', __dirname);
        traverseAsync(html, async el => {
          if (el.tagName === 'LINK') {
            const rel = el.getAttribute('rel');
            if (rel === 'directory') {
              const src = el.getAttribute('src');
              console.log('got directory', src); // XXX
            } else if (rel === 'hostScript') {
              const src = el.getAttribute('src');
              const url = new URL(src, baseUrl).href;
              console.log('got host script', url); // XXX
            } else {
              console.warn(`${fileName}:${el.location.line}:${el.location.col}: ignoring unknown link`);
            }
          }
        });
      } else {
        throw err;
      }
    });
  } else {
    console.warn('usage: wld <fileName>');
    process.exit(1);
  }
}

process.on('uncaughtException', err => {
  console.warn(err.stack);
});
process.on('unhandledRejection', err => {
  console.warn(err.stack);
});
