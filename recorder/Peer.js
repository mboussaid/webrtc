module.exports = class Peer {
    constructor(callId,isScreenshare){
        this.transports = [];
        this.producers = [];
        this.consumers = [];
        this.process = undefined;
        this.remotePorts = [];
        this.callId = callId ? callId : undefined;
        this.isScreenshare = isScreenshare;
        this.sessionId = undefined;
    }
    addTransport(transport){
        this.transports.push(transport)
    }
    setSessionId(sessionId){
        this.sessionId = sessionId;
    }
    getTransport(transportId){
        return this.transports.find(transport=>transport.id === transportId);
    }
    addProducer(producer){
        this.producers.push(producer)
    }
    getProducer(producerId){
        return this.producers.find(producer => producer.id === producerId)
    }
    getProducersByKind(kind){
        return this.producers.filter((producer => producer.kind === kind));
    }
    getConsumersByKind(kind){
        return this.consumers.filter((consumer => consumer.kind === kind));
    }
}