const mqtt = require("mqtt");
const { isDate } = require("util/types");

const printUsageAndExit = (info) => {
    console.log(info);
    process.exit(1);
}

const getMaxSize = (obj) => {
    if (Number.isInteger(obj.dr)) {
        if (obj.dr <= 2)
            return 51;
        if (obj.dr == 3)
            return 115;
        return 222;
    }

    return 51;
}

module.exports.api = {
    getVersionString: () => { return "Yggio Integration"; },
    checkArgumentsOrExit: (args) => { 
        const CONSTANTS = require('../constants');
        if (!args.a)
            printUsageAndExit("Chirpstack: -a <application-id> is required");
        if (!args.s)
            printUsageAndExit("Chirpstack: -s <server url> is required");
        if (!CONSTANTS.MONGODB.URI)
            printUsageAndExit("Yggio: MONGODB.URI must be set in constants.json");
        if (args.c)
            console.log("Chirpstack: Using custom client id: " + args.c);
    },
    connectAndSubscribe: async (args, devices, onUplinkDevicePortBufferDateLatLng) => {
        const TIMEOUT = 600000; // 10 minutes
        let interval;
        let client;
        const runYggioIntegration = async () => {
            const { MongoClient } = require("mongodb");
            const CONSTANTS = require("../constants");
            try {
                args.v && console.log("Connecting to Yggio MongoDB");
                const client = new MongoClient(CONSTANTS.MONGODB.URI, { useUnifiedTopology: true });
                args.v && console.log("Connected to Yggio MongoDB");

                const database = client.db("fafnir");
                const entities = database.collection("entities");
                const devicesResult = await entities
                    .find({"attrs.deviceModelName.value": "sensative-vsm-lora", "attrs.devEui.value": {$exists: true}})
                    .toArray();
                devices = devicesResult.map(device => device.attrs.devEui.value);
                console.log("Device count: " + devices.length);
            } catch (e) {
                console.log("Yggio: Got exception: " + e.message);
                clearInterval(interval);
                throw e;
            }

            args.v && console.log("Trying to connect to " + args.s + " with application " + args.a);
            try {
                if (!client?.connected) {
                    args.v && console.log("Connecting to chirpstack server");
                    client  = mqtt.connect(args.s, {username: args.u, password: args.p, clientId: args.c || CONSTANTS.MQTT.CLIENT_ID});
                } else {
                    args.v && console.log("Already connected to chirpstack server");
                }

                client.on("connect", () => {
                    args.v && console.log("Connected to chirpstack server");

                    if (Array.isArray(devices) && devices.length > 0) {
                        for (let i = 0; i < devices.length; ++i) {
                            const topic = `application/${args.a}/device/${devices[i].toLowerCase()}/event/up`;
                            client.subscribe(topic, (err) => {
                                if (err)
                                    console.log(`Chirpstack subscribe: ${topic} failed:` + err.message );
                                else
                                    args.v && console.log(`Chirpstack subscribed ok to ${topic}`);
                            });
                        }
                    } else {
                        // Use wildcard for the subscription
                        const topic = `application/${args.a}/device/+/event/up`;
                        client.subscribe(topic, (err) => {
                            if (err)
                                console.log(`Chirpstack subscribe: ${topic} failed:` + err.message );
                            else
                                args.v && console.log(`Chirpstack subscribed ok to ${topic}`);
                        });
                    }
                });
                client.on("message", async (topic, message) => {
                    // message is Buffer
                    args.v && console.log(topic, message.toString());

                    const obj = JSON.parse(message.toString("utf-8"));
                    if (!obj.data)
                        return;
                    const data = Buffer.from(obj.data, "base64");
                    const port = obj.fPort;
                    const id = obj.deviceInfo?.devEui || obj.devEUI;
                    const maxSize = getMaxSize(obj);

                    let lat, lng;
                    let date;
                    // Take first gateways lat & lng values, any gateway likely to hear this is likely within 150km
                    if (obj.rxInfo && obj.rxInfo.length > 0) {
                        let gwinfo = obj.rxInfo[0];
                    if (gwinfo.location) {
                        lat = gwinfo.location.latitude;
                        lng = gwinfo.location.longitude;
                    }
                        date = new Date(gwinfo.time);
                    }
                    if (! (date && isDate(date)))
                        date = new Date()

                    await onUplinkDevicePortBufferDateLatLng(client, id, port, data, date, lat, lng, maxSize);
                });
                return client;
            } catch (e) {
                console.log("Chirpstack: Got exception: " + e.message);
                clearInterval(interval);
                throw e;
            }
        };
        runYggioIntegration();
        interval = setInterval(runYggioIntegration, TIMEOUT);
    },
    sendDownlink: async (client, args, deviceId, port, data, confirmed) => {
        if (!Buffer.isBuffer(data))
            throw new Error("Chirpstack sendDownlink: data must be a buffer object");
        const devEUI = deviceId.toLowerCase();
        const topic = `application/${args.a}/device/${devEUI}/command/down`;
        const obj = {
            devEui: devEUI,
            confirmed,
            fPort: port,
            payload: data.toString("base64"),
        };
        client.publish(topic, JSON.stringify(obj));
        args.v && console.log("Publish downlink on port " + port + " data: " + data.toString("hex"));
    },
}

