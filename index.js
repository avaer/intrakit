const path = require('path');
const fs = require('fs');
const url = require('url');
const {URL} = url;
const util = require('util');
const parse5 = require('parse5');
const {fromAST, traverseAsync} = require('html-el');
const fetch = require('window-fetch');

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
        const baseUrl = 'file://' + __dirname + '/';
        traverseAsync(html, async el => {
          if (el.tagName === 'LINK') {
            const rel = el.getAttribute('rel');
            if (rel === 'directory') {
              const src = el.getAttribute('src');
              console.log('got directory', src); // XXX
            } else if (rel === 'hostScript') {
              const src = el.getAttribute('src');
              const type = el.getAttribute('type');
              const mode = (() => {
                if (!type || /^(?:(?:text|application)\/javascript|application\/ecmascript)$/.test(type)) {
                  return 'javascript';
                } else if (type === 'application/nodejs') {
                  return 'nodejs';
                } else {
                  return null;
                }
              })();
              if (mode) {
                const url = new URL(src, baseUrl).href;
                fetch(url)
                  .then(res => {
                    if (res.status >= 200 && res.status < 300) {
                      return res.text();
                    } else {
                      return Promise.reject(new Error('invalid status code: ' + res.status));
                    }
                  })
                  .then(s => {
                    if (mode === 'javascript') {
                      console.log('got javascript', s);
                    } else if (mode === 'nodejs') {
                      console.log('got nodejs', s);
                    }
                  })
                  .catch(err => {
                    throw err;
                  });
              } else {
                console.warn(`${fileName}:${el.location.line}:${el.location.col}: ignoring unknown link hostScript type ${JSON.stringify(type)}`);
              }
            } else {
              console.warn(`${fileName}:${el.location.line}:${el.location.col}: ignoring unknown link rel ${JSON.stringify(rel)}`);
            }
          }
        });
      } else {
        throw err;
      }
    });
  } else {
    console.warn('usage: intrakit <fileName>');
    process.exit(1);
  }
}

process.on('uncaughtException', err => {
  console.warn(err.stack);
});
process.on('unhandledRejection', err => {
  console.warn(err.stack);
});
