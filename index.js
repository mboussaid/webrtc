const express = require('express');
const app = express();
const fs = require("fs")
const path = require("path")
const router = require('./router')
const http = require('http');
const dotenv = require('dotenv');
const cors = require("cors")
const { Server } = require("socket.io");
const validate = require('uuid-validate');
const {v4} = require('uuid')
const {exec} = require('child_process');
const {initializeWorkers,createRouter} = require('./recorder/mediasoup')
const config = require('./recorder/config')
const Process = require('./recorder/Process');
const Peer = require('./recorder/Peer');
const {getPort,releasePort} = require('./recorder/port');
const limit = 15; // MB
let mediasoupRouter;
let debug=false;
let logs=false;
let API_URL;
const RECORDING_FOLDER = "records";
const LOGS_PATH = "logs";
const LOGS_FILE_NAME = "logs.txt"
const PORT = process.env.PORT || 4444;
let records = [];
let calls = [];
let env = dotenv.config();
if(env.error){
    log("ERROR: .ENV FILE IS MISSING")
    process.exit(0)
}else{
    if(process.env.DEBUG){
        debug = +process.env.DEBUG === 1 ? true : false
    }
    if(process.env.LOGS){
        logs = +process.env.LOGS === 1 ? true : false
    }
    if(!process.env.API_URL){
        log("ERROR: PLEASE PROVIDE API_URL INSIDE .ENV FILE")
        process.exit(0)
    }else{
        API_URL = process.env.API_URL
        if(API_URL.substr(-1) === '/') {
            API_URL= API_URL.substr(0,API_URL.length-1);
        }
    }
    let PATH = path.join(__dirname,RECORDING_FOLDER);
    fs.readdir(PATH,(err)=>{
        if(err){
            fs.mkdir(PATH,(err)=>{
                if(err){
                    log("ERROR WHILE MAKING FOLDER")
                    process.exit(0)
                }
            })
        }
    })
}
function logger(content){
    if(!content||!logs) return;
    let logFolderPath = typeof LOGS_PATH !== "undefined" ? path.join(__dirname,LOGS_PATH) : __dirname;
    let logFilePath = typeof LOGS_FILE_NAME !== "undefined" ?  path.join(logFolderPath,LOGS_FILE_NAME) : path.join(logFolderPath,"logs.txt");
    if(!fs.existsSync(logFolderPath)){
        fs.mkdirSync(logFolderPath)
    }
    if(!fs.existsSync(logFilePath)){
        fs.writeFileSync(logFilePath,'');
    }
    let time = new Date().toUTCString();
    let line;
    if(typeof content === "string"){
        line = `${time} ${content}\n`
    }
    if(typeof content==="object"&&content.stack){
        line = `${time} ${content.stack}\n`
    }
    if(!line) return;
    try{
        fs.appendFileSync(logFilePath,line)
    }catch(err){
        log(err)
    }
}
let peeredDevices = [];
app.use(express.urlencoded({limit:`${limit}mb`,extended:true}))
app.use(express.json({limit:`${limit}mb`}))
app.use(router)
app.use(cors({origin:"*"}))
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
const customRouter = express.Router();
customRouter.post('/peer',async (req,res)=>{
    const callId = req.body.callId;
    let participant = new Peer(callId,false);
    let screenShare = new Peer(callId,true);
    participant.sessionId = uuidv4();
    screenShare.sessionId = uuidv4();
    try{
        const participantTransport = await mediasoupRouter.createWebRtcTransport(config.webRtcTransport);
        const screenShareTransport = await mediasoupRouter.createWebRtcTransport(config.webRtcTransport)
        participant.transports.push(participantTransport);
        screenShare.transports.push(screenShareTransport);
        peeredDevices.push(participant);
        peeredDevices.push(screenShare);
        const response = {
                routerRtpCapabilities: mediasoupRouter.rtpCapabilities,
                transports:{
                    participant:{
                        id: participantTransport.id,
                        iceParameters: participantTransport.iceParameters,
                        iceCandidates: participantTransport.iceCandidates,
                        dtlsParameters: participantTransport.dtlsParameters,
                        sessionId: participant.sessionId
                    },
                    screenShare:{
                        id: screenShareTransport.id,
                        iceParameters: screenShareTransport.iceParameters,
                        iceCandidates: screenShareTransport.iceCandidates,
                        dtlsParameters: screenShareTransport.dtlsParameters,
                        sessionId : screenShare.sessionId
                    }
                }
        }
        res.json(response);
    }catch(err){
        res.json(err)
    }
})
customRouter.post('/connect',function(req,res){
    let {sessionId,transportId,dtlsParameters} = req.body;
    let peer = getPeerById(sessionId);
    if(!peer) {
        log(`[+] peer with sessionId ${sessionId} not found`)
        res.json({});
        return;
    };
    let transport = peer.getTransport(transportId);
    if(!transport) {
        log(`[+] transport with transportId ${transportId} not found`)
        res.json({})
        return
    };
    transport.connect({dtlsParameters})
    res.json({})
})
customRouter.post('/produce',async function(req,res){
    const {sessionId , kind , transportId , rtpParameters} = req.body;
    let peer = getPeerById(sessionId);
    if(!peer) {
        log(`[+] peer with sessionId ${sessionId} not found`)
        return;
    };
    const transport = peer.getTransport(transportId);
    if (!transport) {
      log(`Transport with id ${transportId} was not found`);
    }
   transport.produce({
      kind: kind,
      rtpParameters: rtpParameters,
    }).then((producer)=>{
        peer.addProducer(producer);
        res.status(200).json({mid:producer.rtpParameters.mid})
    })
    .catch((err)=>{
        console.log(err)
        process.exit(0);
    })
})
app.use('/media',customRouter);
const server = http.createServer(app);
const io = new Server(server,{
    cors:"*",
    maxHttpBufferSize:1e6*limit // (1e6 => 1MB)
});
function initRecord({callId,subject,description,start_time}){
    return new Promise((resolve,reject)=>{
        if(!records){
            logger("Error the records  empty")
            reject({})
            return
        }
        log("[+] initializing new Record")
        logger(`Starting new record for callId= ${callId}`)
        let record = records.find(_record=>_record.callId===callId);
        if(!record){
            records.push({
                record_id:1,
                active:true,
                callId,
                started_at:now(),
                participants:[],
                participantsCount:0
            });
            record = records.find(_record=>_record.callId===callId&&_record.active);
        }else{
            record.record_id++
            record.active=true
            record.started_at = now()
            record.participants = []
            record.participantsCount=0
        }
        let call = calls.find(_call =>_call.callId===callId);
        if(!call){
            calls.push({
                callId,
                subject,
                description,
                start_time
            })
        }
        let callFolderPath = path.join(__dirname,`${RECORDING_FOLDER}/${callId}`);
        let recordFolder = path.join(callFolderPath,record.record_id.toString());
        if(!fs.existsSync(callFolderPath)){
            fs.mkdirSync(callFolderPath)
        }
        if(!fs.existsSync(recordFolder)){
            fs.mkdirSync(recordFolder);
        }
        if(fs.existsSync(recordFolder)){
            let callInfo = getCallInfo(callId)
            writeFile(path.join(callFolderPath,'config.json'),JSON.stringify(callInfo))
            resolve({callId,record_id:record.record_id})
        }else{
            logger("Error while making record folder")
            reject({callId,record_id:record.record_id})
            return
        }
    })
}
function recordData({callId,id,userId,data}){
    return new Promise((resolve,reject)=>{
        let record = getRecord(callId)
        if(!record||!data) {
            if(!record){
                logger("Error the record not exist")
            }
            if(!data){
                logger("Error data not recicieved from the client")
            }
            reject({})
            return
        };
        let participant = getRecordParticipant(record,userId)
        if(!participant){
            logger("Error the participant not exist")
            reject()
            return
        }
        let step = getParticipantStep(participant,id);
        if(!step){
            logger("Error the Step not exist")
            reject()
            return
        }
        if(record.active === false){
            if(step.stopped_at&&record.stopped_at && (record.stopped_at - record.stopped_at > 500)){
                reject()
                return
            }
        }
        log(`[+] Receiving data type=${step.type}`)
        let extentions={
            mix:'mp4',
            video:'mp4',
            audio:'mp3'
        };
        if(step.type&&extentions[step.type]){
            let fileName=step.id;
            let fileExtention=extentions[step.type];
            step.fileName=`${fileName}.${fileExtention}`;
            step.stream_url=`${API_URL}/record/${record.callId}/${record.record_id}/${participant.userId}/${step.fileName}`
            saveData({record,participant,step,data})
        }
        resolve({record_id:record.record_id});
    })

}
function newStep({callId,id,userId,type,username,screenName,isScreenShare,avatar,is_host,mimeType}){
    return new Promise((resolve,reject)=>{
        let record = getRecord(callId)
        if(typeof record !== "object") {
            reject({})
            return
        };
        if(record&&record.active === false) {
            reject({})
            return
        }
        log(`[+] new step for ${username} type=${type}`)
        let participant = getRecordParticipant(record,userId)
        if(!participant){
            let participantObj = {
                    userId:userId,
                    username:username,
                    screenName:screenName,
                    avatar:avatar,
                    is_host:is_host,
                    isScreenShare:isScreenShare
                }
            participant = addRecordParticipant(record,participantObj);
            let stepObj = {
                    id:id,
                    type:type,
                    started_at:now(),
                    isScreenShare,
                    mimeType,
                    stopped:false,
            }
            if(participant){
                addParticipantStep(participant,stepObj,record)
            }
        }else{
            let step = getParticipantStep(participant,id);
            if(!step){
                step = {
                    id:id,
                    started_at:now(),
                    isScreenShare,
                    mimeType,
                    type,
                    stopped:false
                }
                addParticipantStep(participant,step);
            }
        }
        resolve({record_id:record.record_id});
    })
}
function endStep({callId,userId,id,data,skip}){
    return new Promise((resolve,reject)=>{
        let record = getRecord(callId,skip);
        if(!record) {
            reject('no record');
            return;
        }
        let participant = getRecordParticipant(record,userId);
        if(!participant){
            reject('no participant')
            return
        }else{
            let step = participant.steps.find(s=>s.id === id);
            log(`[+] ending step for ${participant.username} type=${step.type}`)
            endParticipantStep(participant,id,record,data)
            resolve();
        }
    })
}
function endRecord({callId,leaving}){
    return new Promise((resolve,reject)=>{
        let record = getRecord(callId)
        if(!record||record&&record.active===false){
            reject('record not active');
            return
        }
        log("[+] ending record for callId:"+callId)
        checkRecordFolder(record)
        .then((recordPath)=>{
                log("[+] record stopped.")
                if(leaving&&leaving===true){
                    leaveCall(callId);
                }
                let stopped_at = now()
                record.stopped_at=stopped_at;
                let config = getConfig(record);
                writeFile(path.join(__dirname,`${RECORDING_FOLDER}/${callId}/${record.record_id}/config.json`),JSON.stringify(config));
                if(Array.isArray(record.participants)&&record.participants.length>0){
                    record.participants.forEach(participant=>{
                        if(Array.isArray(participant.steps)){
                            participant.steps.forEach(step=>{
                                if(!step.stopped || !step.stopped_at){
                                    endParticipantStep(participant,step.id,record,stopped_at);
                                }
                            })
                        }
                    })
                }
                setTimeout(()=>{
                    record.active=false
                },5000)
                logger(`Record with callId = ${callId} ended`);
                resolve()
        })
        .catch(err=>{
            logger(`Error while ending record with callId=${callId}`)
            reject('error')
            return
        })
    })
}
function leaveCall(callId){
    if(!callId||calls.length===0&&records.length===0) return;
    setTimeout(()=>{
        calls=calls.filter(call=>call.callId!==callId);
        records=records.filter(record=>record.callId !== callId)
    },10000)
}
function getRecord(callId,skip=false){
    if(!callId) return;
    let record = records.find((_record)=>{
        return _record.callId == callId &&( _record.active === true || skip)
    })
    return record;
}

