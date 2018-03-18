console.log('Hello, world 1');

const http = require('http');

const port = process.env['PORT'];
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
