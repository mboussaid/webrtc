const fs = require("fs")
const validate = require("uuid-validate")
let path = require("path")
const router = require("express").Router();
const RECORDING_FOLDER = 'records'
const SYNTHESIZE=true;
// GET /ROCORD/CALL_ID => returns json information about the call 
function synthesize(recordConfig){
        if(!recordConfig) return;
        if(!Array.isArray(recordConfig.participants)) return
        let hostParticipant = recordConfig.participants.find(participant=>participant.is_host);
        if(hostParticipant){
                let lastStep = hostParticipant.steps[hostParticipant.steps.length-1];
                if(lastStep.stopped_at < recordConfig.stopped_at){
                        lastStep.stopped_at = recordConfig.stopped_at;
                }
        }
        recordConfig.participants.forEach(participant=>{
                let lastStep = Array.isArray(participant.steps) ?  participant.steps[participant.steps.length-1] : null;
                if(lastStep.stopped_at>recordConfig.stopped_at) {
                        participantLastStep.stopped_at = recordConfig.stopped_at;
                }
        })
        return recordConfig;
}
function onGetCallConfig(callId){
        return new Promise((resolve,reject)=>{
                if(!callId||callId&&!validate(callId)) { reject() ; return;}
                let call_folder_path = path.join(__dirname,`../${RECORDING_FOLDER}/${callId}`);
                if(!fs.existsSync(call_folder_path)){
                        reject('CALL_FOLDER_NOT_EXIST');
                        return
                }
                let call_config_path = path.join(call_folder_path,'config.json');
                if(!fs.existsSync(call_config_path)){
                        reject('CALL_CONFIG_MISSING')
                        return
                }
                let data = fs.readFileSync(call_config_path).toString();
                try{
                        call_config = JSON.parse(data)
                        let call_dir = fs.readdirSync(call_folder_path,{withFileTypes:true});
                        if(!call_config.records){
                                call_config.records=[]
                        }
                        if(call_dir.length>0){
                                let record_folders = call_dir.filter(file=>file.isDirectory())
                                record_folders
                                .forEach(folder=>{
                                        onGetRecordConfig(callId,folder.name)
                                        .then((record_config)=>{
                                                call_config.records.push(record_config)
                                        },()=>{})
                                })
                        }
                        resolve(call_config)
                }catch(err){
                        reject('ERROR_WHILE_READING_CONFIG_FILE')
                }
        })
}
function onGetRecordConfig(callId,recordId){
        return new Promise((resolve,reject)=>{
                if(!recordId || !callId) {
                        reject() 
                        return;
                }
                let record_folder_path = path.join(__dirname,`../${RECORDING_FOLDER}/${callId}/${recordId}`);
                if(!fs.existsSync(record_folder_path)){
                        reject('RECORD_FOLDER_NOT_EXIST');
                        return
                }
                let record_config_path = path.join(record_folder_path,'config.json');
                if(!fs.existsSync(record_config_path)){
                        reject('RECORD_CONFIG_MISSING')
                        return
                }
                let data = fs.readFileSync(record_config_path).toString();
                try{
                        record_config = JSON.parse(data)
                        if(!record_config.participants){
                                record_config.participants = [];
                        }
                        let record_dir = fs.readdirSync(record_folder_path,{withFileTypes:true});
                        if(record_dir.length>0){
                                let participants_folders = record_dir.filter(file=>file.isDirectory()&&validate(file.name))
                                participants_folders
                                .forEach(folder=>{
                                        onGetParticipantConfig(callId,recordId,folder.name)
                                        .then((participant_config)=>{
                                                if(participant_config.steps&&participant_config.steps.length>0){
                                                        record_config.participants.push(participant_config)
                                                }
                                        },()=>{})
                                })
                        }
                        let participants = [];
                        record_config.participants.forEach(participant=>{
                                if(participant.steps&&participant.steps.length>0){
                                   participants.push(participant)
                                }
                        })
                        record_config.participants = sortParticipants(participants);
                        if(SYNTHESIZE){
                                record_config = synthesize(record_config)
                                try{
                                        fs.writeFileSync(record_config_path,JSON.stringify(record_config));
                                }catch(err){
                                        console.log(err);
                                }
                        }
                        resolve(record_config)
                }catch(err){
                                reject('ERROR_WHILE_READING_CONFIG_FILE')
                }
        })
}
function onGetParticipantConfig(callId,recordId,userId){
        return new Promise((resolve,reject)=>{
                if(!recordId||!callId||!userId||userId&&!validate(userId)) {
                        reject() 
                        return;
                }
                let participant_folder_path = path.join(__dirname,`../${RECORDING_FOLDER}/${callId}/${recordId}/${userId}`);
                if(!fs.existsSync(participant_folder_path)){
                        reject('PARTICIPANT_FOLDER_NOT_EXIST');
                        return
                }
                let participant_config_path = path.join(participant_folder_path,'config.json');
                if(!fs.existsSync(participant_config_path)){
                        reject('PARTICIPANT_CONFIG_MISSING')
                        return
                }
                let data = fs.readFileSync(participant_config_path).toString();
                try{
                        participant_config = JSON.parse(data)
                        let steps = [];
                        participant_config.steps.forEach(step=>{
                                if(step.started_at&&step.stopped_at){
                                   steps.push(step)
                                }
                        })
                        participant_config.steps = steps;
                        resolve(participant_config)
                }catch(err){
                        reject('ERROR_WHILE_READING_CONFIG_FILE')
                }
        })

}
function sortParticipants(participantsArray){
        if(!participantsArray||participantsArray&&!Array.isArray(participantsArray)) return []
        let sortedParticipantsArray=participantsArray.sort((pa,pb)=>{
                if(!Array.isArray(pa.steps)||!Array.isArray(pb.steps)) return 0
                if(pa.steps[0]&&pa.steps[0]&&typeof pa.steps[0].started_at !== 'number' &&typeof pa.steps[0].started_at !== 'number') return 0
                return (pa.steps[0].started_at - pb.steps[0].started_at)
        })
        return sortedParticipantsArray;
}
router.use((req,res,next)=>{
        res.header("Access-Control-Allow-Origin","*")
        next()
})
router.get("/record/:callId",function(req,res){
    let callId = req.params.callId;
    if(!validate(callId)){
        res.json({error:true,message:`INVALID_CALL_ID`})
    }else{
            onGetCallConfig(callId)
            .then((config)=>{
                    res.json(config)
            })
            .catch((message)=>{
                    res.json({error:true,message})
            })
    }
})
/// GET /RECORD/CALL_ID/RECORD_ID
router.get("/record/:callId/:recordId",function(req,res){
        let callId = req.params.callId;
        let recordId = req.params.recordId
        let messages = [];
        if(!validate(callId)){
                if(!validate(callId)){messages.push("INVALID_CALL_ID")}
                if(!validate(recordId)){messages.push("INVALID_RECORD_ID")}
                res.json({error:true,message:messages})
        }else{
                onGetCallConfig(callId)
                .then(call_config=>{
                        call_config.records = []
                        onGetRecordConfig(callId,recordId)
                        .then((record_config)=>{
                                call_config.records.push(record_config)
                                res.json(call_config)
                        })
                        .catch((message)=>{
                                res.json({error:true,message})
                        })
                })
                .catch(message=>{
                        res.json({error:true,message})
                })
        }
})

