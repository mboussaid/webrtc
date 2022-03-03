const child_process = require('child_process');
const { EventEmitter } = require('events');
const { createSdpText } = require('./sdp');
const { convertStringToStream } = require('./utils');
const enableProcessListeners = true;
class Process {
  constructor (rtpParameters,outputPath) {
    this._rtpParameters = rtpParameters;
    this._process = undefined;
    this._observer = new EventEmitter();
    this._outputPath = `./${outputPath}`;
    this._createProcess();
  }
  _createProcess () {
    const sdpString = createSdpText(this._rtpParameters);
    const sdpStream = convertStringToStream(sdpString);
    this._process = child_process.spawn('ffmpeg', this._commandArgs);
    if(enableProcessListeners){
    if (this._process.stderr) {
      this._process.stderr.setEncoding('utf-8');
      this._process.stderr.on('data', data =>
        console.log('ffmpeg::process::data [data:%s]', data)
      );
    }

    if (this._process.stdout) {
      this._process.stdout.setEncoding('utf-8');

      this._process.stdout.on('data', data =>
        console.log('ffmpeg::process::data [data:%s]', data)
      );
    }

    this._process.on('message', message =>
      console.log('ffmpeg::process::message [message:%o]', message)
    );

    this._process.on('error', error =>
      console.error('ffmpeg::process::error [error:%o]', error)
    );

    this._process.once('close', () => {
      console.log('ffmpeg::process::close');
      this._observer.emit('process-close');
    });

    sdpStream.on('error', error =>
      console.error('sdpStream::error [error:%o]', error)
    );
    }
    // Pipe sdp stream to the ffmpeg process
    sdpStream.resume();
    sdpStream.pipe(this._process.stdin);
  }

  kill () {
    console.log('kill() [pid:%d]', this._process.pid);
    this._process.kill('SIGINT');
  }

  get _commandArgs () {
    let commandArgs = [
      '-loglevel',
      'debug',
      '-protocol_whitelist',
      'pipe,udp,rtp',
      '-fflags',
      '+genpts',
      '-f',
      'sdp',
      '-i',
      'pipe:0'
    ];
    const {video,audio} = this._rtpParameters;
    if(video){
       commandArgs = commandArgs.concat(this._videoArgs);
    }
    if(audio){
      commandArgs = commandArgs.concat(this._audioArgs);
    }
    commandArgs = commandArgs.concat([
      '-flags',
      '+global_header',
      `${this._outputPath}`
    ]);
    return commandArgs;
  }

  get _videoArgs () {
    return [
      '-preset',
      'ultrafast',
      '-map',
      '0:v:0',
      '-c:v',
      'copy'
    ];
  }

  get _audioArgs () {
    return [
      '-preset',
      'ultrafast',
      '-map',
      '0:a:0',
      '-strict', // libvorbis is experimental
      '-2',
      '-c:a',
      'copy'
    ];
  }
}
module.exports=Process