function getRecordParticipant(record,userId){
    if(!record||!record.participants||!Array.isArray(record.participants)) return;
    let participant = record.participants.find(_participant=> _participant.userId === userId);
    return participant;
}
function addRecordParticipant(record,data){
    if(!record||!data) return;
    if(!record.participants){
        record.participants=[]
    }
    record.participantsCount++;
    record.participants.push(data);
    let record_path = path.join(__dirname,`${RECORDING_FOLDER}/${record.callId}/${record.record_id}`);
    fs.mkdirSync(path.join(record_path,data.userId.toString()));
    writeFile(path.join(record_path,data.userId.toString(),'config.json'),JSON.stringify(getParticipantConfig(data)));
    return record.participants[record.participants.length-1];
}
function getParticipantStep(participant,id){
    if(!participant||!participant.steps||!Array.isArray(participant.steps)) return;
    return participant.steps.find(obj => obj.id === id);
}
function addParticipantStep(participant,data,record){
    if(!participant||!data) return;
    if(!participant.steps){
        participant.steps=[]
    }else{
        let lastStep = participant.steps[participant.steps.length-1];
        if(lastStep&&data.started_at){
            lastStep.stopped_at = data.started_at
            lastStep.stopped = true;
        }
    }
    participant.steps.push(data);
    let record_path = path.join(__dirname,`${RECORDING_FOLDER}/${record.callId}/${record.record_id}`);
    let participant_config_path = path.join(record_path,participant.userId.toString(),'config.json');
    participant.steps.forEach(function(step,index){
        participant.steps[index] = getStepConfig(record,step)
    })
    writeFile(participant_config_path,JSON.stringify(getParticipantConfig(participant)))
}
function endParticipantStep(participant,id,record,data=null,_stopped_at){
    if(!participant||!id) return;
    let stopped_at = _stopped_at?_stopped_at:now()
    let step = getParticipantStep(participant,id);
    if(!step) return
    step.stopped_at=stopped_at
    step.stopped=true;
    let record_path = path.join(__dirname,`${RECORDING_FOLDER}/${record.callId}/${record.record_id}`);
    let participant_config_path = path.join(record_path,participant.userId.toString(),'config.json');
    participant.steps.forEach((step,index)=>{
        participant.steps[index] = getStepConfig(record,step)
    });
    writeFile(participant_config_path,JSON.stringify(getParticipantConfig(participant)))
    let lastStep = participant&&participant.steps.length > 0  ? participant.steps[participant.steps.length-1] : null;
    if(lastStep&&lastStep.id===id){
        record.participantsCount-=1;
    }
    if(data){
        saveData({record,participant,step,data})
    }
}
function getCallInfo(callId){
    if(!callId||!calls) return {};
    call=calls.find(c=>c.callId === callId);
    let info={
        callId:call&&call.callId?call.callId:null,
        subject:call&&call.subject?call.subject:null,
        description:call&&call.description?call.description:null,
        start_time:call&&call.start_time?call.start_time:''
    }
    return info;
}
function getConfig(record){
    if(!record||!calls) return {};
    call = calls.find(c=>c.callId === record.callId);
    let config = {
        call_id : call&&call.callId ? call.callId : null,
        record_id:record&&record.record_id ? record.record_id : null,
        started_at : record&&record.started_at ? record.started_at : null,
        subject : call&&call.subject ? call.subject : '',
        description : call&&call.description?call.description:'',
        stopped_at : record&&record.stopped_at ? record.stopped_at : null,
        duration:(record&&record.stopped_at&&record.started_at)?(record.stopped_at-record.started_at):null,
        participants:[],
     }
    return config
}
function getParticipantConfig(participant){
    if(!participant) return {}
    let config = {
        userId : participant&&participant.userId ?   participant.userId  : null,
        username : participant&&participant.username ? participant.username : null,
        screenName: participant&&participant.screenName ? participant.screenName : null,
        avatar: participant&&participant.avatar ? participant.avatar : null,
        is_host: participant&&participant.is_host ? participant.is_host : false,
        type:participant&&participant.type ? participant.type : null,
        steps:participant.steps ? participant.steps : []
       }
       return config;
}
function getStepConfig(record,step){
    if(!record) return {};
    let config = {
        id:step&&step.id?step.id:null,
        isScreenShare:step&&step.isScreenShare ? step.isScreenShare : false,
        type:step&&step.type?step.type:'avatar',
        started_at :step&&step.started_at? step.started_at : null,
        stopped_at:step&&step.stopped_at ? step.stopped_at : null,
        duration:(step&&step.started_at&&step.stopped_at) ? (step.stopped_at-step.started_at) : null,
        showAfter:(step&&step.started_at&&step.stopped_at) ? (step.started_at-record.started_at) : null,
        muted:false,
        stopped:step.stopped?step.stopped:false,
        mimeType:step.mimeType ? step.mimeType : '',
        hideAfter:(step&&step.started_at&&step.stopped_at)?((step.started_at-record.started_at)+(step.stopped_at-step.started_at)):null,
    }
    if(step.fileName&&step.stream_url){
        config.fileName = step.fileName
        config.stream_url = step.stream_url
    }
    return config;
}
function checkRecordFolder(record){
    return new Promise((resolve,reject)=>{
        if(!record) {
            logger("Error the record not exist")
            reject({})
            return
        };
        let recording_path = path.join(__dirname,`${RECORDING_FOLDER}`);
        let callFolderPath = path.join(recording_path,record.callId);
        let recordFolderPath = path.join(callFolderPath,record.record_id.toString())
        let callFolderExist = fs.existsSync(callFolderPath);
        let recordFolderExist = fs.existsSync(recordFolderPath);
       try{
        if(!callFolderExist){
            fs.mkdirSync(callFolderPath)
        }
        if(!recordFolderExist){
            fs.mkdirSync(recordFolderPath)
        }
        resolve(recordFolderPath)
       }catch(err){
           logger("Error while making Record & Call folder")
           reject(err)
           return
       }
    })
}
function log(string){
    if(debug&&string){
        console.log(string)
    }
}
function now(){
    return Date.now()
}
function joinSocket(socket,callId){
    if(!socket||!callId||callId&&!validate(callId)) return
    if(!socket.rooms.has(callId)){
        socket.join(callId);
    }
}
function saveData({record,participant,step,data}){
    if(!record||!participant||!step||!data) return;
    let extentions={
        mix:'mp4',
        video:'mp4',
        audio:'mp3'
    };
    if(!extentions[step.type]) return
    endParticipantStep(participant,step.id,record,null,null);
    if(!step.fileName&&!step.stream_url){
        let fileName=step.id;
        let fileExtention=extentions[step.type];
        step.fileName=`${fileName}.${fileExtention}`;
        step.stream_url=`${API_URL}/record/${record.callId}/${record.record_id}/${participant.userId}/${step.fileName}`
        let record_path = path.join(__dirname,`${RECORDING_FOLDER}/${record.callId}/${record.record_id}`);
        let participant_config_path = path.join(record_path,participant.userId.toString(),'config.json');
        participant.steps.forEach((step,index)=>{
            participant.steps[index] = getStepConfig(record,step)
        });
        writeFile(participant_config_path,JSON.stringify(getParticipantConfig(participant)))
    }
    let options = {}
    if(step.mimeType&&step.mimeType!==""){
        options.type = step.mimeType
    }
    try{
        fs.appendFileSync(path.join(__dirname,`${RECORDING_FOLDER}/${record.callId}/${record.record_id}/${participant.userId}/${step.fileName}`),data,"binary");
    }catch(err){
        logger(`Error while writing data to file for participant username=${participant.username} `)
        log(err)
    }
}
function writeFile(path,content){
    try{
        fs.writeFileSync(path,content)
    }catch(err){
        logger(`Error while making the folder path = ${path}`)
        /// log(err)
    }
}
function notifyParticipants(callId,payload){
    if(!callId||!payload||callId&&!validate(callId)) return
    log(`[+] Notify Participants recording=${payload.recording}`)
    io.emit(`stateChanged:${callId}`,payload)
}
/// global handler
io.sockets.on('connection',socket=>{
    socket.on('disconnect',()=>{
        stopSocketRecordingProcess(socket)
    })
  })