router.get("/record/:callId/:recordId/:userId",function(req,res){
        let callId = req.params.callId;
        let recordId = req.params.recordId
        let userId = req.params.userId;
        let messages = [];
        if(!validate(callId)){
                if(!validate(callId)){messages.push("INVALID_CALL_ID")}
                if(!validate(userId)){messages.push("INVALID_RECORD_ID")}
                res.json({error:true,message:messages})
        }else{
                onGetParticipantConfig(callId,recordId,userId)
                .then((config)=>{
                        res.json(config)
                })
                .catch((message)=>{
                        res.json({error:true,message})
                }) 
        } 
    })
// GET /RECORD/CALL_ID/PARTICIPANT_ID/stream => returns mp4 file
router.get("/record/:callId/:recordId/:userId/:fileName",function(req,res){
        const range = req.headers.range;
        let callId = req.params.callId;
        let recordId = req.params.recordId
        let userId = req.params.userId;
        let fileName = req.params.fileName;
        function validFileName(fileName){
                if(!fileName) return false
                return /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89aAbB][a-f0-9]{3}-[a-f0-9]{12}(.mp4|.mp3|.webm)$/.test(fileName)
        }
        let messages = [];
        if(!validate(callId)||!fileName){
                if(!validate(callId)){messages.push("INVALID_CALL_ID")}
                if(!validate(userId)){messages.push("INVALID_RECORD_ID")}
                if(!fileName){messages.push('FILE_NAME_IS_MISSING')}
                res.json({error:true,message:messages})
        }else{
                onGetParticipantConfig(callId,recordId,userId)
                .then((config)=>{
                        let filePath = null;
                        let mimeType = "video/mp4";
                        if(validFileName(fileName)){
                            filePath = path.join(__dirname,`../${RECORDING_FOLDER}/${callId}/${recordId}/${userId}/${fileName}`);
                        }else{
                            let step = config.steps ? config.steps[fileName] : null;
                            if(step&&step.fileName){
                                filePath = path.join(__dirname,`../${RECORDING_FOLDER}/${callId}/${recordId}/${userId}/${step.fileName}`);
                                if(step.type==="audio"){
                                   mimeType = "audio/webm"
                                }
                            }
                        }
                        if(filePath&&fs.existsSync(filePath)){
                                if(range){
                                        const mediaFileSize = fs.statSync(filePath).size;
                                        const CHUNK_SIZE = 10 ** 6;
                                        const start = Number(range.replace(/\D/g, ""));
                                        const end = Math.min(start + CHUNK_SIZE, mediaFileSize - 1);
                                        const contentLength = end - start + 1;
                                        const headers = {
                                        "Content-Range": `bytes ${start}-${end}/${mediaFileSize}`,
                                        "Accept-Ranges": "bytes",
                                        "Content-Length": contentLength,
                                        "Content-Type": mimeType,
                                        };
                                        res.writeHead(206, headers);
                                        const mediaFileStream = fs.createReadStream(filePath, { start, end });
                                        mediaFileStream.pipe(res);
                                }else{
                                        let normalStream = fs.createReadStream(filePath);
                                        normalStream.pipe(res)  
                                }
                        }else{
                                res.json({error:true,message:"ERROR_FILE_NOT_FOUND"})
                        }
                })
                .catch(message=>{
                        res.json({error:true,message})
                })
        }   
})
module.exports =  router;