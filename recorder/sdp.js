const { getCodecInfoFromRtpParameters } = require('./utils');

// File to create SDP text from mediasoup RTP Parameters
module.exports.createSdpText = (rtpParameters) => {
  const { video, audio } = rtpParameters;
  let videoCodecInfo = null;
  let audioCodecInfo = null;
  if(video){
      videoCodecInfo = getCodecInfoFromRtpParameters('video', video.rtpParameters);
  }
  if(audio){  
     audioCodecInfo = getCodecInfoFromRtpParameters('audio', audio.rtpParameters);
  }
  let SDP= `v=0
  o=- 0 0 IN IP4 127.0.0.1
  s=FFmpeg
  c=IN IP4 127.0.0.1
  t=0 0
  ${video ? `m=video ${video.remoteRtpPort} RTP/AVP ${videoCodecInfo.payloadType}` : ''}
  ${video ? `a=rtpmap:${videoCodecInfo.payloadType} ${videoCodecInfo.codecName}/${videoCodecInfo.clockRate}` : '' }
  a=sendonly
  ${audio ? `m=audio ${audio.remoteRtpPort} RTP/AVP ${audioCodecInfo.payloadType}   `:''}
  ${audio ? `a=rtpmap:${audioCodecInfo.payloadType} ${audioCodecInfo.codecName}/${audioCodecInfo.clockRate}/${audioCodecInfo.channels}` : ''}
  a=sendonly
  --vcodec libx264 --acodec aac
  `;
  return SDP;
};
