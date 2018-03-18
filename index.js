const util = require('util');
const path = require('path');
const fs = require('fs');
const url = require('url');
const {URL} = url;
const http = require('http');
const zlib = require('zlib');

const minimist = require('minimist');
const wld = require('wld');
const express = require('express');
const expressPut = require('express-put')(express);
const windowEval = require('window-eval-native');
const tarFs = require('tar-fs');

let port = parseInt(process.env['PORT'], 10) || 8000;

if (require.main === module) {
  const args = minimist(process.argv.slice(2), {
    alias: {
      d: 'deploy',
      o: 'output',
    },
    string: [
      'output',
      'o',
    ],
    boolean: [
      'deploy',
      'd',
    ],
  });
  const [fileName] = args._;
  if (fileName) {
    const deploy = !!args.deploy;
    const output = args.output || path.join(process.cwd(), 'bundle.tar.gz');

    if (!deploy) {
      const staticPort = port++;

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
      const _formatBindings = bindings => {
        const result = {};
        for (const k in bindings) {
          result['LINK_' + k] = bindings[k].boundUrl;
        }
        return result;
      };

      wld(fileName, {
        ondirectory: (name, src, bindings) => new Promise((accept, reject) => {
          const app = express();
          app.use(expressPut(src, path.join('/', name)));
          const server = http.createServer(app);
          const localPort = port++;
          server.listen(localPort, err => {
            if (!err) {
              server.unref();

              accept(`http://127.0.0.1:${localPort}`);
            } else {
              reject(err);
            }
          });
        }),
        onhostscript: (name, src, mode, scriptString, bindings) => {
          if (mode === 'javascript') {
            return new Promise((accept, reject) => {
              const localPort = port++;
              windowEval(
                scriptString,
                _makeContext(Object.assign({
                  PORT: localPort,
                }, _formatBindings(bindings))),
                url
              );

              accept(`http://127.0.0.1:${localPort}`);
            });
          } else if (mode === 'nodejs') {
            console.log('got nodejs');
            return new Promise((accept, reject) => {
              const localPort = port++;

              let err;
              try {
                windowEval(
                  scriptString,
                  _makeContext(Object.assign({
                    PORT: localPort,
                  }, _formatBindings(bindings))),
                  src
                );
              } catch(e) {
                err = e;
              }

              if (!err) {
                accept(`http://127.0.0.1:${localPort}`);
              } else {
                reject(err);
              }
            });
          } else {
            return Promise.resolve();
          }
        },
      })
        .then(o => new Promise((accept, reject) => {
          const {indexHtml} = o;
          const staticApp = express();
          staticApp.get('/', (req, res, next) => {
            res.type('text/html');
            res.end(indexHtml);
          });
          staticApp.get('*', (req, res, next) => {
            for (const k in bindings) {
              const binding = bindings[k];
              if (binding.localSrc === req.path) {
                res.type('application/javascript');
                res.end(binding.scriptString);
                return;
              }
            }
            next();
          });
          const staticServer = http.createServer(staticApp);
          staticServer.listen(staticPort, err => {
            if (!err) {
              accept();
            } else {
              reject(err);
            }
          });
        }))
        .catch(err => {
          throw err;
        });
    } else {
      wld(fileName, {
        ondirectory: (name, src, bindings) => {
          console.log('got directory', {name, src});
          return Promise.resolve();
        },
        onhostscript: (name, src, mode, scriptString, bindings) => {
          console.log('got host script', {name, src});
          return Promise.resolve();
        },
      })
        .then(o => new Promise((accept, reject) => {
          const {indexHtml, bindings, installDirectory} = o;
          const rs = tarFs.pack(installDirectory);
          const ws = fs.createWriteStream(output);
          rs.pipe(zlib.createGzip()).pipe(ws);
          ws.on('finish', () => {
            accept();
          });
          rs.on('error', err => {
            reject(err);
          });
        }));
    }
  } else {
    console.warn('usage: intrakit [-d] <fileName>');
    process.exit(1);
  }
}

process.on('uncaughtException', err => {
  console.warn(err.stack);
});
process.on('unhandledRejection', err => {
  console.warn(err.stack);
});
