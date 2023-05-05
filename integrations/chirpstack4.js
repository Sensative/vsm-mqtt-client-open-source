const mqtt = require('mqtt')
const { isDate } = require('util/types');

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
    getVersionString: () => { return "Chirpstack 4.x MQTT Integration"; },
    checkArgumentsOrExit: (args) => { 
        if (!args.a)
            printUsageAndExit("Chirpstack: -a <application-id> is required");
        if (!args.s)
            printUsageAndExit("Chirpstack: -s <server url> is required");
    },
    connectAndSubscribe: async (args, devices, onUplinkDevicePortBufferDateLatLng) => {
        args.v && console.log("Trying to connect to " + args.s + " with application " + args.a);
        try {
            const client  = mqtt.connect(args.s);

            client.on('connect', () => {
                args.v && console.log("Connected to chirpstack server");

                /* Would work if all devices were vsm devices, but do not make that assumption
                const allTopics = `application/${args.a}/#`;
                client.subscribe(allTopics, (err) => {
                    if (err) {
                        console.log("Chirpstack subscribe all error: " + err.message);
                    } else {
                        console.log("Chirpstack subscribe all ok");
                    }
                })});

                Instead:
                */

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
            client.on('message', async (topic, message) => {
                // message is Buffer
                args.v && console.log(topic, message.toString());

                const obj = JSON.parse(message.toString('utf-8'));
                if (!obj.data)
                    return;
                const data = Buffer.from(obj.data, "base64");
                const port = obj.fPort;
                const id = obj.deviceInfo.devEui;
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
            throw e;
        }
    },
    sendDownlink: async (client, args, deviceId, port, data, confirmed) => {
        if (!Buffer.isBuffer(data))
            throw new Error("Chirpstack sendDownlink: data must be a buffer object");
        const devEUI = deviceId.toLowerCase();
        const topic = `application/${args.a}/device/${devEUI}/command/down`;
        const obj = {
            devEUI,
            confirmed,
            fPort: port,
            data: data.toString('base64'),
        };
        client.publish(topic, JSON.stringify(obj));
        args.v && console.log("Publish downlink on port " + port + " data: " + data.toString("hex"));
    },
}