/// socket section
function getPeerById(sessionId){
    if(!sessionId) return;
    return peeredDevices.find(peer => peer.sessionId === sessionId);
}
async function publishProducerRtpStream(peer,producer){
    const rtpTransportConfig = config.plainRtpTransport;
    const rtpTransport = await mediasoupRouter.createPlainTransport(rtpTransportConfig)
    const remoteRtpPort = await getPort();
    peer.remotePorts.push(remoteRtpPort);
    let remoteRtcpPort;
    if (!rtpTransportConfig.rtcpMux) {
        remoteRtcpPort = await getPort();
        peer.remotePorts.push(remoteRtcpPort);
    }
    await rtpTransport.connect({
        ip: "127.0.0.1",
        port: remoteRtpPort,
        rtcpPort: remoteRtcpPort,
    });
    peer.addTransport(rtpTransport);
    const codecs = [];
    const routerCodecs = mediasoupRouter.rtpCapabilities.codecs.find(
      (codec) => codec.kind === producer.kind
    );
    codecs.push(routerCodecs);
    const rtpCapabilities = {
      codecs,
      rtcpFeedback: [],
    };
    const rtpConsumer = await rtpTransport.consume({
      producerId: producer.id,
      rtpCapabilities,
      paused: true,
    });
    peer.consumers.push(rtpConsumer);
    return {
      remoteRtpPort,
      remoteRtcpPort,
      localRtcpPort: rtpTransport.rtcpTuple
        ? rtpTransport.rtcpTuple.localPort
        : undefined,
      rtpCapabilities,
      rtpParameters: rtpConsumer.rtpParameters,
    };
  };
