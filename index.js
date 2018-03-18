const fs = require('fs');
const parse5 = require('parse5');

if (require.main === module) {
  const fileName = process.argv[2];
  if (fileName) {
    fs.readFile(fileName, err => {
      if (!err) {
        const document = parse5.parse(fileName);
        // fetch the links and run them
      } else {
        throw err;
      }
    });
  } else {
    console.warn('usage: intrakit <fileName>');
    process.exit(1);
  }
}
