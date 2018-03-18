const util = require('util');
const path = require('path');
const fs = require('fs');
const url = require('url');
const {URL} = url;
const http = require('http');
const child_process = require('child_process');
const os = require('os');

const express = require('express');
const expressPut = require('express-put')(express);
const parse5 = require('parse5');
const {Node, fromAST, traverseAsync} = require('html-el');
const selector = require('selector-lite');
const fetch = require('window-fetch');
const windowEval = require('window-eval-native');
const tmp = require('tmp');

let port = parseInt(process.env['PORT'], 10) || 8000;

const npmCommands = {
  install: {
    cmd: [
      'node', require.resolve('yarn/bin/yarn.js'), 'add',
    ],
  },
};

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

        const _makeContext = () => {
          const localPort = port++;
          const context = {
            window: null,
            console,
            process: new Proxy(process, {
              get(target, key, value) {
                if (key === 'env') {
                  return Object.assign({}, target.env, {
                    PORT: localPort,
                  });
                } else {
                  return target[key];
                }
              },
            }),
          };
          context.window = context;
          return context;
        };

        traverseAsync(html, async el => {
          if (el.tagName === 'LINK') {
            const rel = el.getAttribute('rel');
            if (rel === 'directory') {
              const name = el.getAttribute('name');
              const src = el.getAttribute('src');
              if (name && src) {
                await new Promise((accept, reject) => {
                  const server = http.createServer(expressPut(src, path.join('/', name)));
                  server.listen(port++, err => {
                    if (!err) {
                      server.unref();
                      accept();
                    } else {
                      reject(err);
                    }
                  });
                });
              } else {
                console.warn(`${fileName}:${el.location.line}:${el.location.col}: invalid attributes in directory link ${JSON.stringify({name, src})}`);
              }
            } else if (rel === 'hostScript') {
              const name = el.getAttribute('name');
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
              if (name && src && mode) {
                if (/^#[a-z][a-z0-9\-]*$/i.test(src)) {
                  const scriptEl = selector.find(html, src, true);
                  if (scriptEl && scriptEl.tagName === 'SCRIPT' && scriptEl.childNodes.length > 0 && scriptEl.childNodes[0].nodeType === Node.TEXT_NODE) {
                    windowEval(scriptEl.childNodes[0].value, _makeContext(), url);
                  } else {
                    console.warn(`${fileName}:${el.location.line}:${el.location.col}: ignoring invalid link script tag reference ${JSON.stringify(src)}`);
                  }
                } else {
                  if (mode === 'javascript') {
                    const url = new URL(src, baseUrl).href;
                    await fetch(url)
                      .then(res => {
                        if (res.status >= 200 && res.status < 300) {
                          return res.text();
                        } else {
                          return Promise.reject(new Error('invalid status code: ' + res.status));
                        }
                      })
                      .then(s => {
                        windowEval(s, _makeContext(), url);
                      });
                  } else if (mode === 'nodejs') {
                    return new Promise((accept, reject) => {
                      tmp.dir((err, p) => {
                        if (!err) {
                          accept(p);
                        } else {
                          reject(err);
                        }
                      }, {
                        keep: true,
                        unsafeCleanup: true,
                      });
                    })
                      .then(p => {
                        return new Promise((accept, reject) => {
                          const npmInstall = child_process.spawn(
                            npmCommands.install.cmd[0],
                            npmCommands.install.cmd.slice(1).concat([
                              src,
                              '--production',
                              '--mutex', 'file:' + path.join(os.tmpdir(), '.intrakit-yarn-lock'),
                            ]),
                            {
                              cwd: p,
                              env: process.env,
                            }
                          );
                          // npmInstall.stdout.pipe(process.stderr);
                          npmInstall.stderr.pipe(process.stderr);
                          npmInstall.on('exit', code => {
                            if (code === 0) {
                              accept();
                            } else {
                              reject(new Error('npm install error: ' + code));
                            }
                          });
                          npmInstall.on('error', err => {
                            reject(err);
                          });
                        })
                          .then(() => new Promise((accept, reject) => {
                            // console.log('need to run script', src, p); // XXX
                            const packageJsonPath = path.join(p, 'package.json');
                            fs.lstat(packageJsonPath, (err, stats) => {
                              if (!err) {
                                fs.readFile(packageJsonPath, 'utf8', (err, s) => {
                                  if (!err) {
                                    const j = JSON.parse(s);
                                    const {dependencies} = j;
                                    const moduleName = Object.keys(dependencies)[0];
                                    accept(moduleName);
                                  } else {
                                    reject(err);
                                  }
                                });
                              } else {
                                reject(err);
                              }
                            });
                          }))
                          .then(moduleName => new Promise((accept, reject) => {
                            const packageJsonPath = path.join(p, 'node_modules', moduleName, 'package.json');
                            fs.readFile(packageJsonPath, 'utf8', (err, s) => {
                              if (!err) {
                                const j = JSON.parse(s);
                                const {main: mainPath} = j;
                                // console.log('got j', p, j);
                                const mainScriptPath = path.join(p, 'node_modules', moduleName, mainPath);
                                fs.readFile(mainScriptPath, 'utf8', (err, s) => {
                                  if (!err) {
                                    let result, err;
                                    try {
                                      result = windowEval(s, _makeContext(), path.join(src, p));
                                    } catch(e) {
                                      err = e;
                                    }
                                    if (!err) {
                                      accept(result);
                                    } else {
                                      reject(err);
                                    }
                                  } else {
                                    reject(err);
                                  }
                                });
                              } else {
                                reject(err);
                              }
                            });
                          }));
                      });
                  }
                }
              } else {
                console.warn(`${fileName}:${el.location.line}:${el.location.col}: invalid link hostScript arguments ${JSON.stringify({name, src, type})}`);
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