function stopSocketRecordingProcess(sessionId){
    if(!sessionId) return;
    const peer = getPeerById(sessionId);
    if(!peer||peer&&!peer.process) return;
    peer.process.kill();
    peer.process = undefined;
    for (const remotePort of peer.remotePorts) {
      releasePort(remotePort);
    }
}
io.on('connection', (socket) => {
      socket.on('recordStop',async function(sessionId){
          stopSocketRecordingProcess(sessionId);
      })
      socket.on("recordStart", async function ({id,callId,userId,sessionId}) {
        const peer = getPeerById(sessionId);
        if(!peer) {
            console.log('no peer')
            return;
        };
        log("recordStart")
        let record = getRecord(callId)
        if(!record){
            logger("Error the record not exist")
            return
        };
        let participant = getRecordParticipant(record,userId);
        if(!participant){
            logger("Error the participant not exist")
            return
        }
        let step = getParticipantStep(participant,id);
        if(!step){
            logger("Error the Step not exist")
            return
        }
        if(record.active === false){
            if(step.stopped_at&&record.stopped_at && (record.stopped_at - record.stopped_at > 500)){
                return
            }
        }
        let extentions={
            mix:'webm',
            video:'webm',
            audio:'webm'
        };
        if(step.type&&extentions[step.type]){
            let fileName=step.id;
            let fileExtention=extentions[step.type];
            step.fileName=`${fileName}.${fileExtention}`;
            step.stream_url=`${API_URL}/record/${record.callId}/${record.record_id}/${participant.userId}/${step.fileName}`
        }
        endParticipantStep(participant,step.id,record,null,null);
        participant.steps.forEach((step,index)=>{
            participant.steps[index] = getStepConfig(record,step)
        });
        let record_path = path.join(__dirname,`${RECORDING_FOLDER}/${record.callId}/${record.record_id}`);
        let participant_config_path = path.join(record_path,participant.userId.toString(),'config.json');
        writeFile(participant_config_path,JSON.stringify(getParticipantConfig(participant)))
        let recordInfo = {};
        for (const producer of peer.producers) {
          recordInfo[producer.kind] = await publishProducerRtpStream(peer,producer);
        }
        recordInfo.fileName = v4();
        peer.process = new Process(recordInfo,`records/${record.callId}/${record.record_id}/${participant.userId}/${step.fileName}`);
        setTimeout(async () => {
          for (const consumer of peer.consumers) {
            await consumer.resume();
            await consumer.requestKeyFrame();
          }
        }, 1000);
      });
    socket.on('record:start',function(data,callback){
        let success;
        let message;
        joinSocket(socket,data.callId);
        notifyParticipants(data.callId,{recording:true})
        initRecord(data).then((res)=>{
            success = true;
            message = res;
        }).catch((err)=>{
            success = false;
            message = err;
            logger("Error while starting the record")
        })
        .finally(()=>{
            if(typeof callback==="function"){
                callback({success,message})
            }
        })
    })
    socket.on("record:data",function(data){
        joinSocket(socket,data.callId)
        recordData(data)
        .then((res)=>{})
        .catch((err)=>{
            logger(`Error while saving the record data ${err ? err: ''}`)
        })
        .finally(()=>{
            socket.emit('requestData',data.userId)
        })
    })
    socket.on('step:start',function(data,callback){
        let success;
        let message;
        joinSocket(socket,data.callId)
        newStep(data)
        .then((res)=>{
            success = true;
            message = res
        })
        .catch((err)=>{
            success = false
            message = err
            logger("Error while starting the step")
        })
        .finally(()=>{
            if(typeof callback==="function"){
                callback({success,message})
            }
        })
    })
    socket.on('step:stop',function(data,callback){
       let success;
       let message;
       joinSocket(socket,data.callId)
       endStep(data)
       .then((res)=>{
           success = true;
           message = res
       })
       .catch((err)=>{
           success = false
           message = err
           logger("Error while stopping the step")
       })
       .finally(()=>{
            if(typeof callback==="function"){
                callback({success,message})
            }
       })
    })
    socket.on("record:stop",async (data,callback)=>{
        let success;
        let message;
        notifyParticipants(data.callId,{recording:false})
        endRecord(data).then((res)=>{
            success = true;
            message = res;
        }).catch((err)=>{
            success = false;
            message = err;
            logger("Error while stopping the record")
        })
        .finally(()=>{
            peeredDevices.filter(peer => peer.callId === data.callId ).forEach(peer=>{
                stopSocketRecordingProcess(peer.sessionId);
            })
            if(typeof callback==="function"){
                callback({success,message})
            }
        })
    })
});
if(debug){
    process.on('uncaughtException',function(err){
        logger(err)
    })
    process.on('warning',function(err){
        logger(err)
    })
    process.on('exit',function(code){
        logger(`Process exit event with code: ${code}`)
    })
    process.on('unhandledRejection',function(reason,promise){
        logger(`Unhandled Rejection`)
    })
    server.on('error',function(err){
        logger(err);
    })
    server.on('clientError',function(err){
        logger(err)
    })
}
async function runServer(){
    try{
        await initializeWorkers();
        mediasoupRouter = await createRouter();
        exec(`kill -9 $(lsof -t -i:${PORT})`,function(){
            server.listen(PORT,()=>{
                log(`[+] API IS RUNNING ON PORT : ${PORT}`)
            });
        })
    }catch(err){
        logger(err);
        process.exit(1);
    }
}
runServer();