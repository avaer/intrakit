const util = require('util');
const path = require('path');
const fs = require('fs');
const url = require('url');
const {URL} = url;
const http = require('http');

const wld = require('wld');
const express = require('express');
const expressPut = require('express-put')(express);
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
    const staticPort = port++;
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
      onhostscript: (name, src, mode, scriptString, installDirectory, bindings) => {
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
          return new Promise((accept, reject) => {
            const localPort = port++;

            let err;
            try {
              windowEval(
                scriptString,
                _makeContext(Object.assign({
                  PORT: localPort,
                }, _formatBindings(bindings))),
                path.join(src, installDirectory)
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
