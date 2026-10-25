// Load exported native APIs only. Never initialize/login a second QQ instance.
const wrapper = require(require('node:path').resolve(process.argv[2]));
if (!wrapper.NodeQQNTWrapperUtil || !wrapper.NodeIKernelLoginService || !wrapper.NodeIQQNTWrapperEngine) throw new Error('Required QQ native APIs are missing');
process.exit(0);
