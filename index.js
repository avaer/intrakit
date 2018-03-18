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
    new Promise((accept, reject) => {
      fs.readFile(fileName, 'utf8', (err, htmlString) => {
        if (!err) {
          const documentAst = parse5.parse(htmlString, {
            locationInfo: true,
          });
          documentAst.tagName = 'document';
          const document = fromAST(documentAst);
          const html = document.childNodes.find(el => el.tagName === 'HTML');
          accept(html);
        } else {
          reject(err);
        }
      });
    })
      .then(html => {
        return new Promise((accept, reject) => {
          const staticApp = express();
          staticApp.get('/', (req, res, next) => {
            const htmlString = parse5.serialize(html);
            res.set('Content-Type', 'text/html');
            res.end(htmlString);
          });
          const staticServer = http.createServer(staticApp);
          staticServer.listen(port++, err => {
            if (!err) {
              accept();
            } else {
              reject(err);
            }
          });
        })
          .then(() => {
            const baseUrl = 'file://' + __dirname + '/';
            const bindings = {};

            const _makeContext = o => {
              const context = {
                window: null,
                require,
                process: new Proxy(process, {
                  get(target, key, value) {
                    if (key === 'env') {
                      return Object.assign({}, target.env, o);
                    } else {
                      return target[key];
                    }
                  },
                }),
                console,
              };
              context.window = context;
              return context;
            };
            const _setAttribute = (attrs, name, value) => {
              const attr = attrs.find(attr => attr.name === name);
              if (attr) {
                attr.value = value;
              } else {
                attrs.push({
                  name,
                  value,
                });
              }
            };
            const _formatBindings = bindings => {
              const result = {};
              for (const k in bindings) {
                result['LINK_' + k] = bindings[k];
              }
              return result;
            };

            return traverseAsync(html, async el => {
              if (el.tagName === 'LINK') {
                const rel = el.getAttribute('rel');
                if (rel === 'directory') {
                  const name = el.getAttribute('name');
                  const src = el.getAttribute('src');
                  if (name && src) {
                    await new Promise((accept, reject) => {
                      const server = http.createServer(expressPut(src, path.join('/', name)));
                      const localPort = port++;
                      server.listen(localPort, err => {
                        if (!err) {
                          server.unref();

                          const boundUrl = `http://127.0.0.1:${localPort}`;
                          _setAttribute(el.attrs, 'boundUrl', boundUrl);
                          bindings[name] = boundUrl;

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
                      if (scriptEl && scriptEl.childNodes.length === 1 && scriptEl.childNodes[0].nodeType === Node.TEXT_NODE) {
                        const localPort = port++;
                        windowEval(
                          scriptEl.childNodes[0].value,
                          _makeContext(Object.assign({
                            PORT: localPort,
                          }, _formatBindings(bindings))),
                          url
                        );
                        const boundUrl = `http://127.0.0.1:${localPort}`;
                        _setAttribute(el.attrs, 'boundUrl', boundUrl);
                        bindings[name] = boundUrl;
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
                            const localPort = port++;
                            windowEval(
                              s,
                              _makeContext(Object.assign({
                                PORT: localPort,
                              }, _formatBindings(bindings))),
                              url
                            );
                            const boundUrl = `http://127.0.0.1:${localPort}`;
                            _setAttribute(el.attrs, 'boundUrl', boundUrl);
                            bindings[name] = boundUrl;
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
                                        const localPort = port++;

                                        let err;
                                        try {
                                          windowEval(
                                            s,
                                            _makeContext(Object.assign({
                                              PORT: localPort,
                                            }, _formatBindings(bindings))),
                                            path.join(src, p)
                                          );
                                        } catch(e) {
                                          err = e;
                                        }

                                        if (!err) {
                                          const boundUrl = `http://127.0.0.1:${localPort}`;
                                          _setAttribute(el.attrs, 'boundUrl', boundUrl);
                                          bindings[name] = boundUrl;

                                          accept();
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
          });
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
