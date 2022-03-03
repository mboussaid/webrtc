const mediasoup = require('mediasoup');
const config = require('./config');
let workers = [];
let nextWorkerIndex = 0;
module.exports.initializeWorkers = async () => {
  const { logLevel, logTags, rtcMinPort, rtcMaxPort } = config.worker;
  for (let i = 0; i < config.numWorkers; ++i) {
      const worker = await mediasoup.createWorker({
                            logLevel, logTags, rtcMinPort, rtcMaxPort
                          });
      worker.once('died', () => {
        console.error('worker::died worker has died exiting in 2 seconds... [pid:%d]', worker.pid);
        setTimeout(() => process.exit(1), 2000);
      });
      workers.push(worker);
  }
};
module.exports.createRouter = async () => {
  const worker = getNextWorker();
  return await worker.createRouter({ mediaCodecs: config.router.mediaCodecs });
};
const getNextWorker = () => {
  const worker = workers[nextWorkerIndex];
  if (++nextWorkerIndex === workers.length) {
    nextWorkerIndex = 0;
  }
  return worker;
};
