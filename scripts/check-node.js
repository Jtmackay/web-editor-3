const major = parseInt(process.versions.node.split('.')[0], 10);
if (major < 18) {
  console.error(`Required Node 18, detected ${process.versions.node}`);
  console.error(`Node path: ${process.execPath}`);
  console.error(`PATH: ${process.env.PATH}`);
  console.error(`On Windows, install and use Node 18 via nvm-windows:`);
  console.error(`https://github.com/coreybutler/nvm-windows`);
  console.error(`nvm install 18 && nvm use 18`);
  process.exit(1);
}
