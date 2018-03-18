const port = process.env['PORT'];
const rootDirectory = process.env['LINK_root-directory'];
console.log('Hello, world 1', {port, rootDirectory});

const http = require('http');

http.createServer((req, res) => {
  res.end(`got req: ${JSON.stringify(req.url)}\n`);
})
  .listen(port, err => {
    if (!err) {
      console.log(`listening on http://127.0.0.1:${port}`);
    } else {
      throw err;
    }
  });
