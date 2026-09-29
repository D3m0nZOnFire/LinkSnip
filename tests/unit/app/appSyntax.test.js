const fs = require('fs');
const path = require('path');
const vm = require('vm');

// app.js starts the server when required, so the suite never loads it. Compile it
// instead, so a syntax slip there fails the tests rather than the first boot.
describe('app.js', () => {
  it('compiles', () => {
    const file = path.join(__dirname, '../../../app.js');
    expect(() => new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file })).not.toThrow();
  });
});
